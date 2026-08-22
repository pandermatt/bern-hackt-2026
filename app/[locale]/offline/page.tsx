import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/[locale]/offline">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("offline") };
}

/**
 * Precached by public/sw.js and served when a navigation fails. Fetched with
 * `credentials: "omit"` at install time, so the copy in Cache Storage is
 * always the signed-out render — no account's data is stored on disk.
 */
export default function OfflinePage() {
  const t = useTranslations("Errors");
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <p className="font-mono text-[12px] text-text-subtle">{t("offlineEyebrow")}</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-text">
          {t("offlineTitle")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          {t("offlineBody")}
        </p>
      </div>
    </main>
  );
}
