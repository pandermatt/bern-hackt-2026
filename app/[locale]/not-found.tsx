import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/** Renders inside the root layout, so it keeps the shared header and footer. */
export default function NotFound() {
  const t = useTranslations("Errors");
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <p className="font-mono text-[12px] text-text-subtle">404</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-text">
          {t("notFoundTitle")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          {t("notFoundBody")}
        </p>

        <Link
          href="/home"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
