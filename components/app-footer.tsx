import Link from "next/link";
import { ShieldCheck, Heart } from "lucide-react";

import pkg from "@/package.json";
import { site } from "@/lib/site";

/*
 * Tokens rather than `neutral-*` literals: this footer arrived from a redesign
 * that predated the dark theme, and a hardcoded `bg-white` is a white slab
 * under a dark page. Each literal maps to the token that renders the same in
 * light mode. The privacy badge moves from emerald onto the app's own
 * `--positive` pair, which is the Pistachio family — a small hue shift, but it
 * is the documented "good" token and it is legible on both grounds.
 */

export function AppFooter() {
  return (
    <footer className="w-full border-t border-line bg-surface py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col sm:flex-row items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex flex-col items-center sm:items-start gap-1.5 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[14px] tracking-tight text-text">
              {site.name}
            </span>
            <span className="text-line-strong">·</span>
            <span className="text-[13px] text-text-muted">{site.description}</span>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-text-subtle">
            <span>Built with precision</span>
            <Heart className="size-3 text-red-500 fill-red-500 inline" />
            <span>in Zurich & Bern, Switzerland 🇨🇭</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-text-muted">
          <div className="flex items-center gap-1 text-positive bg-positive-soft border border-positive/25 px-2.5 py-1 rounded-full">
            <ShieldCheck className="size-3.5" />
            <span>Client-Scoped Privacy</span>
          </div>
          <Link
            href="/login"
            className="text-text-muted hover:text-text transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="text-text-muted hover:text-text transition-colors"
          >
            Register
          </Link>
          <span className="font-mono text-[11px] text-text-subtle">
            v{pkg.version}
          </span>
        </div>
      </div>
    </footer>
  );
}
