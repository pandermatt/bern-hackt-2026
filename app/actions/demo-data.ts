"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { loadDemoCsvForUser } from "@/lib/demo-loader";
import { saveGeneratedTransactionsForUser } from "@/lib/synthetic-generator";

export type ActionState = {
  success: boolean;
  message: string;
  count?: number;
};

export async function generateSyntheticTransactionsAction(options?: {
  yearsCount?: number;
  targetCount?: number;
}): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be signed in to perform this action." };
  }

  try {
    // The window always ends today and runs backwards — the generator clamps
    // the counts, so a hand-crafted request cannot ask for an absurd volume.
    const yearsCount = Math.max(1, Math.min(options?.yearsCount ?? 1, 5));
    const { count } = await saveGeneratedTransactionsForUser(user.id, {
      yearsCount,
      targetCount: options?.targetCount,
    });
    // Every page sits under `/[locale]`, so the literal "/" and "/account"
    // these used to name match nothing. Revalidating the pattern covers both
    // languages at once.
    revalidatePath("/[locale]/dashboard", "page");
    revalidatePath("/[locale]/account", "page");
    // The import just re-bound (or dropped) every finding.
    revalidatePath("/[locale]/anomalies", "page");
    const yearsText =
      yearsCount > 1 ? `the last ${yearsCount} years` : "the last 12 months";

    return {
      success: true,
      message: `Successfully generated ${count.toLocaleString()} transactions covering ${yearsText} with rich anomalies!`,
      count,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to generate synthetic transactions.",
    };
  }
}

export async function loadDemoCsvAction(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be signed in to perform this action." };
  }

  try {
    const { count } = await loadDemoCsvForUser(user.id);
    revalidatePath("/[locale]/dashboard", "page");
    revalidatePath("/[locale]/account", "page");
    // The import just re-bound (or dropped) every finding.
    revalidatePath("/[locale]/anomalies", "page");
    return {
      success: true,
      message: `Successfully loaded ${count} demo transactions from CSV files!`,
      count,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to load demo CSV files.",
    };
  }
}
