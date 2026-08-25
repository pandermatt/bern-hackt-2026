import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getSavingsOverview } from "@/app/actions/savings";
import { DragonBuddy } from "@/components/dragon-buddy";
import { SavingsGoals } from "@/components/savings-goals";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/insights";
import { dragonForSavings, savingsVerdict } from "@/lib/nudges";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/savings">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("savings") };
}

/**
 * The pots, on their own page.
 *
 * They used to sit at the top of `/budget`, sharing its month picker — moved
 * here because the two are different questions ("what should I limit this
 * month" vs "what am I saving for"). Goals aren't month-scoped the way budget
 * limits are, so this page dropped the picker; it still resolves a `month`
 * from `searchParams` since `getSavingsOverview` is shared with the budget
 * page's data layer.
 */
export default async function SavingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/savings">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Savings" });

  // The proxy only sniffs for a cookie; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const { month: rawMonth } = await searchParams;
  const requested = typeof rawMonth === "string" ? rawMonth : undefined;
  const savings = await getSavingsOverview(requested);
  if (!savings) return redirect({ href: "/login", locale });

  const { month } = savings;

  /* The dragon's read on the pots, decided once in `lib/nudges.ts` so the
     picture and the sentence come from the same verdict rather than from two
     conditions that can drift apart. Same shape as `/budget` and
     `/anomalies`. */
  const verdict = savingsVerdict({
    pots: savings.pots,
    freeMinor: savings.freeMinor,
    pooledMinor: savings.pooledMinor,
  });
  const funded = savings.pots.filter(
    (pot) => pot.targetMinor > 0 && pot.savedMinor >= pot.targetMinor,
  ).length;
  const dragonLine =
    verdict === "no-goals"
      ? t("dragonNoGoals")
      : verdict === "overdrawn"
        ? t("dragonOverdrawn")
        : verdict === "free"
          ? t("dragonFree")
          : verdict === "funded"
            ? t("dragonFunded")
            : t("dragonSaving", { count: savings.pots.length });
  /* A figure worth naming, where there is one. "No goals" and an overdrawn
     pool both have nothing to add — the number that would go here is zero,
     and printing it says the sentence again. */
  const dragonNote =
    verdict === "free"
      ? t("dragonNoteFree", { amount: formatMoney(savings.freeMinor) })
      : verdict === "funded"
        ? t("dragonNoteFunded", { count: funded })
        : verdict === "saving"
          ? t("dragonNoteSaving", { amount: formatMoney(savings.allocatedMinor) })
          : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      {/* The dashboard's, the budget page's and the anomalies page's own
          heading size — see `components/section.tsx` for why a page heading
          and a Section heading are deliberately not the same size. */}
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("pageTitle")}
        </h1>
        {/* A flourish, not a divider — the brand's whole colour range at
            once, under the one line on the page that names it. Decorative and
            `aria-hidden`: nothing here has to be told apart, which is what
            makes the ramp safe to use as a sweep. See `globals.css`. */}
        <div className="rainbow-underline mt-2 w-24" aria-hidden />
        <p className="mt-1 text-[13.5px] text-text-muted">
          {month ? t("pageSubtitle") : t("pageSubtitleEmpty")}
        </p>
      </div>

      {/* Under the heading rather than among the pots, for the reason
          `/anomalies` gives: it is a read on the whole page, and a mascot
          inside the grid would look like one more goal. */}
      <div className="mb-6">
        <DragonBuddy
          mood={dragonForSavings(verdict)}
          line={dragonLine}
          note={dragonNote}
        />
      </div>

      <SavingsGoals overview={savings} />
    </main>
  );
}
