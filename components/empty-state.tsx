import { useTranslations } from "next-intl";

/**
 * A server component: there is nothing interactive here, and the entrance
 * animation this used to carry would ship the panel at `opacity: 0` during SSR.
 */
export function EmptyState() {
  const t = useTranslations("Ledger");
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-surface-muted">
        <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
          <circle
            cx="9"
            cy="9"
            r="5.5"
            stroke="var(--text-subtle)"
            strokeWidth="1.5"
          />
          <path
            d="M13.5 13.5 L17 17"
            stroke="var(--text-subtle)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <p className="mt-1 text-[14.5px] font-medium text-text">{t("emptyTitle")}</p>
      <p className="max-w-[34ch] text-[13.5px] text-text-muted">
        {t("emptyBody")}
      </p>
    </div>
  );
}
