import { ShieldCheck, Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import { LanguageSelector } from "@/components/language-selector";
import type { User } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { site } from "@/lib/site";
import pkg from "@/package.json";

/**
 * Two layouts, one footer.
 *
 * From `sm` up it is the two-column bar it has always been: brand on the left,
 * a wrapped row of chips and links on the right. Below `sm` those columns
 * cannot coexist — the brand line alone ("Beyond Money · Private spending
 * insights from your own statements.") is wider than a 375px screen, and the
 * meta row collapsed into a ragged centred pile of a badge, a language pill,
 * two 12px text links and a version string.
 *
 * The mobile layout stacks instead, in three bands: the brand, then the badge
 * beside the language pill, then the two links as real controls. The inner
 * groups that make those bands wear `sm:contents`, so at `sm` they stop
 * generating a box and their children rejoin the parent row — one DOM for both
 * layouts rather than two copies behind a breakpoint.
 */

/**
 * A footer link. `min-h-10` below `sm` is not a style choice: these are the
 * only navigation a signed-out visitor has down here, and at `text-xs` with no
 * padding the tap target was the height of the glyphs. The header's controls
 * solve it the same way, and both drop back to plain text from `sm` up, where
 * a pointer is doing the aiming.
 */
const FOOTER_LINK =
  "inline-flex min-h-10 items-center rounded-md px-2.5 text-[13px] text-text-muted transition-colors hover:bg-surface-muted hover:text-text sm:min-h-0 sm:rounded-none sm:px-0 sm:text-xs sm:hover:bg-transparent";

export function AppFooter({ user }: { user: User | null }) {
  const t = useTranslations("AppFooter");

  return (
    <footer className="w-full border-t border-line bg-surface py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-8">
        <div className="flex flex-col items-center gap-1.5 text-center sm:items-start sm:text-left">
          {/* Stacked on a phone, one line from `sm`. The separator goes with
              the single line — a `·` left hanging at the end of a wrapped line
              reads as a typo. */}
          <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-text sm:text-[14px]">
              {site.name}
            </span>
            <span className="hidden text-line-strong sm:inline">·</span>
            <span className="max-w-[38ch] text-[13px] text-text-muted">
              {t("tagline")}
            </span>
          </div>

          {/* Wraps rather than squeezing: the German line is half again as long
              as the English one, and the flag is the last thing that should be
              pushed off the edge. */}
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-xs text-text-subtle sm:justify-start">
            <span>{t("builtWith")}</span>
            <Heart className="size-3 text-red-500 fill-red-500 inline" />
            <span>{t("inSwitzerland")}</span>
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-3 text-xs font-medium text-text-muted sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center sm:gap-5">
          {/* Band one: the two pills, which are the same height and read as a
              pair. */}
          <div className="flex items-center gap-3 sm:contents">
            <div className="flex items-center gap-1 rounded-full border border-positive/25 bg-positive-soft px-2.5 py-1 text-positive">
              <ShieldCheck className="size-3.5" />
              <span>{t("clientScoped")}</span>
            </div>
            {/* Signed out, this is the only place to change language — signed
                in, it lives on /account instead, so the footer does not offer
                the same control twice. */}
            {!user && <LanguageSelector />}
          </div>

          {/* Band two. */}
          {!user && (
            <div className="flex items-center gap-1 sm:contents">
              <Link href="/login" className={FOOTER_LINK}>
                {t("signIn")}
              </Link>
              <Link href="/register" className={FOOTER_LINK}>
                {t("register")}
              </Link>
            </div>
          )}

          <span className="font-mono text-[11px] text-text-subtle">
            v{pkg.version}
          </span>
        </div>
      </div>
    </footer>
  );
}
