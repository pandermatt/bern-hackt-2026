import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { login } from "@/app/actions/auth";
import { redirect } from "@/i18n/navigation";
import { LOGIN_DISABLED } from "@/lib/auth-gate";
import { getCurrentUser } from "@/lib/auth";

// The `— <site name>` suffix comes from the title template in the root layout.
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t(LOGIN_DISABLED ? "loginDisabled" : "login") };
}

export default async function LoginPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;

  // Authoritative "already signed in?" check. This deliberately lives here
  // rather than in proxy.ts: the proxy runs on the edge, can only see that a
  // cookie exists, and a cookie whose session row is gone — every browser's
  // cookie after a redeploy — would otherwise be bounced away from the one
  // page that can fix it.
  //
  // It stays ahead of the disabled notice below: a live session is a live
  // session, and telling someone who is already signed in that signing in is
  // off would be both confusing and false.
  if (await getCurrentUser()) return redirect({ href: "/home", locale });

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      {LOGIN_DISABLED ? <LoginDisabledNotice /> : <AuthForm mode="login" action={login} />}
    </main>
  );
}

/**
 * What `/login` is while `LOGIN_DISABLED` stands — the same card the form was
 * drawn in, so the page a "Sign in" link lands on still looks like the page it
 * promised, and still offers the way that *is* open underneath.
 *
 * The route is not redirected away and stays in the proxy's public list: a
 * bounce would leave every "Sign in" link in the header, the footer and the
 * landing page pointing somewhere that silently does something else. Saying so
 * once, here, is the honest version.
 */
async function LoginDisabledNotice() {
  const t = await getTranslations("Auth");

  return (
    <AuthCard
      title={t("loginDisabledTitle")}
      subtitle={t("loginDisabledSubtitle")}
      alt={{
        href: "/register",
        text: t("loginAltText"),
        label: t("loginAltLabel"),
      }}
    >
      {/* The `warning` idiom from the ledger's anomaly badges — Supernova is a
          fill and `--brand-ink` is the ink that goes on it. `role="status"`
          rather than `alert`: this is the state of the page on arrival, not
          something that just went wrong. */}
      <p
        role="status"
        className="mt-6 rounded-md border border-brand/40 bg-brand-soft px-3 py-2.5 text-[13px] text-brand-ink"
      >
        {t("loginDisabledBody")}
      </p>
    </AuthCard>
  );
}
