"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { MAX_CSV_BYTES, type CsvMapping } from "@/lib/csv-import";
import { importUploadedCsv } from "@/lib/csv-upload";

/**
 * Uploading a statement.
 *
 * The **mutation** envelope, like `app/actions/savings.ts`: reads return data
 * directly, and this is the one thing here that writes. There is deliberately
 * no `previewCsvUpload` beside it — `lib/csv-import.ts` is pure and runs in
 * the browser, so the dialog draws its preview with no round trip and nothing
 * leaves the device until the reader confirms the mapping.
 */
export type CsvImportResult =
  | {
      ok: true;
      message: string;
      imported: number;
      duplicates: number;
      skipped: number;
      total: number;
    }
  | { ok: false; error: string };

/**
 * The mapping as the dialog posts it. Every field is a header from the file
 * the same request carries, so nothing here needs to exist in the database —
 * a header that does not match a column simply reads as empty and the line is
 * reported as unreadable rather than throwing.
 */
const mappingSchema = z.object({
  delimiter: z.string().length(1),
  date: z.string(),
  amount: z.string().nullable(),
  debit: z.string().nullable(),
  credit: z.string().nullable(),
  description: z.string(),
  currency: z.string().nullable(),
  invertSign: z.boolean(),
});

async function importError(key: string): Promise<CsvImportResult> {
  const t = await getTranslations("CsvImport");
  return { ok: false, error: t(key) };
}

/**
 * Import an uploaded CSV into the signed-in account.
 *
 * The account comes from the session and never from an argument: every export
 * of a `"use server"` module is an endpoint the browser can call with whatever
 * it likes, so a `userId` parameter here would be an open door onto anyone
 * else's ledger.
 */
export async function importCsvUpload(formData: FormData): Promise<CsvImportResult> {
  const user = await getCurrentUser();
  if (!user) return importError("errorSignedOut");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return importError("errorNoFile");
  if (file.size > MAX_CSV_BYTES) return importError("errorTooLarge");

  const mapping = mappingSchema.safeParse(safeJson(formData.get("mapping")));
  if (!mapping.success) return importError("errorMapping");

  const accountLabel = String(formData.get("account") ?? "");

  try {
    const text = await file.text();
    const result = importUploadedCsv(user.id, {
      text,
      mapping: mapping.data as CsvMapping,
      accountLabel,
    });

    if (result.imported === 0 && result.duplicates > 0) {
      // Not a failure: re-importing an overlapping month is the normal way to
      // catch up a statement, and it has to read as a no-op rather than an
      // error.
      const t = await getTranslations("CsvImport");
      return {
        ok: true,
        message: t("resultDuplicates", { count: result.duplicates }),
        ...result,
      };
    }

    if (result.imported === 0) return importError("errorNoRows");

    // Every page sits under `/[locale]`, so a literal "/account" matches
    // nothing. Revalidating the pattern covers both languages at once. The
    // anomalies page is in the list because the account's statements just
    // changed and its scan is now outdated.
    revalidatePath("/[locale]/dashboard", "page");
    revalidatePath("/[locale]/account", "page");
    revalidatePath("/[locale]/anomalies", "page");

    const t = await getTranslations("CsvImport");
    return {
      ok: true,
      message: t("resultImported", {
        count: result.imported,
        duplicates: result.duplicates,
        skipped: result.skipped,
      }),
      ...result,
    };
  } catch {
    return importError("errorUnexpected");
  }
}

/** A junk `mapping` field is a validation error, not a thrown request. */
function safeJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
