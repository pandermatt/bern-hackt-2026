import { formatMoney, type Totals } from "@/lib/insights";

/**
 * Salary and refunds are separate figures, not one "income" line. 35 of the 48
 * inflows in a year of these statements are shop credits — folding them
 * together would overstate earnings and make the salary number meaningless.
 */
export function SummaryCards({ totals }: { totals: Totals }) {
  const tiles = [
    {
      label: "Salary",
      value: totals.salary,
      tone: "positive" as const,
      note: "Employer payments",
    },
    {
      label: "Refunds",
      value: totals.refunds,
      tone: "neutral" as const,
      note: "Money returned by merchants",
    },
    {
      label: "Spending",
      value: totals.expense,
      tone: "negative" as const,
      note: `across ${totals.expenseCount.toLocaleString("de-CH")} purchases`,
    },
    {
      label: "Net",
      value: totals.net,
      tone: totals.net >= 0 ? ("positive" as const) : ("negative" as const),
      note: totals.net >= 0 ? "Put aside" : "Overspent",
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <li
          key={tile.label}
          /* The ledger's panel, in tile form: grey ground, no border and no
             shadow. The page heading above is the "big text outside" half of
             the idiom — these four do not each need one. */
          className="rounded-lg bg-surface-muted p-3.5 sm:p-4"
        >
          <p className="text-[13px] font-medium text-text-muted">{tile.label}</p>
          <p
            /* 16px, not the desktop 20px: a half-width tile at 390px has
               ~141px of inner box, and `−CHF 92’969.40` — a negative Net, which
               is the "Overspent" case and not an exotic one — is 14 characters
               of Plex Mono. 20px would need 168px. */
            className={`mt-1.5 font-mono text-[16px] leading-none font-medium tracking-tight tabular-nums sm:text-[20px] ${
              tile.tone === "positive"
                ? "text-positive"
                : tile.tone === "negative"
                  ? "text-danger"
                  : "text-text"
            }`}
          >
            {/* The formatter is unsigned; the glyph is a real minus sign
                (U+2212), not a hyphen, so it lines up with the digits. */}
            {tile.value < 0 ? "−" : ""}
            {formatMoney(tile.value)}
          </p>
          <p className="mt-2 text-[12.5px] text-text-subtle">{tile.note}</p>
        </li>
      ))}
    </ul>
  );
}
