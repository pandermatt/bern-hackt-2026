import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { isDemoAsleep } from "@/lib/demo-asleep";

export async function generateMetadata({ params }: PageProps<"/[locale]/offline">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("offline") };
}

/**
 * The page for "this address is real and is not answering right now", which
 * happens for two different reasons.
 *
 * `public/sw.js` precaches it and serves it when a navigation fails, so the
 * default copy is about the *reader's* connection. Fetched with
 * `credentials: "omit"` at install time, so the copy in Cache Storage is
 * always the signed-out render — no account's data is stored on disk.
 *
 * `asleep` is the other reason: the demo server exists for a few hours every
 * few months and the edge is answering in its place (`lib/demo-asleep.ts`).
 * Telling that reader to check their connection would be a wrong answer they
 * could waste real time on, so the same page says the other true thing
 * instead. The header's sign-in links go with it, since that is the state they
 * would be leading into.
 */
export default async function OfflinePage() {
  const asleep = await isDemoAsleep();
  return <OfflineCard asleep={asleep} />;
}

function OfflineCard({ asleep }: { asleep: boolean }) {
  const t = useTranslations("Errors");
  const key = asleep
    ? { eyebrow: "asleepEyebrow", title: "asleepTitle", body: "asleepBody" }
    : { eyebrow: "offlineEyebrow", title: "offlineTitle", body: "offlineBody" };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <p className="font-mono text-[12px] text-text-subtle">{t(key.eyebrow)}</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-text">
          {t(key.title)}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          {t(key.body)}
        </p>
      </div>
    </main>
  );
}
