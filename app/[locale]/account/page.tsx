import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyScanState } from "@/app/actions/anomalies";
import { getMerchantMapping } from "@/app/actions/merchant-overrides";
import { getTransactionAccounts } from "@/app/actions/transactions";
import { AnomalyScanControls } from "@/components/anomaly-scan-controls";
import { ClearTransactions } from "@/components/clear-transactions";
import { CsvUpload } from "@/components/csv-upload";
import { DangerZone } from "@/components/danger-zone";
import { DemoDataControls } from "@/components/demo-data-controls";
import { InstallApp } from "@/components/install-app";
import { LanguageSelector } from "@/components/language-selector";
import { MerchantMapper } from "@/components/merchant-mapper";
import { ProfileSettings } from "@/components/profile-settings";
import { PushBroadcast } from "@/components/push-broadcast";
import { PushNotifications } from "@/components/push-notifications";
import { Section } from "@/components/section";
import { SETTINGS_GROUP, SettingsRow } from "@/components/settings-row";
import { ThemeSetting } from "@/components/theme-setting";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { pushBroadcastEnabled, pushPublicKey } from "@/lib/push";

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
 * - **Preferences** — this browser only, which is literally what every row
 *   says: the theme applies here, the language is remembered here, installing
 *   puts the app on this device, and a push subscription belongs to this
 *   browser rather than to the account.
 * - **Data** — the statements in the account and what has been made of them:
 *   the anomaly scan, then the three ways of importing rows.
 * - **Merchants** — the importer's two shipped answers about a merchant, given
 *   again per account: which category its lines belong to, and where its logo
 *   comes from. A fifth group rather than a row inside Data, because it is a
 *   table of merchants rather than a setting with a control beside it — and
 *   because it reaches the ledger, the charts and the budget, which nothing
 *   else on this page does.
 * - **Danger zone** — clearing the statements, then deleting the account.
 *
 * The `h1` is the dashboard's 30/36px, not the 22px it was: at 22px the page
 * was headed by something smaller than its own section headings.
 */
export default async function AccountPage({
  params,
  searchParams,
}: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  // The literal string, the way `showResolved` and `includeTransfers` are
  // read. `/home`'s merchant nudge links here with it, because the panel is
  // folded by default and a link that lands on a closed box has not arrived.
  const { merchants: merchantsParam } = await searchParams;
  // `getTranslations`, not `useTranslations`: this component is async, and a
  // hook cannot be called across an await.
  const t = await getTranslations({ locale, namespace: "Account" });

  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  // Resolved on the server: the controls poll a run's *progress*, which says
  // nothing about whether the statements have moved on since it finished.
  const { outdated } = await getAnomalyScanState();

  // Null only for a signed-out reader, which the redirect above has already
  // ruled out; the fallback keeps the group rendering its own empty line
  // rather than making the page's shape depend on it.
  const mapping = await getMerchantMapping();

  // Names and row counts, not rows: what the clear control has to say before
  // it is pressed is how much would go, and from where.
  const accounts = await getTransactionAccounts();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
        {/* A flourish, not a divider — the brand's whole colour range at
            once, under the one line on the page that names it. Decorative and
            `aria-hidden`: nothing here has to be told apart, which is what
            makes the ramp safe to use as a sweep. See `globals.css`. */}
        <div className="rainbow-underline mt-2 w-24" aria-hidden />
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

          {/* Read here rather than in the component: the key is a runtime
              value on the host, so it must not be a NEXT_PUBLIC_ variable
              baked into the build. Null means push is not configured, and
              the row says so instead of offering a button that throws. */}
          <PushNotifications publicKey={pushPublicKey()} />

          {/* A demo control, off unless PUSH_BROADCAST_ENABLED=1 says
              otherwise — it pushes to every subscribed device on the
              deployment, not just this account's. The action checks the same
              flag, since not rendering a button does not make a server
              action unreachable. */}
          {pushBroadcastEnabled() && <PushBroadcast />}
        </Section>

        {/* `/anomalies` links here twice. The anchor sits on the group rather
            than on the scan row so the heading lands under the sticky header
            with the row it names; `scroll-mt-20` clears the h-16 header. */}
        <div id="anomaly-scan" className="scroll-mt-20">
          <Section id="data" heading={t("data")} panelClassName={SETTINGS_GROUP}>
            <AnomalyScanControls outdated={outdated} />
            <DemoDataControls />
            {/* Last of the three, and the only one that adds rather than
                replaces: the two above are demo fixtures, this is somebody's
                actual statement. */}
            <CsvUpload />
          </Section>
        </div>

        {/* The anchor sits on the group rather than on the panel, so a link
            lands on the heading and not mid-list; `scroll-mt-20` clears the
            h-16 header. Same shape as `#anomaly-scan` above. */}
        <div id="merchants" className="scroll-mt-20">
          <Section
            id="merchants"
            heading={t("merchants")}
            meta={t("merchantsNote")}
            panelClassName={SETTINGS_GROUP}
          >
            <MerchantMapper
              mapping={
                mapping ?? { open: [], filed: [], categories: [], unfiled: "Other" }
              }
              defaultOpen={merchantsParam === "open"}
            />
          </Section>
        </div>

        <Section
          id="danger-zone"
          heading={t("dangerZone")}
          panelClassName={SETTINGS_GROUP}
        >
          {/* Red label, grey panel: the group is the same shape as the
              three above it, and the destructive row carries the warning in
              its own colour rather than in a differently-coloured card.
              The two rows are in ascending order of what they take: the
              statements, then the login and the statements with it. */}
          <ClearTransactions accounts={accounts} />

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
