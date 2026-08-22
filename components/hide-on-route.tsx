"use client";

import type { ReactNode } from "react";

import { usePathname } from "@/i18n/navigation";

/**
 * Drops its children on one route.
 *
 * The header and the footer both offer a signed-out visitor "sign in" and
 * "get started", and the layout renders them on every route — including the
 * two pages those links lead to. A link to the page you are already reading is
 * not navigation; on `/register` the header's CTA in particular reads as the
 * form's submit button one row above the form.
 *
 * Client-side for the same reason `HeaderNav` is: the layout is shared across
 * every route and cannot know which one is active without asking. No data
 * crosses the boundary, just the path — and `usePathname` here is the
 * locale-aware one, so the comparison is against `/login`, not `/de/login`.
 *
 * The children are still rendered on the server and dropped here rather than
 * never built, which is the price of keeping the header and footer server
 * components. It is one link.
 */
export function HideOnRoute({
  route,
  children,
}: {
  route: "/login" | "/register";
  children: ReactNode;
}) {
  return usePathname() === route ? null : children;
}
