"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { loadDemoCsvAction } from "@/app/actions/demo-data";

/**
 * The way out of onboarding for someone who has no statement to hand.
 *
 * Deliberately lighter than the `CsvUpload` row above it in the same panel: no
 * `SettingsRow` label, one muted sentence, and the secondary button treatment.
 * Uploading your own statements is what the page is for — this is the fallback,
 * and it should read like one.
 *
 * It loads the shipped demo statements and nothing else. The synthetic
 * generator stays on `/account`: a first-run page is not the place to be asked
 * how many years of invented transactions you would like.
 *
 * Not a prop on `DemoDataControls`. That component shares one `isBusy` and one
 * status line across the generator row and the demo row, so slicing the
 * generator out of it would destabilise the settings page to save a
 * `useTransition` — and the copy, the weight and the chrome all differ here
 * anyway.
 */
export function OnboardingDemoData() {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      try {
        const result = await loadDemoCsvAction();
        if (!result.success) {
          toast.error(result.message);
          return;
        }
        toast.success(result.message);
        // The page is `force-dynamic` and reads the account's transaction count
        // to decide whether to offer the analysis, so this is what makes the
        // yellow card appear underneath.
        router.refresh();
      } catch {
        toast.error(t("demoError"));
      }
    });
  }

  return (
    // `SettingsRow`'s own padding rather than the component itself: the panel's
    // `divide-surface` line has to land level with the row above, and this one
    // carries a sentence where that one carries a label.
    <div className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="min-w-0 flex-1 basis-[15rem] text-[13px] text-text-muted">
          {t("demoNote")}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50 max-sm:w-full sm:h-9"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("demoLoading")}
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-3.5" aria-hidden />
              {t("demoCta")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
