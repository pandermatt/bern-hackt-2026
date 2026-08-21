import Link from "next/link";
import { ShieldCheck, Heart } from "lucide-react";

import pkg from "@/package.json";
import { site } from "@/lib/site";
import type { User } from "@/db/schema";

export function AppFooter({ user }: { user: User | null }) {
  return (
    <footer className="w-full border-t border-neutral-100 bg-white py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col sm:flex-row items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex flex-col items-center sm:items-start gap-1.5 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[14px] tracking-tight text-neutral-950">
              {site.name}
            </span>
            <span className="text-neutral-300">·</span>
            <span className="text-[13px] text-neutral-500">{site.description}</span>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-neutral-400">
            <span>Built with precision</span>
            <Heart className="size-3 text-red-500 fill-red-500 inline" />
            <span>in Zurich & Bern, Switzerland 🇨🇭</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-neutral-600">
          <div className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-full">
            <ShieldCheck className="size-3.5" />
            <span>Client-Scoped Privacy</span>
          </div>
          {!user && (
            <>
              <Link
                href="/login"
                className="text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                Register
              </Link>
            </>
          )}
          <span className="font-mono text-[11px] text-neutral-400">
            v{pkg.version}
          </span>
        </div>
      </div>
    </footer>
  );
}
