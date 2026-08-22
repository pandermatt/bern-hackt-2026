"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSwitch = (newLocale: string) => {
    // Swap the current locale prefix with the new one
    const newPathname = pathname.replace(/^\/(de|en)/, `/${newLocale}`);
    const qs = searchParams.toString();
    router.push(newPathname + (qs ? `?${qs}` : ""));
  };

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-muted/50 p-1">
      {["de", "en"].map((l) => {
        const selected = locale === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => handleSwitch(l)}
            className={`flex cursor-pointer items-center justify-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
              selected
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
