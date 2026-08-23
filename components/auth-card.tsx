import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * The shell both auth pages are drawn in: a `.card` carrying a title, a line
 * of subtitle and whatever the page is actually for, with the "or do the other
 * thing" link underneath it.
 *
 * Presentational and free of `server-only`, so the two things that need it can
 * both have it — `AuthForm` is a client component and the sign-in notice on
 * `/login` is a server one — rather than each drawing its own card and drifting.
 * (Same trade `components/section.tsx` makes for the signed-in pages; `.card`
 * is deliberately left on the auth forms and the error pages.)
 */
export function AuthCard({
  title,
  subtitle,
  alt,
  children,
}: {
  title: string;
  subtitle: string;
  alt: { href: "/login" | "/register"; text: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-[26rem]">
      <div className="card p-7">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
          {title}
        </h1>
        <p className="mt-1.5 text-[14px] text-text-muted">{subtitle}</p>

        {children}
      </div>

      <p className="mt-5 text-center text-[13px] text-text-muted">
        {alt.text}{" "}
        <Link
          href={alt.href}
          className="font-medium text-accent hover:text-accent-hover hover:underline"
        >
          {alt.label}
        </Link>
      </p>
    </div>
  );
}
