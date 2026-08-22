"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setAnomalyResolved } from "@/app/actions/anomalies";
import { ResolveRing } from "@/components/resolve-ring";

/**
 * The circle that ticks a finding off, and puts it back.
 *
 * Used at all three scopes on the rule page — one row, one day-and-merchant
 * group, the whole rule — because they differ only in how many ids they carry.
 *
 * **It takes ids and a boolean, never a transaction.** The list itself stays
 * server-rendered (`components/transaction-list.tsx` has the same rule), so no
 * merchant, amount or date crosses into the client bundle; what crosses is the
 * handle needed to name a row, which is meaningless without the session that
 * owns it.
 *
 * `router.refresh()` rather than optimistic state: resolving one row changes
 * the group's ring, the page's ring and the overview's, and re-deriving all
 * four in the client would be a second implementation of `getAnomalyRuleDetail`
 * that could disagree with it. The action already revalidates both pages.
 */
export function ResolveToggle({
  ruleId,
  transactionIds,
  resolved,
  progress,
  label,
  className = "size-[18px]",
}: {
  ruleId: string;
  transactionIds: number[];
  resolved: boolean;
  /**
   * How much of what this control covers is already ticked off, when that is
   * more than one thing. The ring draws this fraction, so a control standing
   * for several findings shows a part-filled circle rather than an empty one
   * that contradicts the "1 of 2 resolved" beside it.
   *
   * Omitted for a single row, where `resolved` says everything there is to say.
   */
  progress?: { resolved: number; total: number };
  /** Names what this ticks off — the accessible name of the button. */
  label: string;
  className?: string;
}) {
  const t = useTranslations("Anomalies");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      // Not `aria-checked`: this is a control that flips a state, not a
      // checkbox in a group, and `aria-pressed` is what the app's other
      // toggles (the category chips) already use.
      aria-pressed={resolved}
      aria-label={label}
      disabled={pending || transactionIds.length === 0}
      onClick={() =>
        startTransition(async () => {
          const result = await setAnomalyResolved({
            ruleId,
            transactionIds,
            resolved: !resolved,
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        })
      }
      className="cursor-pointer rounded-full transition-opacity hover:opacity-70 disabled:cursor-default disabled:opacity-50"
    >
      {/* The button's `aria-label` is its whole accessible name, so the ring's
          own label would only be a second copy of it in the tree. Hidden, and
          the button carries the meaning. */}
      <span aria-hidden className="block">
        <ResolveRing
          resolved={progress ? progress.resolved : resolved ? 1 : 0}
          total={progress ? progress.total : 1}
          label={t(resolved ? "stateResolved" : "stateOpen")}
          className={className}
        />
      </span>
    </button>
  );
}
