import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyOverview } from "@/app/actions/anomalies";
import { getBudgetOverview } from "@/app/actions/budget";
import { getSavingsOverview } from "@/app/actions/savings";
import { HomeChat } from "@/components/home-chat";
import { NudgeCard } from "@/components/nudge-card";
import { NudgeStack } from "@/components/nudge-stack";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DRAGON_SRC, dragonFor, rankNudges } from "@/lib/nudges";
import { displayName } from "@/lib/user";

/**
 * The entry page: where signing in lands.
 *
 * Deliberately short. The dashboard answers "what happened", at length and on
 * a desk; this answers "is there anything I should do", on a phone, above the
 * fold. Three things and no more — the assistant ready to be asked, at most
 * three nudges, and the mascot saying them.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/home">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });
  return { title: t("title") };
}

export default async function HomePage({ params }: PageProps<"/[locale]/home">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  // The proxy only sniffs for a cookie; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  // Three reads, three `ownedRows` scans. At a few hundred rows through a
  // synchronous in-process driver that is well under a millisecond, and
  // `/budget` already does two — but this is the place to look first if the
  // page ever feels slow.
  const [savings, budget, anomalies] = await Promise.all([
    getSavingsOverview(),
    getBudgetOverview(),
    getAnomalyOverview(),
  ]);
  if (!savings || !budget || !anomalies) return redirect({ href: "/login", locale });

  const nudges = rankNudges({
    budget: budget.rows,
    // Only findings the engine classed as needing a next step. A stale scan
    // describes transactions that no longer exist, so it is worse than
    // nothing here — the dashboard already offers the re-scan.
    anomalies: anomalies.stale ? [] : anomalies.action,
    savings: {
      month: savings.month,
      monthEnded: savings.monthEnded,
      freeMinor: savings.freeMinor,
    },
  });
  const dragon = dragonFor(nudges, savings.pots);

  return (
    /* The pistachio runs bottom-up, and that direction is the point: Pistachio
       is 2:1 on white and the palette rule is fills only, never type, so the
       saturated end sits behind the dragon where there is no text to read. The
       chat and the nudges keep their own `bg-surface` ground. */
    <main className="relative flex-1 bg-linear-to-b from-bg via-pistachio/25 to-pistachio">
      {/* Phone-shaped at every width. This is an entry page, not a dashboard —
          stretching it across a desk monitor would only put the chat input a
          mouse-journey away from the reader's eyes. */}
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 py-6">
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-text">
          {t("greeting", { name: displayName(user) })}
        </h1>

        <div className="mt-4">
          <HomeChat />
        </div>

        {/* `mt-auto` is what puts this block at the bottom of the *page*
            rather than merely under the chat: on a quiet day it keeps the
            dragon in the pistachio instead of floating mid-screen. It is also
            what makes the deck unfold *upwards* — the auto margin gives up
            space as the stack grows, so the dragon stays put and the cards rise
            out of it rather than shoving it off the screen. */}
        <div className="mt-auto pt-8">
          {/* One arrangement for both states: the bubble, then the dragon
              saying it. With nothing to report the all-clear line is simply the
              only thing in the bubble. Pistachio is a fill — 2:1 on white —
              never a surface for type, so nothing here sits on the gradient
              without its own ground. */}
          <NudgeStack
            label={t("nudgesLabel")}
            speaker={
              /* A plain `<img>`, like `merchant-avatar.tsx`: a small asset
                 already at its final size on our own origin. `next/image`
                 would add a `/_next/image` round trip and this repo's first
                 `images` config to save nothing. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={DRAGON_SRC[dragon]}
                alt={t(`dragonAlt.${dragon}`)}
                width={512}
                height={512}
                className="h-28 w-28 drop-shadow-sm"
              />
            }
          >
            {nudges.length > 0 ? (
              nudges.map((nudge) => <NudgeCard key={nudge.id} nudge={nudge} />)
            ) : (
              <p className="w-fit rounded-full bg-surface/85 px-3 py-1 text-[12.5px] text-text-muted backdrop-blur-sm">
                {t("allClear")}
              </p>
            )}
          </NudgeStack>
        </div>
      </div>
    </main>
  );
}
