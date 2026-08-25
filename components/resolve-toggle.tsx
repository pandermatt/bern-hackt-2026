"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setAnomalyResolved } from "@/app/actions/anomalies";
import { ResolveRing } from "@/components/resolve-ring";
import { useResolveFade } from "@/components/resolve-fade";

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
 *
 * What *is* optimistic is the leaving: a resolved row is hidden by default, so
 * the page comes back without it, and `ResolveFade` dims and closes it up
 * before the write goes out so that removal lands on markup that is already
 * invisible.
 *
 * **The saving half is plain state, not a transition.** A transition commits
 * its updates when it settles, so asking the wrapper to fade from inside one
 * would queue the fade behind the very refresh it is supposed to precede — the
 * same trap `useAssistantChat` documents. Only the refresh runs in a
 * transition, which is what keeps the control disabled until the new list
 * lands.
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
  // `null` when nothing is going to leave the page — the whole-rule control in
  // the header, or any of them while the resolved rows are being shown.
  const fade = useResolveFade();
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const pending = saving || refreshing;

  async function toggle() {
    setSaving(true);
    // Ahead of the write, not between it and the refresh: `setAnomalyResolved`
    // revalidates both pages, so the tree without this row arrives with the
    // action's own reply and lands before any wait taken afterwards could —
    // the row was gone some 40ms in, whatever the fade was still doing. Played
    // first, the removal is the last thing to happen rather than the first,
    // and it happens to something already invisible.
    //
    // Only on the way *in*: un-ticking something puts it back on the page, and
    // fading out a row the server hands straight back is a flicker.
    const leaving = resolved ? null : fade;
    await leaving?.leave();

    const result = await setAnomalyResolved({
      ruleId,
      transactionIds,
      resolved: !resolved,
    });
    if (!result.ok) {
      toast.error(result.error);
      // Nothing was written, so nothing is going to remove it — a row left
      // faded out here would be gone from the page with the finding still
      // open underneath it.
      leaving?.restore();
      setSaving(false);
      return;
    }
    startRefresh(() => router.refresh());
    setSaving(false);
  }

  return (
    <button
      type="button"
      // Not `aria-checked`: this is a control that flips a state, not a
      // checkbox in a group, and `aria-pressed` is what the app's other
      // toggles (the category chips) already use.
      aria-pressed={resolved}
      aria-label={label}
      disabled={pending || transactionIds.length === 0}
      onClick={() => void toggle()}
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
