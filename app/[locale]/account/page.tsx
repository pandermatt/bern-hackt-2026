import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyScanState } from "@/app/actions/anomalies";
import { AnomalyScanControls } from "@/components/anomaly-scan-controls";
import { DangerZone } from "@/components/danger-zone";
import { DemoDataControls } from "@/components/demo-data-controls";
import { LanguageSelector } from "@/components/language-selector";
import { ProfileSettings } from "@/components/profile-settings";
import { ThemeSetting } from "@/components/theme-setting";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("account") };
}

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  // `getTranslations`, not `useTranslations`: this component is async, and a
  // hook cannot be called across an await.
  const t = await getTranslations({ locale, namespace: "Account" });

  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  // Resolved on the server: the controls poll a run's *progress*, which says
  // nothing about whether the statements have moved on since it finished.
  const { outdated } = await getAnomalyScanState();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
        {t("title")}
      </h1>
      <p className="mt-1 text-[13.5px] text-text-muted">{user.email}</p>

      <div className="card mt-8 overflow-hidden border-line">
        <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-text">{t("profile")}</h2>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <div className="mt-3">
            <ProfileSettings user={user} />
          </div>
        </div>
      </div>

      {/* Demo and Synthetic Data Tools */}
      <DemoDataControls />

      <div className="card mt-8 overflow-hidden border-line">
        <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-text">{t("appearance")}</h2>
        </div>
        {/* Two rows, so the divider is the card's own line rather than a
            border on either row. Both wear the same segmented pill. */}
        <div className="divide-y divide-line">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div>
              <p className="text-[14px] font-medium text-text">{t("colourTheme")}</p>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {t("colourThemeNote")}
              </p>
            </div>
            <ThemeSetting />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div>
              <p className="text-[14px] font-medium text-text">{t("language")}</p>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {t("languageNote")}
              </p>
            </div>
            <LanguageSelector />
          </div>
        </div>
      </div>

      <AnomalyScanControls outdated={outdated} />

      <div className="card mt-8 overflow-hidden border-danger/30">
        <div className="border-b border-danger/20 bg-danger-soft px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-danger">
            {t("dangerZone")}
          </h2>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-[14px] font-medium text-text">{t("deleteAccount")}</p>
            <p className="mt-0.5 text-[13px] text-text-muted">
              {t("deleteAccountNote")}
            </p>
          </div>
          <DangerZone />
        </div>
      </div>
    </main>
  );
}

