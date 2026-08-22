import { useTranslations } from "next-intl";

import { SpendForecastChart } from "@/components/spend-forecast";
import { formatMoney, type SpendForecast, type Totals } from "@/lib/insights";

/**
 * The three figures the page is read for — money in, money out, what is left —
 * and one tile that looks forward instead of back.
 *
 * Refunds no longer have a tile of their own: 35 of the 48 inflows in a year of
 * these statements are shop credits, but they are a tenth of the money, and a
 * quarter of the summary row is more than that story is worth. They are still
 * never folded into salary *silently* — the house rule that matters — because
 * the Income tile's note breaks the two apart under the total.
 *
 * The fourth tile is the forecast: the average month's spending, over a
 * sparkline of the year the statements end in — booked to where they reach,
 * dashed to the end of that year, and no further. The dashed tail undulates
 * with the account's own seasonality, but its twelve factors average exactly
 * 1 — so the printed figure is the mean of the line above it and the note
 * under it is where the year lands.
 */
export function SummaryCards({
  totals,
  forecast,
}: {
  totals: Totals;
  forecast: SpendForecast | null;
}) {
  const t = useTranslations("Summary");

  const tiles = [
    {
      key: "income",
      label: t("income"),
      value: totals.income,
      tone: "positive" as const,
      note: t("incomeNote", {
        salary: formatMoney(totals.salary),
        refunds: formatMoney(totals.refunds),
      }),
      wide: false,
    },
    {
      key: "spending",
      label: t("spending"),
      value: totals.expense,
      tone: "negative" as const,
      // Grouped by the formatter rather than interpolated raw: a five-figure
      // purchase count reads as 12'480, the same way every other number on
      // this page does.
      note: t("spendingNote", {
        count: totals.expenseCount.toLocaleString("de-CH"),
      }),
      wide: false,
    },
    {
      key: "net",
      label: t("net"),
      value: totals.net,
      tone: totals.net >= 0 ? ("positive" as const) : ("negative" as const),
      note: totals.net >= 0 ? t("netPositive") : t("netNegative"),
      // A balance is the two tiles above it resolved; on a phone that reads as
      // a total line under them rather than as a third of a ragged row.
      wide: true,
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <li
          key={tile.key}
          /* The ledger's panel, in tile form: grey ground, no border and no
             shadow. The page heading above is the "big text outside" half of
             the idiom — these do not each need one.

             The row stretches to the forecast tile's height; the figures stay
             top-aligned inside it rather than spreading to fill, which is what
             keeps each note under its own number instead of 80px below it. */
          className={`rounded-lg bg-surface-muted p-3.5 sm:p-4 ${
            tile.wide ? "col-span-2 lg:col-span-1" : ""
          }`}
        >
          <p className="text-[13px] font-medium text-text-muted">
            {tile.label}
          </p>
          <p
            /* 16px, not the desktop 20px: a half-width tile at 390px has
               ~141px of inner box, and `−CHF 92’969.40` — a negative Balance,
               which is the "Overspent" case and not an exotic one — is 14
               characters of Plex Mono. 20px would need 168px. */
            className={`mt-1.5 font-mono text-[16px] leading-none font-medium tracking-tight tabular-nums sm:text-[20px] ${
              tile.tone === "positive" ? "text-positive" : "text-danger"
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

      <li className="col-span-2 rounded-lg bg-surface-muted p-3.5 sm:p-4 lg:col-span-1">
        <p className="text-[13px] font-medium text-text-muted">
          {t("forecast")}
        </p>
        {forecast ? (
          <>
            <p className="mt-1.5 font-mono text-[16px] leading-none font-medium tracking-tight tabular-nums text-text sm:text-[20px]">
              {formatMoney(forecast.average)}
            </p>

            {/* The canvas is a client component; the table under it is not.
                Every chart in this app ships the same figures as server-
                rendered HTML — see components/echart.tsx. */}
            <SpendForecastChart forecast={forecast} />

            {/* The wrapper div takes `sr-only` because a table ignores its
                1px width, and `aria-label` rather than `<caption>` because a
                caption box escapes the clipped area — Safari paints it as a
                stray line under the chart. Same contract as the two big
                charts' hidden tables. */}
            <div className="sr-only">
              <table
                aria-label={t("forecastLabel", {
                  year: forecast.year,
                  average: formatMoney(forecast.average),
                })}
              >
                <thead>
                  <tr>
                    <th scope="col">{t("forecastMonth")}</th>
                    <th scope="col">{t("forecastAmount")}</th>
                    <th scope="col">{t("forecastKind")}</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.points.map((point) => (
                    <tr key={point.month}>
                      <th scope="row">{point.month}</th>
                      <td>
                        {formatMoney(point.actual ?? point.projected ?? 0)}
                      </td>
                      <td>
                        {point.actual !== null
                          ? t("forecastActual")
                          : t("forecastProjected")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[12.5px] text-text-subtle">
              {t("forecastNote", {
                amount: formatMoney(forecast.yearTotal),
                year: forecast.year,
              })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] text-text-subtle">
            {t("forecastEmpty")}
          </p>
        )}
      </li>
    </ul>
  );
}
