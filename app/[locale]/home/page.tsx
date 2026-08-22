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

export default async function HomePage({
  params,
}: PageProps<"/[locale]/home">) {
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
    // `true` — hide the rules with nothing left open. A finding that has been
    // ticked off is not something to greet the reader with, and the mascot
    // reads its mood off these nudges, so a fully worked-through scan would
    // otherwise keep the dragon worried about work that is already done.
    getAnomalyOverview(true),
  ]);
  if (!savings || !budget || !anomalies)
    return redirect({ href: "/login", locale });

  const nudges = rankNudges({
    budget: budget.rows,
    // Only findings the engine classed as needing a next step. A stale scan
    // describes transactions that no longer exist, so it is worse than
    // nothing here — the dashboard already offers the re-scan.
    anomalies: anomalies.outdated ? [] : anomalies.action,
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
       chat and the nudges keep their own `bg-surface` ground.

       `app-shell:-mb-30 app-shell:pb-30` is what carries the gradient under the
       floating tab bar. `<body>` reserves the bar's height as its *own* bottom
       padding, which paints `bg-bg` — invisible on every other page, because
       theirs is the ground the body already has, but on this one it cut the
       pistachio off in a white band above the bar. The negative margin lets
       this element grow into that reserved strip and the matching padding puts
       the clearance back inside the gradient, so the saturated end now reaches
       the bottom of the screen and the dragon still sits clear of the glass.
       The pair has to stay equal to the body's `pb-30`, and all three follow
       the bar's own padding in `components/tab-bar.tsx`. */
    <main className="relative flex-1 bg-linear-to-b from-bg via-pistachio/25 to-pistachio app-shell:-mb-30 app-shell:pb-30">
      {/* One phone-shaped column up to `lg`, where it becomes two. This is an
          entry page, not a dashboard, so it never stretches to the full width
          of a desk monitor — but a single `max-w-md` ribbon down the middle of
          one leaves the chat input scrolled away below the mascot. Two columns
          put both above the fold without either growing a mouse-journey wide. */}
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 py-6 lg:max-w-4xl">
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-text">
          {t("greeting", { name: displayName(user) })}
        </h1>

        {/* `flex-1` on this wrapper, not on the page column, is what keeps the
            dragon's `mt-auto` reaching the bottom of the page in both layouts:
            as a flex column it is the only growing child, and as a grid its
            two tracks stretch to its height. */}
        <div className="mt-4 flex flex-1 flex-col lg:grid lg:grid-cols-2 lg:gap-8">
          {/* `lg:self-start` so the card keeps its own height instead of being
              stretched to match the nudges-and-dragon track. */}
          <div className="lg:self-start">
            <HomeChat />
          </div>
          {/* The second track. On a phone this is simply the rest of the
              stack, in the same order it has always been. */}
          <div className="mt-4 flex flex-1 flex-col lg:mt-0">
            {/* `mt-auto` is what puts this block at the bottom of the *page*
                rather than merely under the chat: on a quiet day it keeps the
                dragon in the pistachio instead of floating mid-screen. It is
                also what makes the deck unfold *upwards* — the auto margin
                gives up space as the stack grows, so the dragon stays put and
                the cards rise out of it rather than shoving it off the screen. */}
            <div className="mt-auto">
              {/* One arrangement for both states: the bubble, then the dragon
                  saying it. With nothing to report the all-clear line is
                  simply the only thing in the bubble. Pistachio is a fill —
                  2:1 on white — never a surface for type, so nothing here
                  sits on the gradient without its own ground. */}
              <NudgeStack
                label={t("nudgesLabel")}
                speaker={
                  /* A plain `<img>`, like `merchant-avatar.tsx`: a small asset
                     already at its final size on our own origin. `next/image`
                     would add a `/_next/image` round trip and this repo's
                     first `images` config to save nothing. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={DRAGON_SRC[dragon]}
                    alt={t(`dragonAlt.${dragon}`)}
                    width={512}
                    height={512}
                    className="h-40 w-40 drop-shadow-sm lg:h-64 lg:w-64"
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
        </div>
      </div>
    </main>
  );
}
