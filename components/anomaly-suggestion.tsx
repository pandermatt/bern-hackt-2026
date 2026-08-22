import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Prompts for a first anomaly scan.
 *
 * Findings are precomputed rather than derived at render time, so a fresh
 * account shows no anomaly badges at all — which looks identical to an account
 * with nothing wrong. This is what tells those apart, and it only appears when
 * no scan has ever completed. Once one has, silence is a real answer and the
 * prompt stays gone even if the scan found nothing.
 *
 * A server component: it renders a link, not a control. The scan itself is
 * started from `/account`, where the progress bar lives.
 */
export function AnomalySuggestion({
  running,
  transactionCount,
}: {
  running: boolean;
  transactionCount: number;
}) {
  const t = useTranslations("AnomalySuggestion");

  return (
    // `.on-brand` re-points the text tokens for a Supernova ground, so this
    // stays legible in both themes without hardcoding a colour — see the note
    // in app/globals.css. `bg-brand` is the identity colour, not a surface.
    <section className="on-brand card border-brand bg-brand px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex items-start gap-2.5">
          {/* Decorative: the heading beside it carries the meaning, and it is
              aria-hidden, so the icon is not load-bearing for anyone. White on
              Supernova is only 1.5:1, so the stroke is thickened a little to
              hold its shape against the yellow. */}
          <Sparkles
            aria-hidden="true"
            strokeWidth={2.25}
            className="mt-0.5 size-[18px] shrink-0 text-white"
          />
          <div>
            <p className="text-[14px] font-semibold text-text">
              {running ? t("runningTitle") : t("title")}
            </p>
            <p className="mt-0.5 max-w-[64ch] text-[13px] text-text-muted">
              {running
                ? t("runningBody")
                : /* One message, not three fragments: German puts the verb at
                     the end, so a sentence spliced around a number in English
                     word order cannot be translated into it. */
                  t("body", { count: transactionCount.toLocaleString("de-CH") })}
            </p>
          </div>
        </div>

        {!running && (
          <Link
            href="/account#anomaly-scan"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-text px-3.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-85 max-sm:w-full sm:h-9"
          >
            {t("cta")}
          </Link>
        )}
      </div>
    </section>
  );
}
