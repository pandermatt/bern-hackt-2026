import { Moon } from "lucide-react";
import { useTranslations } from "next-intl";

import { site } from "@/lib/site";

/**
 * What stands where the sign-up buttons stand, on the copy of the landing page
 * the edge serves while the demo server does not exist.
 *
 * One component in both call-to-action slots — the hero and the yellow band —
 * so the page cannot explain itself twice in two different ways. It is drawn
 * entirely in tokens, which is what lets it sit on the band: `.on-brand`
 * re-points `--text`, `--bg` and `--surface` inside that section, so
 * `bg-surface` is a white card on the hero and stays a white card on Supernova
 * rather than following the theme into near-black.
 *
 * Server-safe and free of `"use client"`, like `SignupContact` — the address
 * comes from `site.contactEmail` rather than the catalogs, for the same reason
 * it does there: it is written once.
 */
export function DemoAsleepNotice({ className = "" }: { className?: string }) {
  const t = useTranslations("Landing");

  return (
    <div
      className={`rounded-lg border border-line bg-surface p-4 text-left ${className}`}
    >
      <p className="flex items-center gap-2 text-[14px] font-semibold text-text">
        <Moon className="size-4 shrink-0 text-text-subtle" aria-hidden="true" />
        {t("asleepTitle")}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
        {t("asleepBody")}
      </p>
      <p className="mt-2.5 text-[13px] text-text-muted">
        {t.rich("asleepContact", {
          email: site.contactEmail,
          mail: (chunks) => (
            <a
              href={`mailto:${site.contactEmail}`}
              /* `whitespace-nowrap` for the same reason `SignupContact` carries
                 it: half an email address at the end of a line reads as a
                 typo, and 18 characters fit on their own line at every width
                 this box has. */
              className="font-medium whitespace-nowrap text-accent hover:text-accent-hover hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
