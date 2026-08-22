import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyScanState } from "@/app/actions/anomalies";
import { AnomalyScanControls } from "@/components/anomaly-scan-controls";
import { DangerZone } from "@/components/danger-zone";
import { DemoDataControls } from "@/components/demo-data-controls";
import { InstallApp } from "@/components/install-app";
import { LanguageSelector } from "@/components/language-selector";
import { ProfileSettings } from "@/components/profile-settings";
import { Section } from "@/components/section";
import { SETTINGS_GROUP, SettingsRow } from "@/components/settings-row";
import { ThemeSetting } from "@/components/theme-setting";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("account") };
}

/**
 * Settings, as four groups rather than six cards.
 *
 * The page used to be a stack of `.card`s, each drawing its own header bar,
 * and each control component drawing its own box — so "Appearance" and
 * "Language" were one card while the theme, the install prompt and the scan
 * were three more, and nothing said which settings belonged together. It now
 * uses the dashboard's own idiom (`components/section.tsx`: a big heading on
 * the page's ground over a grey panel) with `SettingsRow` inside, and the
 * grouping answers *what a setting reaches*:
 *
 * - **Profile** — the account itself. The only thing here that writes to
 *   `users`.
 * - **Preferences** — this browser only, which is literally what all three
 *   rows say: the theme applies here, the language is remembered here, and
 *   installing puts the app on this device.
 * - **Data** — the statements in the account and what has been made of them:
 *   the anomaly scan, then the two ways of importing rows.
 * - **Danger zone** — deleting the account.
 *
 * The `h1` is the dashboard's 30/36px, not the 22px it was: at 22px the page
 * was headed by something smaller than its own section headings.
 */
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
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
        <p className="mt-1 text-[13.5px] text-text-muted">{user.email}</p>
      </div>

      {/* No `space-y`: every `Section` carries its own `pt-6`, so the page runs
          on one rhythm rather than two stacked ones. */}
      <div>
        {/* The form owns the panel's dividers — the two fields and Save have to
            share one `<form>`. */}
        <Section id="profile" heading={t("profile")}>
          <ProfileSettings user={user} />
        </Section>

        <Section
          id="preferences"
          heading={t("preferences")}
          panelClassName={SETTINGS_GROUP}
        >
          <SettingsRow label={t("colourTheme")} note={t("colourThemeNote")}>
            <ThemeSetting />
          </SettingsRow>

          <SettingsRow label={t("language")} note={t("languageNote")}>
            <LanguageSelector />
          </SettingsRow>

          <InstallApp />
        </Section>

        {/* `/anomalies` links here twice. The anchor sits on the group rather
            than on the scan row so the heading lands under the sticky header
            with the row it names; `scroll-mt-20` clears the h-16 header. */}
        <div id="anomaly-scan" className="scroll-mt-20">
          <Section id="data" heading={t("data")} panelClassName={SETTINGS_GROUP}>
            <AnomalyScanControls outdated={outdated} />
            <DemoDataControls />
          </Section>
        </div>

        <Section
          id="danger-zone"
          heading={t("dangerZone")}
          panelClassName={SETTINGS_GROUP}
        >
          {/* Red label, grey panel: the group is the same shape as the
              three above it, and the destructive row carries the warning in
              its own colour rather than in a differently-coloured card. */}
          <SettingsRow
            label={<span className="text-danger">{t("deleteAccount")}</span>}
            note={t("deleteAccountNote")}
          >
            <DangerZone />
          </SettingsRow>
        </Section>
      </div>
    </main>
  );
}
