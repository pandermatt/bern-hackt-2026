"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { FLASH_MESSAGES, FLASH_PARAM, type FlashKey } from "@/lib/flash";

/**
 * Raises the toast named by `?flash=` and then removes the parameter, so a
 * refresh or a back-navigation doesn't replay it. Renders nothing.
 */
export function FlashToaster() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const key = params.get(FLASH_PARAM);
  // Guards against React's double-invoked effects in development.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!key || shown.current === key) return;

    const message = FLASH_MESSAGES[key as FlashKey];
    if (!message) return;

    shown.current = key;
    toast.success(message);
    router.replace(pathname);
  }, [key, pathname, router]);

  return null;
}
