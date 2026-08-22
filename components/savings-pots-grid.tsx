"use client";

import { Loader2, TriangleAlert, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";

import { allocateSurplus, transferSavings } from "@/app/actions/savings";
import { SavingsPot, type Spark } from "@/components/savings-pot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney, potFill, potPercent, type SavingsPot as Pot } from "@/lib/insights";

/** Pointer travel, in pixels, before a press counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 10;

/**
 * The id of the "Unallocated" tile — a stand-in for a month's leftover money
 * rather than a row in `savings_goals`, so it needs an id no real goal can
 * ever have. Goal ids are Postgres-style autoincrement, starting at 1.
 */
const UNALLOCATED_ID = 0;

/** Minor units → the plain decimal `allocateSurplus` expects. Zero stays empty — see `savings-allocator.tsx`. */
function toField(minor: number): string {
  return minor === 0 ? "" : (minor / 100).toFixed(2);
}

/** How long a pot's fireworks-and-glow celebration plays before it clears. */
const CELEBRATION_MS = 2500;

/** Sparks in the burst a pot gets the moment it first reaches its target. */
const SPARK_COUNT = 12;

/** Colours cycle the whole chart ramp rather than the pot's own hue — confetti reads as festive precisely because it isn't one colour. */
function randomSparks(): Spark[] {
  return Array.from({ length: SPARK_COUNT }, (_, index) => ({
    angle: (360 / SPARK_COUNT) * index + (Math.random() * 20 - 10),
    distance: 44 + Math.random() * 34,
    delay: Math.random() * 90,
    colour: `var(--chart-${(index % 10) + 1})`,
  }));
}

type Drag = {
  fromId: number;
  pointerId: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  overId: number | null;
  /** Past the threshold — a real drag, not a tap still deciding what it is. */
  active: boolean;
};

/**
 * The pots grid, plus drag-and-drop between them.
 *
 * A pot only knows how to draw itself — it stays a plain `<div>` — so the
 * dragging lives here, one level up, where the full list of pots is in scope
 * and a drop can be resolved against it.
 *
 * Pointer Events rather than HTML5 drag-and-drop: the native API has no touch
 * backing on mobile browsers, so a finger on the pot's text or its SVG just
 * scrolled or selected text instead of starting a drag. One pointer-based
 * implementation covers mouse, pen and touch alike.
 */
export function SavingsPotsGrid({
  pots,
  month,
  freeMinor,
}: {
  pots: Pot[];
  /** The viewed month, or `null` while it is still running — see `SavingsGoals`. */
  month: string | null;
  /** This month's surplus minus what is already allocated. Can be negative. */
  freeMinor: number;
}) {
  const [transfer, setTransfer] = useState<{ from: Pot; to: Pot } | null>(null);
  const [allocationMove, setAllocationMove] = useState<
    { direction: "into" | "outOf"; goal: Pot } | null
  >(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // A ref alongside the state: pointer handlers fire faster than React commits,
  // so the next move event needs the drag that was *just* set, not last render's.
  const dragRef = useRef<Drag | null>(null);

  const setDragState = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  // The element under the finger, not under the (visually translated) pot
  // being dragged — that pot turns `pointer-events-none` for exactly this.
  const potIdAt = useCallback((x: number, y: number): number | null => {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pot-id]");
    const id = cell ? Number(cell.dataset.potId) : NaN;
    return Number.isFinite(id) ? id : null;
  }, []);

  function handlePointerDown(fromId: number, event: ReactPointerEvent<HTMLLIElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setDragState({
      fromId,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      dx: 0,
      dy: 0,
      overId: null,
      active: false,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.originX;
    const dy = event.clientY - current.originY;
    const active = current.active || Math.hypot(dx, dy) > DRAG_THRESHOLD;
    if (active) {
      // Only past the threshold: a tap that never moves must not steal the
      // pointer capture the settings/delete buttons need for their own click.
      if (!current.active) event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    setDragState({ ...current, dx, dy, active, overId: active ? potIdAt(event.clientX, event.clientY) : null });
  }

  function endDrag(event: ReactPointerEvent<HTMLLIElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active && current.overId !== null && current.overId !== current.fromId) {
      if (current.fromId === UNALLOCATED_ID) {
        // Dragged the pool onto a pot: money flows *into* it.
        const goal = pots.find((pot) => pot.id === current.overId);
        if (goal) setAllocationMove({ direction: "into", goal });
      } else if (current.overId === UNALLOCATED_ID) {
        // Dragged a pot onto the pool: money flows back *out of* it.
        const goal = pots.find((pot) => pot.id === current.fromId);
        if (goal) setAllocationMove({ direction: "outOf", goal });
      } else {
        const from = pots.find((pot) => pot.id === current.fromId);
        const to = pots.find((pot) => pot.id === current.overId);
        if (from && to) setTransfer({ from, to });
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 md:grid-cols-4 lg:grid-cols-5">
        {month !== null && (
          <UnallocatedSlot
            amountMinor={freeMinor}
            dragging={drag !== null && drag.active && drag.fromId === UNALLOCATED_ID}
            offset={drag !== null && drag.fromId === UNALLOCATED_ID ? { x: drag.dx, y: drag.dy } : null}
            over={drag !== null && drag.active && drag.overId === UNALLOCATED_ID}
            onPointerDown={(event) => handlePointerDown(UNALLOCATED_ID, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
        {pots.map((pot) => (
          <PotSlot
            key={pot.id}
            pot={pot}
            dragging={drag !== null && drag.active && drag.fromId === pot.id}
            offset={drag !== null && drag.fromId === pot.id ? { x: drag.dx, y: drag.dy } : null}
            over={drag !== null && drag.active && drag.overId === pot.id && drag.fromId !== pot.id}
            onPointerDown={(event) => handlePointerDown(pot.id, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
      </ul>

      {allocationMove && (
        <AllocationDialog
          direction={allocationMove.direction}
          goal={allocationMove.goal}
          pots={pots}
          month={month}
          freeMinor={freeMinor}
          onOpenChange={(open) => {
            if (!open) setAllocationMove(null);
          }}
        />
      )}

      {transfer && (
        <TransferDialog
          from={transfer.from}
          to={transfer.to}
          onOpenChange={(open) => {
            if (!open) setTransfer(null);
          }}
        />
      )}
    </>
  );
}

/**
 * One draggable, droppable grid cell — see `SavingsPotsGrid` for the gesture.
 *
 * Also the one place that notices a pot just reached its target: `key={pot.id}`
 * keeps this component mounted across refreshes, so a ref here can compare
 * "was it full a moment ago" against "is it full now" and fire the pot's
 * celebration only on that crossing, never on an ordinary reload of an
 * already-full pot.
 */
function PotSlot({
  pot,
  dragging,
  offset,
  over,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  pot: Pot;
  dragging: boolean;
  offset: { x: number; y: number } | null;
  over: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLLIElement>) => void;
}) {
  const full = potFill(pot.savedMinor, pot.targetMinor) >= 1;
  const wasFull = useRef(full);
  const [celebration, setCelebration] = useState<Spark[] | null>(null);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (full && !wasFull.current) {
      // Rolled here rather than in `SavingsPot`: `Math.random` is impure, and
      // this effect already does genuine side-effect work (the timer), which
      // is the one place React's stricter rules allow it.
      setCelebration(randomSparks());
      // The action that fills a pot — saving the allocator, confirming a
      // transfer — happens below the pots grid, so without this the burst
      // plays entirely off-screen above whatever the reader is looking at.
      liRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setCelebration(null), CELEBRATION_MS);
      wasFull.current = true;
      return () => clearTimeout(timer);
    }
    wasFull.current = full;
  }, [full]);

  return (
    <li
      ref={liRef}
      data-pot-id={pot.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={dragging && offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      className={cn(
        // `touch-none` is what turns a finger-drag on the card into this
        // gesture instead of the page scrolling underneath it — the tradeoff
        // is that the card itself can no longer be the start of a scroll.
        "relative cursor-grab touch-none rounded-lg transition-shadow select-none active:cursor-grabbing",
        dragging && "z-20 opacity-80 shadow-lg pointer-events-none",
        over && "shadow-[0_0_0_2px_var(--accent)]",
      )}
    >
      <SavingsPot pot={pot} celebrating={celebration !== null} sparks={celebration ?? []} />
    </li>
  );
}

/**
 * The "Unallocated" tile: this month's surplus minus what the pots already
 * hold.
 *
 * Not a `savings_goals` row — it has no target, no database id, and its
 * amount is `SavingsOverview.freeMinor` as computed by the server, not
 * anything tracked here. It plugs into the same drag machinery as a real pot
 * (`data-pot-id={UNALLOCATED_ID}`), so dragging it onto a pot or a pot onto
 * it reads as the same gesture as a pot-to-pot transfer — `SavingsPotsGrid`
 * just resolves it through `AllocationDialog` instead of `TransferDialog`,
 * because the money involved was never *saved* anywhere to begin with.
 *
 * `amountMinor` can be negative — a month that spent more than it earned —
 * and that is the one state this tile is built to say loudly: `--danger`
 * colours and a looping pulse, in place of the neutral wallet look.
 */
function UnallocatedSlot({
  amountMinor,
  dragging,
  offset,
  over,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  amountMinor: number;
  dragging: boolean;
  offset: { x: number; y: number } | null;
  over: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLLIElement>) => void;
}) {
  const t = useTranslations("Savings");
  const overspent = amountMinor < 0;
  // The formatter is unsigned; the glyph is a real minus sign (U+2212), not a
  // hyphen — see `components/summary-cards.tsx` for the same convention. The
  // split is on a literal non-breaking space, which is what de-CH joins the
  // currency code to the amount with — see `Amount` in `savings-pot.tsx`.
  const [code, ...rest] = formatMoney(amountMinor).split("\xa0");

  return (
    <li
      data-pot-id={UNALLOCATED_ID}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={dragging && offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      className={cn(
        "relative flex cursor-grab touch-none flex-col items-center rounded-lg border px-3 pt-3 pb-4 text-center transition-shadow select-none active:cursor-grabbing",
        overspent ? "unallocated-pulse border-danger bg-danger-soft" : "border-line bg-surface",
        dragging && "z-20 opacity-80 shadow-lg pointer-events-none",
        over && "shadow-[0_0_0_2px_var(--accent)]",
      )}
    >
      <div className="flex h-[118px] w-[110px] items-center justify-center">
        <div
          className={cn(
            "flex size-16 items-center justify-center rounded-full",
            overspent ? "bg-danger text-white" : "bg-accent-soft text-accent",
          )}
        >
          {overspent ? (
            <TriangleAlert className="size-7" aria-hidden />
          ) : (
            <Wallet className="size-7" aria-hidden />
          )}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-[13.5px] leading-snug font-semibold text-text">
        {t("unallocatedLabel")}
      </p>

      <p className="mt-1 flex items-baseline justify-center gap-1">
        <span className="font-mono text-[10.5px] text-text-subtle">{code}</span>
        <span
          className={cn(
            "font-mono text-[15px] font-semibold tabular-nums",
            overspent ? "text-danger" : "text-accent",
          )}
        >
          {overspent && "−"}
          {rest.join(" ")}
        </span>
      </p>

      <p className="mt-0.5 line-clamp-2 font-mono text-[10.5px] text-text-subtle">
        {overspent ? t("unallocatedOverspent") : t("unallocatedHint")}
      </p>
    </li>
  );
}

function TransferDialog({
  from,
  to,
  onOpenChange,
}: {
  from: Pot;
  to: Pot;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  // Defaults to whatever moves `to` closest to its target without emptying
  // `from` past what it holds — a starting point, not a ceiling: overfunding
  // a pot is allowed everywhere else in the app, so this dialog does not shut
  // that door either.
  const suggested = Math.max(
    0,
    Math.min(from.savedMinor, to.targetMinor - to.savedMinor),
  );
  const [amount, setAmount] = useState(() =>
    suggested > 0 ? (suggested / 100).toFixed(2) : (from.savedMinor / 100).toFixed(2),
  );

  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsedAmount = Number(cleaned);
  const valid =
    cleaned !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Math.round(parsedAmount * 100) <= from.savedMinor;
  const preview = valid
    ? potPercent(to.savedMinor + Math.round(parsedAmount * 100), to.targetMinor)
    : null;

  function move() {
    startTransition(async () => {
      const result = await transferSavings(from.id, to.id, amount);
      if (result.ok) {
        toast.success(
          t("transferred", { amount: formatMoney(Math.round(parsedAmount * 100)), from: from.name, to: to.name }),
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("transferTitle", { to: to.name })}</DialogTitle>
          <DialogDescription>
            {t("transferDescription", { amount: formatMoney(from.savedMinor), from: from.name })}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) move();
          }}
        >
          <label>
            <span className="text-[12.5px] font-medium text-text-muted">
              {t("transferFieldLabel")}
            </span>
            <input
              ref={field}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p className="mt-1.5 h-4 font-mono text-[11.5px] tabular-nums text-text-subtle">
            {preview === null
              ? t("transferHint", { amount: formatMoney(from.savedMinor) })
              : t("transferPreview", { to: to.name, percent: preview })}
          </p>
        </form>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={move}
            disabled={!valid || pending}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("moveMoney")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Moves money between one pot and the "Unallocated" tile.
 *
 * Goes through `allocateSurplus`, not `transferSavings`: this is about *this
 * month's* allocation specifically — the number the Unallocated tile itself
 * shows — not the goal's total saved across every month `transferSavings`
 * draws from. `allocateSurplus` checks its posted total against the month's
 * real surplus, and that check only means anything if the posted total is
 * *every* pot's amount for the month, not just the one being dragged — so the
 * submission here always carries all of `pots`, matching what
 * `SavingsAllocator`'s own save button sends, with only the dragged goal's
 * figure changed.
 */
function AllocationDialog({
  direction,
  goal,
  pots,
  month,
  freeMinor,
  onOpenChange,
}: {
  direction: "into" | "outOf";
  goal: Pot;
  pots: Pot[];
  month: string | null;
  freeMinor: number;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  // What can actually move: the pool itself going in, or only what this pot
  // already holds for the month coming out. Never negative — a month that is
  // itself overspent has nothing free to give away.
  const limit = direction === "into" ? Math.max(0, freeMinor) : goal.monthMinor;
  // Suggested, not a ceiling — same stance as `TransferDialog`. Into a pot,
  // default to whatever closes the gap to its target; out of one, default to
  // reclaiming all of it, since "drag the whole pot onto the pool" is the
  // more common reason to start this gesture.
  const suggested =
    direction === "into"
      ? Math.max(0, Math.min(limit, goal.targetMinor - goal.savedMinor))
      : limit;
  const [amount, setAmount] = useState(() =>
    suggested > 0 ? (suggested / 100).toFixed(2) : (limit / 100).toFixed(2),
  );

  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsedAmount = Number(cleaned);
  const enteredMinor = Math.round(parsedAmount * 100);
  const valid =
    cleaned !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0 && enteredMinor <= limit;
  const delta = direction === "into" ? enteredMinor : -enteredMinor;
  const preview = valid ? potPercent(goal.savedMinor + delta, goal.targetMinor) : null;

  function move() {
    if (!month || !valid) return;
    startTransition(async () => {
      const newMonthMinor = goal.monthMinor + delta;
      const entries = pots.map((pot) => ({
        goalId: pot.id,
        amount: toField(pot.id === goal.id ? newMonthMinor : pot.monthMinor),
      }));
      const result = await allocateSurplus(month, entries);
      if (result.ok) {
        toast.success(
          t(direction === "into" ? "allocated" : "unallocatedAgain", {
            amount: formatMoney(enteredMinor),
            to: goal.name,
            from: goal.name,
          }),
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(direction === "into" ? "allocateTitle" : "unallocateTitle", {
              to: goal.name,
              from: goal.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {direction === "into"
              ? t("allocateDescription", { amount: formatMoney(Math.max(0, freeMinor)) })
              : t("unallocateDescription", {
                  amount: formatMoney(goal.monthMinor),
                  from: goal.name,
                })}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) move();
          }}
        >
          <label>
            <span className="text-[12.5px] font-medium text-text-muted">
              {t(direction === "into" ? "allocateFieldLabel" : "unallocateFieldLabel")}
            </span>
            <input
              ref={field}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p className="mt-1.5 h-4 font-mono text-[11.5px] tabular-nums text-text-subtle">
            {preview === null
              ? t(direction === "into" ? "allocateHint" : "unallocateHint", {
                  amount: formatMoney(limit),
                })
              : t("allocatePreview", { to: goal.name, percent: preview })}
          </p>
        </form>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={move}
            disabled={!valid || pending || !month}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("moveMoney")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
