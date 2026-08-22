import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import { LanguageSelector } from "@/components/language-selector";
import { LogoMark } from "@/components/logo";
import { Link } from "@/i18n/navigation";
import { site } from "@/lib/site";
import pkg from "@/package.json";

/**
 * Two layouts, one footer.
 *
 * From `sm` up it is a two-column bar: the signet and the wordmark on the
 * left over the "built with ♥" line, a row of controls on the right. Below
 * `sm` the same three bands stack and centre.
 *
 * It carries the identity and nothing else. The tagline and the privacy chip
 * that used to sit here said, in the footer's smallest type, what the landing
 * page already says at full size — and a claim about where the data lives is
 * worth more on a page somebody is reading than in a line under it.
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

/**
 * No `user` prop, and it cannot have one: this renders from
 * `app/[locale]/page.tsx` alone, and that route redirects anyone with a
 * session to /home before it gets here. Everything below is therefore the
 * signed-out arrangement, which used to be half of a conditional.
 */
export function AppFooter() {
  const t = useTranslations("AppFooter");

  return (
    /* Rendered by the landing route and nowhere else. It is the marketing
       footer, and under the ledger or the budget page it was a second, weaker
       navigation arguing with the header and the tab bar.

       No `app-shell:hidden` any more, either. That was there because the fixed
       tab bar covered the footer in the installed app; the bar only renders for
       a signed-in reader, and a signed-in reader is redirected off "/" to
       /home, so the two can no longer be on screen together. */
    <footer className="w-full border-t border-line bg-surface py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-6 px-5 sm:flex-row sm:px-8">
        <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          {/* Not a link: the header's wordmark already goes home, and it knows
              whether "home" is the landing or the dashboard. */}
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight text-text">
              {site.name}
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
          {/* Also in the header, which is where a visitor reading /login or
              /register now finds it — this footer does not reach those pages
              any more. Signed in, the control lives on /account instead, and
              a signed-in reader never sees this footer at all. */}
          <LanguageSelector />

          {/* The two links share a row of their own below `sm`; `sm:contents`
              drops the box at `sm` so they rejoin the parent row rather than
              needing a second copy behind a breakpoint.

              They used to be wrapped in `HideOnRoute`, so neither pointed at
              the page the reader was already on. That guard is gone with the
              footer's other routes: this only renders on "/", which is neither
              of them. */}
          <div className="flex items-center gap-1 sm:contents">
            <Link href="/login" className={FOOTER_LINK}>
              {t("signIn")}
            </Link>
            <Link href="/register" className={FOOTER_LINK}>
              {t("register")}
            </Link>
          </div>

          <span className="font-mono text-[11px] text-text-subtle">
            v{pkg.version}
          </span>
        </div>
      </div>
    </footer>
  );
}
