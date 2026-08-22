import { ArrowRight, PiggyBank, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { AnomalyIcon } from "@/components/anomaly-icon";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/insights";
import type { NudgeSpec } from "@/lib/nudges";

/**
 * One line of "here is something worth knowing", with somewhere to go.
 *
 * A synchronous server component, so `useTranslations` is the right call —
 * same shape the client components use, no hydration boundary for a static
 * row. Every nudge carries a destination: a warning with no next step is just
 * a worse version of the number it came from.
 *
 * The card keeps `bg-surface` rather than sitting straight on the page's
 * pistachio gradient. Pistachio is 2:1 on white and is a fill, never a ground
 * for type — see the palette note in the house rules.
 */
export function NudgeCard({ nudge }: { nudge: NudgeSpec }) {
  const t = useTranslations("Home");

  const warning = nudge.tone === "warning";
  const tint = warning
    ? "bg-danger-soft text-danger"
    : "bg-positive-soft text-positive";

  let icon;
  let title;
  let body;
  let href;

  if (nudge.kind === "over-budget") {
    icon = <TrendingUp className="size-4" aria-hidden />;
    title = t("overBudgetTitle", { category: nudge.category });
    body = t("overBudgetBody", { amount: formatMoney(nudge.overMinor) });
    href = "/budget";
  } else if (nudge.kind === "anomaly") {
    icon = <AnomalyIcon name={nudge.icon} className="size-4" />;
    // Already in the reader's language — the engine stores locale-neutral
    // params and `app/actions/anomalies.ts` renders them.
    title = nudge.title;
    body = nudge.description;
    href = `/anomalies/${nudge.ruleId}`;
  } else {
    icon = <PiggyBank className="size-4" aria-hidden />;
    title = t("freeMoneyTitle", { amount: formatMoney(nudge.amountMinor) });
    body = t("freeMoneyBody", { month: nudge.month });
    href = "/budget#savings";
  }

  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong"
    >
      <span
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${tint}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] leading-snug font-semibold text-text">
          {title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-text-muted">
          {body}
        </span>
      </span>
      <ArrowRight
        className="mt-1 size-4 shrink-0 text-text-subtle"
        aria-hidden
      />
    </Link>
  );
}
