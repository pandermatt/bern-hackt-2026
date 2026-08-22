"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * The theme control, on the account page rather than in the header.
 *
 * A segmented pair rather than the cycling button this replaced: in a settings
 * list both choices should be visible at once, and a control that only shows
 * its current state makes you click it to find out what else there is.
 *
 * Selection follows `resolvedTheme`, not `theme`. A visitor who has never
 * chosen sits on `system`, and marking neither option would be a lie — one of
 * them is what they are looking at. Picking either one pins it.
 */

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeSetting() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // The resolved theme is only knowable in the browser. Reserve the control's
  // box so the row does not reflow when it lands.
  const current = hydrated ? resolvedTheme : undefined;

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-muted/50 p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            // Selected wears the accent pair, the same way the dashboard's
            // category chips mark an active filter. A raised white pill would
            // have read as "lifted" in light mode and *sunken* in dark, where
            // `--surface` sits below the track rather than above it.
            className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] font-medium transition-colors sm:py-1.5 ${
              selected
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
