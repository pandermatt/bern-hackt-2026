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
  startYear?: number;
  yearsCount?: number;
  targetCount?: number;
}): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be signed in to perform this action." };
  }

  try {
    const { count } = await saveGeneratedTransactionsForUser(user.id, options);
    revalidatePath("/");
    revalidatePath("/account");
    const yearsText =
      options?.yearsCount && options.yearsCount > 1
        ? `${options.yearsCount} years (from ${options.startYear ?? 2025})`
        : `year ${options?.startYear ?? 2025}`;

    return {
      success: true,
      message: `Successfully generated ${count.toLocaleString()} transactions across ${yearsText} with rich anomalies!`,
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
    revalidatePath("/");
    revalidatePath("/account");
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
