"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { usePathname, useRouter } from "@/i18n/navigation";
import { FLASH_MESSAGES, FLASH_PARAM, type FlashKey } from "@/lib/flash";

/**
 * Raises the toast named by `?flash=` and then removes the parameter, so a
 * refresh or a back-navigation doesn't replay it. Renders nothing.
 */
export function FlashToaster() {
  const t = useTranslations("AuthErrors");
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const key = params.get(FLASH_PARAM);
  // Guards against React's double-invoked effects in development.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!key || shown.current === key) return;

    const messageKey = FLASH_MESSAGES[key as FlashKey];
    if (!messageKey) return;

    shown.current = key;
    toast.success(t(messageKey));
    // `pathname` here is locale-free and `router` re-prefixes it, so stripping
    // the parameter does not also strip the language.
    router.replace(pathname);
  }, [key, pathname, router, t]);

  return null;
}
