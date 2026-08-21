"use client";

import { useTheme } from "next-themes";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * Cycles light → dark → system. Three states rather than two because
 * "system" is the default: a two-way switch would strand anyone who wants to
 * go back to following the OS.
 *
 * Renders a fixed-size placeholder until hydrated. The resolved theme is only
 * knowable in the browser, so drawing the real icon during SSR would either
 * flash the wrong one or trip a hydration mismatch — but the placeholder has
 * to occupy the same box, or the header reflows on hydration.
 */

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function Icon({ theme }: { theme: string }) {
  if (theme === "system") {
    return (
      <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
        <rect
          x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25"
          stroke="currentColor" strokeWidth="1.4"
        />
        <path d="M5.5 13.75h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
        <path
          d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z"
          stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.4v1.5M8 13.1v1.5M14.6 8h-1.5M2.9 8H1.4M12.67 3.33l-1.06 1.06M4.39 11.61l-1.06 1.06M12.67 12.67l-1.06-1.06M4.39 4.39L3.33 3.33"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  if (!hydrated) {
    return <span className={`block size-[34px] shrink-0 ${className}`} aria-hidden />;
  }

  const current = theme ?? "system";
  const index = OPTIONS.findIndex((option) => option.value === current);
  const next = OPTIONS[(index + 1) % OPTIONS.length] ?? OPTIONS[0];

  return (
    <button
      type="button"
      onClick={() => setTheme(next.value)}
      className={`flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-strong text-text transition-colors hover:bg-surface-muted ${className}`}
      // The label announces the state, not the action, so a screen reader user
      // is told what the theme *is* rather than having to infer it.
      aria-label={`Theme: ${OPTIONS[index]?.label ?? "System"}. Switch to ${next.label}.`}
      title={`Theme: ${OPTIONS[index]?.label ?? "System"}`}
    >
      <Icon theme={current} />
    </button>
  );
}
