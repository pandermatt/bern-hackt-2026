"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * Category names are **data**, not chrome: they are written into
 * `transactions.category` at import time by `scripts/lib/statement.ts`, in
 * English, and the ledger, the donut and the assistant all read them back.
 *
 * So they are translated at the point of display and nowhere else. The stored
 * value stays the key — which is what keeps `slotsOf` handing the same colour
 * to the same category in both languages, and keeps `?categories=Housing` a
 * working link whichever language wrote it.
 *
 * A category the catalog does not know (a hand-edited row, a new rule added
 * without a translation) falls through as itself rather than throwing.
 */
export function useCategoryLabel(): (key: string) => string {
  const t = useTranslations("Categories");

  return useCallback(
    (key: string) => (t.has(key) ? t(key) : key),
    [t],
  );
}
