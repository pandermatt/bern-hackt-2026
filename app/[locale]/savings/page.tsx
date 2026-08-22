import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getSavingsOverview } from "@/app/actions/savings";
import { SavingsGoals } from "@/components/savings-goals";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

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

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      {/* The dashboard's, the budget page's and the anomalies page's own
          heading size — see `components/section.tsx` for why a page heading
          and a Section heading are deliberately not the same size. */}
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-[13.5px] text-text-muted">
          {month ? t("pageSubtitle") : t("pageSubtitleEmpty")}
        </p>
      </div>

      <SavingsGoals overview={savings} />
    </main>
  );
}
