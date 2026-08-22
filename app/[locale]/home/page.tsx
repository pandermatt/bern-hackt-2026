import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getAnomalyOverview } from "@/app/actions/anomalies";
import { getBudgetOverview } from "@/app/actions/budget";
import { getSavingsOverview } from "@/app/actions/savings";
import { HomeChat } from "@/components/home-chat";
import { NudgeCard } from "@/components/nudge-card";
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
 * three nudges, and the mascot.
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

        {nudges.length > 0 && (
          <section className="mt-4 space-y-2" aria-label={t("nudgesLabel")}>
            {nudges.map((nudge) => (
              <NudgeCard key={nudge.id} nudge={nudge} />
            ))}
          </section>
        )}

        {/* `mt-auto` is what puts the dragon at the bottom of the *page* rather
            than merely under the last card: on a quiet day with no nudges it
            still sits in the pistachio instead of floating mid-screen. */}
        <div className="mt-auto flex flex-col items-center pt-8">
          {/* Only the all-clear line, and only on its own ground. This is the
              one piece of text that would otherwise sit on the gradient, and
              Pistachio is a fill — 2:1 on white — never a surface for type.
              The "tap a card" instruction that used to live here is gone: the
              cards carry an arrow and are plainly tappable. */}
          {nudges.length === 0 && (
            <p className="mb-3 rounded-full bg-surface/85 px-3 py-1 text-center text-[12.5px] text-text-muted backdrop-blur-sm">
              {t("allClear")}
            </p>
          )}
          {/* A plain `<img>`, like `merchant-avatar.tsx`: a small asset already
              at its final size on our own origin. `next/image` would add a
              `/_next/image` round trip and this repo's first `images` config
              to save nothing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DRAGON_SRC[dragon]}
            alt={t(`dragonAlt.${dragon}`)}
            width={512}
            height={512}
            className="h-40 w-40 drop-shadow-sm"
          />
        </div>
      </div>
    </main>
  );
}
