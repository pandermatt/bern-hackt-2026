import { ArrowRight, CheckCircle2, PiggyBank } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyScanState } from "@/app/actions/anomalies";
import { getSavingsGoalNames } from "@/app/actions/savings";
import { getTransactionCount } from "@/app/actions/transactions";
import { AnomalySuggestion } from "@/components/anomaly-suggestion";
import { CsvUpload } from "@/components/csv-upload";
import { OnboardingDemoData } from "@/components/onboarding-demo-data";
import { SavingsGoalForm } from "@/components/savings-goal-form";
import { Section } from "@/components/section";
import { SETTINGS_GROUP } from "@/components/settings-row";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("onboarding") };
}

/**
 * Where signing up lands, and the only page that does.
 *
 * A new account arrives with nothing in it, and `/home` has nothing to say to
 * that — the nudge deck ranks an empty account as "nothing needs your attention
 * today", which is true and useless. This is what has to happen before any other
 * page in the app means anything, in order: statements in, the analysis over
 * them, then the one thing the statements cannot answer on their own — what the
 * account holder is actually saving for.
 *
 * It is skippable on purpose. Done is a plain link, live from the moment the
 * page loads, and the header and tab bar are right there anyway — a first-run
 * page that traps you is worse than one you can walk out of and come back to via
 * `/account`, which carries all of this permanently.
 *
 * Signing *in* still lands on `/home`: this is what a new account needs, not
 * what a returning one does.
 */
export default async function OnboardingPage({
  params,
}: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  // `getTranslations`, not `useTranslations`: this component is async, and a
  // hook cannot be called across an await.
  const t = await getTranslations({ locale, namespace: "Onboarding" });

  // The proxy only sniffs for a cookie, and its public list is an allowlist —
  // this route is protected by not being on it. This is the authoritative check.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const [count, scan, goals] = await Promise.all([
    getTransactionCount(),
    getAnomalyScanState(),
    getSavingsGoalNames(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
        {/* The dashboard's flourish, under the one line that names the page.
            Decorative and `aria-hidden` — see the note in globals.css. */}
        <div className="rainbow-underline mt-2 w-24" aria-hidden />
        <p className="mt-1 max-w-[64ch] text-[13.5px] text-text-muted">
          {t("intro")}
        </p>
      </div>

      {/* No `space-y`: every `Section` carries its own `pt-6`, so the page runs
          on one rhythm rather than two stacked ones. */}
      <div>
        <Section
          id="import"
          heading={t("importHeading")}
          meta={t("stepMeta", { step: 1 })}
          panelClassName={SETTINGS_GROUP}
        >
          {/* The account page's own row, dropped in whole — it takes no props
              and brings its own dialog, parser and strings. The file is read in
              the browser; nothing leaves the device until import is pressed. */}
          <CsvUpload />
          {/* And the fallback for someone with no statement to hand. */}
          <OnboardingDemoData />
        </Section>

        {/* No grey ground here, the way `/anomalies/[ruleId]` drops it: the
            yellow card below is a `.card` in its own right, and a card inside a
            panel reads as neither. `overflow-visible` so the panel's clip does
            not cut the card's shadow. The two text states carry the panel
            themselves instead. */}
        <Section
          id="analyse"
          heading={t("analyseHeading")}
          meta={t("stepMeta", { step: 2 })}
          panelClassName="bg-transparent overflow-visible"
        >
          {count === 0 ? (
            // A scan over nothing has nothing to say, so the offer is not made
            // until there is something to make it about. Importing above calls
            // `router.refresh()`, and this page is `force-dynamic`, so the card
            // arrives on its own.
            <p className="rounded-lg bg-surface-muted px-4 py-3.5 text-[13px] text-text-muted sm:px-5">
              {t("analyseEmpty")}
            </p>
          ) : !scan.hasCompletedScan || scan.outdated ? (
            // The dashboard's own gate, and the dashboard's own card.
            <AnomalySuggestion
              running={scan.running}
              outdated={scan.outdated}
              transactionCount={count}
            />
          ) : (
            // The card asks for a refresh when a scan finishes, which is what
            // takes it off the page — so this is what it turns into. Without it
            // the step would drop back to "nothing has been analysed yet", which
            // reads as the scan having been thrown away.
            <p className="flex items-center gap-2 rounded-lg bg-surface-muted px-4 py-3.5 text-[13px] text-text sm:px-5">
              <CheckCircle2 className="size-4 shrink-0 text-accent" aria-hidden />
              {t("analyseDone")}
            </p>
          )}
        </Section>

        {/* The one thing the statements cannot answer on their own. It asks for
            a single goal and then stops asking — `/savings` is where a second
            one goes, and a first-run page that keeps presenting an empty form
            reads as a chore with no end. */}
        <Section
          id="savings"
          heading={t("savingsHeading")}
          meta={t("stepMeta", { step: 3 })}
        >
          {goals.length === 0 ? (
            <>
              <p className="px-4 py-3.5 text-[13px] text-text-muted sm:px-5">
                {t("savingsNote")}
              </p>
              {/* The savings page's own form, dropped in whole — it takes no
                  props and carries its own `border-t`, which is why the note
                  above it is what that divider divides. */}
              <SavingsGoalForm />
            </>
          ) : (
            <p className="flex items-center gap-2 px-4 py-3.5 text-[13px] text-text sm:px-5">
              <PiggyBank className="size-4 shrink-0 text-accent" aria-hidden />
              {t("savingsDone", { name: goals[0] })}
            </p>
          )}
        </Section>
      </div>

      {/* Always live. See the note above: this page does not hold anyone. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-8">
        <Link
          href="/home"
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13.5px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover max-sm:w-full sm:h-9"
        >
          {t("done")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <p className="text-[12.5px] text-text-muted">{t("doneNote")}</p>
      </div>
    </main>
  );
}
