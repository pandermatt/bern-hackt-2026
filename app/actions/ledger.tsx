"use server";

import { LedgerChunk } from "@/components/ledger-chunk";

import { getLedgerChunk } from "./transactions";

/**
 * The next chunk of the ledger, as rendered output rather than as data.
 *
 * This is what keeps the infinite scroll honest against the rule the rest of
 * the dashboard follows: no copy of anyone's finances in a client bundle. The
 * feed that calls this is a client component, but what comes back is a
 * server-rendered element — the transactions are never client state, exactly as
 * they are not on the first paint.
 *
 * The chunk is a whole number of months, so appending it can never disturb the
 * month panel above it; `monthAlignedChunk` in lib/insights.ts has the why.
 */
export async function loadLedgerChunk(
  offset: number,
  filters: unknown,
): Promise<{ content: React.ReactNode; nextOffset: number | null }> {
  const chunk = await getLedgerChunk(offset, filters);
  if (!chunk) return { content: null, nextOffset: null };

  return {
    content: (
      <LedgerChunk
        rows={chunk.rows}
        anomalies={chunk.anomalies}
        monthTotals={chunk.monthTotals}
        continuesFrom={chunk.continuesFrom}
        continuesInto={chunk.continuesInto}
      />
    ),
    nextOffset: chunk.nextOffset,
  };
}
