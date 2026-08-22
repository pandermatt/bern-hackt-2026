import { ChartColumn, House, TriangleAlert, Wallet } from "lucide-react";

/**
 * The app's top-level destinations, in the order they appear — read by both
 * `components/header-nav.tsx` (browser, and every width from `sm` up) and
 * `components/tab-bar.tsx` (the installed app on a phone).
 *
 * It lives here rather than in either of them because two navs rendering the
 * same four routes from two copies of the list is how they drift: a fifth page
 * added to one and forgotten in the other is invisible until someone opens the
 * app on the wrong device.
 *
 * Every tab owns its subtree — `/anomalies/AMOUNT_SPIKE` is still the anomalies
 * tab — so both consumers match with `pathname === href || startsWith(href + "/")`.
 */
export const TABS = [
  { href: "/home", key: "home", icon: House },
  { href: "/dashboard", key: "dashboard", icon: ChartColumn },
  { href: "/budget", key: "budget", icon: Wallet },
  {
    href: "/anomalies",
    key: "anomalies",
    /*
     * The one tab that cannot use its own name in the bottom bar. A quarter of
     * a 320px screen is about 70px, and German "Auffälligkeiten" is 15
     * characters — it overflows where "Start", "Dashboard" and "Budget" all
     * fit. `tabAnomalies` is the short form ("Hinweise" in German), used only
     * by the tab bar; the header nav and every page title keep the full word.
     *
     * No other tab has one, and none should get one until its own label
     * actually overflows.
     */
    shortKey: "tabAnomalies",
    icon: TriangleAlert,
  },
] as const;

export type NavTab = (typeof TABS)[number];
