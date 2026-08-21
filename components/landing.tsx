import Link from "next/link";

import { site } from "@/lib/site";

const POINTS = [
  {
    title: "Private by default",
    body: "Every statement is scoped to your account. Nobody else can see a line of it.",
  },
  {
    title: "A year at a glance",
    body: "Income, spending and net per month, with the categories and merchants behind them.",
  },
  {
    title: "Nothing to categorise",
    body: "Your statements arrive already sorted. No rules to write, no receipts to tag.",
  },
];

export function Landing() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-16 sm:py-24">
      <h1 className="max-w-[18ch] text-[34px] leading-[1.15] font-semibold tracking-tight text-text sm:text-[42px]">
        {site.tagline}
      </h1>

      <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-text-muted">
        {site.name} reads your bank statements and shows you the year they add
        up to — what came in, what went out, and where it went.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/register"
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-medium text-text transition-colors hover:bg-surface-muted"
        >
          Sign in
        </Link>
      </div>

      <ul className="mt-16 grid gap-5 sm:grid-cols-3">
        {POINTS.map((point) => (
          <li key={point.title} className="card p-5">
            <h2 className="text-[14.5px] font-semibold text-text">
              {point.title}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-muted">
              {point.body}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
