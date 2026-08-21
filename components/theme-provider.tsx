"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * `next-themes` was already a dependency — `components/ui/sonner.tsx` reads
 * `useTheme()` to pick the toast skin — but nothing ever mounted the provider,
 * so it always resolved to the default. This is that provider.
 *
 * It writes `class="dark"` onto `<html>`, which is what the `.dark` block in
 * `app/globals.css` hangs off, and it inlines a blocking script that applies
 * the stored choice before first paint. That script is also why `<html>` needs
 * `suppressHydrationWarning`: it mutates the class attribute the server just
 * rendered, and React would otherwise flag the mismatch.
 *
 * Client-only by necessity — the preference lives in `localStorage`, which the
 * server cannot read. Only the provider crosses the boundary, not the page.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Without this, every colour token animates on a theme switch and the
      // whole page smears for the length of the longest transition.
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
