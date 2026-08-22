"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Puts the finished findings back onto the page you are on.
 *
 * **Resolved rows are hidden by default** — ticking one off is asking to be
 * done with it, so it leaves the list on the next refresh; this switch is how
 * the reader looks back at the worked-through pile. The flag is therefore
 * `showResolved`, and its absence is the default state.
 *
 * **URL state, not React state.** The server computes what to show, so it needs
 * the flag anyway; putting it in the query string is what also makes the view
 * shareable and survive a reload — the same call
 * `components/transaction-filters.tsx` makes, and the opposite of the local
 * `hidden` set in `components/top-category-bars.tsx`, which hides nothing the
 * server had to know about.
 *
 * It toggles on `usePathname()` rather than on a hard-coded `/anomalies`: the
 * same control sits on a rule's own page, and a fixed pathname there would send
 * the reader back to the overview instead of hiding anything. The flag travels
 * between the two on the links themselves, so switching it on and walking into
 * a rule keeps the resolved rows out of sight.
 *
 * Reading `useSearchParams` is what makes this a client component, and what
 * requires a `<Suspense>` boundary around it.
 *
 * Both hooks come from `@/i18n/navigation`: a bare `next/navigation` replace
 * writes an unprefixed path, and the proxy would drop an English session back
 * to German on the first click — and the matching `usePathname` is the one that
 * returns the path *without* the locale segment, which is what that router then
 * expects to be handed back.
 */
export function HideResolvedToggle({ resolvedCount = 0 }: { resolvedCount?: number }) {
  const t = useTranslations("Anomalies");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // The literal string, not `z.coerce.boolean()` — the same choice
  // `includeTransfers` makes, where "false" would otherwise be truthy.
  const shown = searchParams.get("showResolved") === "true";

  function toggle() {
    const params = new URLSearchParams(searchParams);
    if (shown) params.delete("showResolved");
    else params.set("showResolved", "true");

    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  const Icon = shown ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={shown}
      disabled={pending}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60 ${
        shown
          ? "bg-accent-soft text-accent"
          : "bg-surface-muted text-text-muted hover:text-text"
      }`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(shown ? "hideResolved" : "showResolved")}
      {/* Only when there is something to hide — a zero here would put a number
          on a control that has nothing to act on. The control itself stays,
          so it is in the same place on every page whether or not anything has
          been ticked off yet. */}
      {resolvedCount > 0 && (
        <span className="font-mono tabular-nums">{resolvedCount}</span>
      )}
    </button>
  );
}
