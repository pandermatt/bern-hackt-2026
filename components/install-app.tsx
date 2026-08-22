"use client";

import { Check, Download, Share, SquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SettingsRow } from "@/components/settings-row";
import { useHydrated } from "@/lib/use-hydrated";
import { CONTROL, useIosSafari, useStandalone } from "@/lib/use-install-state";

/**
 * The account page's "add to home screen" row, in the Preferences group —
 * installing is a per-browser choice, the same as the theme and the language
 * it sits with.
 *
 * Three mutually exclusive states, because there is no one control that works
 * everywhere:
 *
 * - **Chrome/Edge/Android** fire `beforeinstallprompt`, which is the only way
 *   to open the install dialog from a page. The event has to be captured when
 *   it fires — it cannot be requested later — so the listener is mounted here
 *   and the event is held until the button is pressed.
 * - **iOS Safari** implements no such API at all: installing is Share → Add to
 *   Home Screen, by hand. The best a page can do is say so, which is what the
 *   dialog does.
 * - **Everything else**, and Chrome once it has decided the app is already
 *   installed or not yet eligible, gets the note and no button. A control that
 *   cannot do anything is worse than a sentence explaining where the browser
 *   keeps its own.
 *
 * `useStandalone` and `useIosSafari` live in `lib/use-install-state.ts` rather
 * than here: `components/push-notifications.tsx` decides its own three states
 * from the same pair, and one copy of the iPad user-agent heuristic is enough.
 */

/**
 * Not in lib.dom — `beforeinstallprompt` is a Chromium extension to the spec.
 * Only the two members used here are declared.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallApp() {
  const t = useTranslations("Install");
  const hydrated = useHydrated();

  const standalone = useStandalone();
  const ios = useIosSafari();

  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  /*
   * Installing does not move the *current* tab into an installed window, so
   * `useStandalone`'s media query stays false for the rest of this page's life.
   * This is what lets the row acknowledge the install that just happened.
   */
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = standalone || justInstalled;

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Without this Chrome shows its own mini-infobar and the event is spent.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    // Fires once the install completes, whether from this button or from the
    // browser's own menu — either way the row should stop offering it.
    const onInstalled = () => {
      setJustInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    // Spent either way: the spec allows a captured event exactly one prompt,
    // and `appinstalled` covers the accepted case.
    setPromptEvent(null);
  };

  return (
    <SettingsRow
      label={t("title")}
      note={
        /* The note follows the state, so nobody is told to press a button
           that is not there. Before hydration it is the neutral one — the
           server cannot know which of the three applies. */
        !hydrated
          ? t("note")
          : installed
            ? t("installedNote")
            : promptEvent
              ? t("note")
              : ios
                ? t("iosNote")
                : t("browserMenuNote")
      }
    >
      {/* Reserve nothing before hydration: which control belongs here is only
          knowable in the browser, and guessing would flash the wrong one. */}
      {hydrated && installed && (
        <p className="flex shrink-0 items-center gap-2 rounded-full bg-accent-soft px-4 py-2 text-[13px] font-medium text-accent sm:py-1.5">
          <Check className="size-3.5" aria-hidden />
          {t("installed")}
        </p>
      )}

      {hydrated && !installed && promptEvent && (
        <button type="button" onClick={install} className={CONTROL}>
          <Download className="size-3.5 text-text-subtle" aria-hidden />
          {t("action")}
        </button>
      )}

      {hydrated && !installed && !promptEvent && ios && (
        <Dialog>
          <DialogTrigger className={CONTROL}>
            <Share className="size-3.5 text-text-subtle" aria-hidden />
            {t("iosAction")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("iosTitle")}</DialogTitle>
              <DialogDescription>{t("iosIntro")}</DialogDescription>
            </DialogHeader>
            <ol className="flex flex-col gap-3 text-[13.5px] text-text">
              <li className="flex items-start gap-2.5">
                <Share className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <span>{t("iosStep1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <SquarePlus
                  className="mt-0.5 size-4 shrink-0 text-accent"
                  aria-hidden
                />
                <span>{t("iosStep2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <span>{t("iosStep3")}</span>
              </li>
            </ol>
          </DialogContent>
        </Dialog>
      )}
    </SettingsRow>
  );
}
