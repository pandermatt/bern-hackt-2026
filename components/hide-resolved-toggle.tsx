"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Takes the finished kinds of finding out of `/anomalies`.
 *
 * **URL state, not React state.** The server computes the groups, so it needs
 * the flag anyway; putting it in the query string is what also makes the view
 * shareable and survive a reload — the same call
 * `components/transaction-filters.tsx` makes, and the opposite of the local
 * `hidden` set in `components/top-category-bars.tsx`, which hides nothing the
 * server had to know about.
 *
 * Reading `useSearchParams` is what makes this a client component, and what
 * requires a `<Suspense>` boundary around it.
 *
 * The router comes from `@/i18n/navigation`: a bare `next/navigation` replace
 * writes an unprefixed path, and the proxy would drop an English session back
 * to German on the first click.
 */
export function HideResolvedToggle({ resolvedGroupCount }: { resolvedGroupCount: number }) {
  const t = useTranslations("Anomalies");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // The literal string, not `z.coerce.boolean()` — the same choice
  // `includeTransfers` makes, where "false" would otherwise be truthy.
  const hidden = searchParams.get("hideResolved") === "true";

  function toggle() {
    const params = new URLSearchParams(searchParams);
    if (hidden) params.delete("hideResolved");
    else params.set("hideResolved", "true");

    startTransition(() => {
      router.replace(
        { pathname: "/anomalies", query: Object.fromEntries(params) },
        { scroll: false },
      );
    });
  }

  const Icon = hidden ? Eye : EyeOff;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      disabled={pending}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60 ${
        hidden
          ? "bg-accent-soft text-accent"
          : "bg-surface-muted text-text-muted hover:text-text"
      }`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(hidden ? "showResolved" : "hideResolved")}
      {/* Only when there is something to hide — a zero here would advertise a
          control that does nothing. */}
      {resolvedGroupCount > 0 && (
        <span className="font-mono tabular-nums">{resolvedGroupCount}</span>
      )}
    </button>
  );
}
