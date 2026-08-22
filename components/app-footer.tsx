import { ShieldCheck, Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import type { User } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { site } from "@/lib/site";
import pkg from "@/package.json";

export function AppFooter({ user }: { user: User | null }) {
  const t = useTranslations("AppFooter");
  return (
    <footer className="w-full border-t border-line bg-surface py-10 sm:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col sm:flex-row items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex flex-col items-center sm:items-start gap-1.5 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[14px] tracking-tight text-text">
              {site.name}
            </span>
            <span className="text-line-strong">·</span>
            <span className="text-[13px] text-text-muted">{site.description}</span>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-text-subtle">
            <span>{t("builtWith")}</span>
            <Heart className="size-3 text-red-500 fill-red-500 inline" />
            <span>{t("inSwitzerland")}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-text-muted">
          <div className="flex items-center gap-1 text-positive bg-positive-soft border border-positive/25 px-2.5 py-1 rounded-full">
            <ShieldCheck className="size-3.5" />
            <span>{t("clientScoped")}</span>
          </div>
          {!user && (
            <>
              <Link
                href="/login"
                className="text-text-muted hover:text-text transition-colors"
              >
                {t("signIn")}
              </Link>
              <Link
                href="/register"
                className="text-text-muted hover:text-text transition-colors"
              >
                {t("register")}
              </Link>
            </>
          )}
          <span className="font-mono text-[11px] text-text-subtle">
            v{pkg.version}
          </span>
        </div>
      </div>
    </footer>
  );
}
