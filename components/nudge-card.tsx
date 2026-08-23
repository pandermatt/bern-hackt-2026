import { ArrowRight, PiggyBank, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { AnomalyIcon } from "@/components/anomaly-icon";
import { NudgeAskButton } from "@/components/nudge-ask-button";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/insights";
import { monthLabel } from "@/lib/month-label";
import type { NudgeSpec } from "@/lib/nudges";

/**
 * One line of "here is something worth knowing", with somewhere to go.
 *
 * A synchronous server component, so `useTranslations` is the right call —
 * same shape the client components use, no hydration boundary for a static
 * row. Every nudge carries a destination: a warning with no next step is just
 * a worse version of the number it came from. For the warnings that is a
 * page; the free-money tip's destination is a *conversation* — a click asks
 * Batzi `Chat.suggestion4` directly (through the `NudgeAskButton` leaf and
 * the `askBatzi` seam), because "how should I split it" is the question the
 * card is really raising, and the assistant is the thing that answers it.
 *
 * The card keeps `bg-surface` rather than sitting straight on the page's
 * pistachio gradient. Pistachio is 2:1 on white and is a fill, never a ground
 * for type — see the palette note in the house rules.
 */

/* One shell for both elements, so the button variant cannot drift from the
   links. The button additions live at its call site: `w-full text-left`
   because a button centres and shrink-wraps where an anchor flows, and
   `cursor-pointer` because buttons do not get it for free. */
const CARD_SHELL =
  "flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong";

/** The card's face, shared by the link cards and the ask-Batzi button. */
function NudgeRow({
  icon,
  title,
  body,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tint: string;
}) {
  return (
    <>
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
    </>
  );
}

export function NudgeCard({ nudge }: { nudge: NudgeSpec }) {
  const t = useTranslations("Home");
  const tChat = useTranslations("Chat");
  const tMonths = useTranslations("Months");

  const warning = nudge.tone === "warning";
  const tint = warning
    ? "bg-danger-soft text-danger"
    : "bg-positive-soft text-positive";

  if (nudge.kind === "free-money") {
    return (
      /* `suggestion4` is the chat's own starter question for exactly this
         situation, phrased to hit the surplus tool's branch in `routeTool` —
         one string for the chip and the nudge, so the two can never ask
         differently. */
      <NudgeAskButton
        question={tChat("suggestion4")}
        className={`w-full cursor-pointer text-left ${CARD_SHELL}`}
      >
        <NudgeRow
          icon={<PiggyBank className="size-4" aria-hidden />}
          title={t("freeMoneyTitle", { amount: formatMoney(nudge.amountMinor) })}
          body={t("freeMoneyBody", { month: monthLabel(tMonths, nudge.month) })}
          tint={tint}
        />
      </NudgeAskButton>
    );
  }

  let icon;
  let title;
  let body;
  let href;

  if (nudge.kind === "over-budget") {
    icon = <TrendingUp className="size-4" aria-hidden />;
    title = t("overBudgetTitle", { category: nudge.category });
    body = t("overBudgetBody", { amount: formatMoney(nudge.overMinor) });
    href = "/budget";
  } else {
    icon = <AnomalyIcon name={nudge.icon} className="size-4" />;
    // Already in the reader's language — the engine stores locale-neutral
    // params and `app/actions/anomalies.ts` renders them.
    title = nudge.title;
    body = nudge.description;
    href = `/anomalies/${nudge.ruleId}`;
  }

  return (
    <Link href={href} className={CARD_SHELL}>
      <NudgeRow icon={icon} title={title} body={body} tint={tint} />
    </Link>
  );
}
