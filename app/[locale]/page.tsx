import { AppFooter } from "@/components/app-footer";
import { Landing } from "@/components/landing";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isDemoAsleep } from "@/lib/demo-asleep";

/**
 * The public front door, and nothing else.
 *
 * It used to be the dashboard as well — signed out it rendered `<Landing />`,
 * signed in it rendered the whole ledger. That is now split: the dashboard has
 * its own address at `/dashboard`, and the signed-in entry page is `/home`, so
 * anyone arriving here with a session is sent on to it. What is left is the
 * marketing page for people who do not have an account yet.
 *
 * This route must stay in the proxy's public allowlist. Bounce it to /login and
 * the landing page becomes unreachable.
 */

export const dynamic = "force-dynamic";

export default async function Index({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;

  // The authoritative check — the proxy only sniffs for a cookie, and a cookie
  // whose session row is gone is exactly the case that must still land on the
  // landing page rather than in a redirect loop.
  const user = await getCurrentUser();
  if (user) return redirect({ href: "/home", locale });

  // The footer lives here rather than in the layout: it is the marketing
  // footer, and this is the marketing page. Rendering it from the route keeps
  // it server-side — a client-side route check in the layout would ship it to
  // every page and drop it after hydration, which is a flash on each
  // navigation and no removal at all without JavaScript.
  //
  // It takes no `user`, and cannot: anyone with a session was redirected to
  // /home three lines up, so this page is only ever read signed out.

  // The CI deploy renders this route twice — once plain, once with the header
  // `isDemoAsleep` reads — and ships both documents to the edge, which picks
  // one depending on whether the demo server currently exists. See
  // `lib/demo-asleep.ts`.
  const asleep = await isDemoAsleep();

  return (
    <>
      <Landing asleep={asleep} />
      <AppFooter asleep={asleep} />
    </>
  );
}
