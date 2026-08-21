"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Which month the budget page is showing.
 *
 * State lives in the URL, like the dashboard's filters — a budget view is
 * worth linking to, and the page stays server-rendered around it. Reads
 * `useSearchParams`, so the caller wraps it in a `<Suspense>` boundary.
 */
export function BudgetMonthPicker({
  months,
  month,
}: {
  months: string[];
  month: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="text-[12.5px] font-medium text-text-muted">Month</span>
      <select
        value={month}
        disabled={pending}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);
          params.set("month", event.target.value);
          startTransition(() =>
            router.replace(`/budget?${params.toString()}`, { scroll: false }),
          );
        }}
        className={`h-9 rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[13px] text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          pending ? "opacity-60" : ""
        }`}
      >
        {[...months].reverse().map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
