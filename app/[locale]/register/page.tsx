import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { register } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { SignupContact } from "@/components/signup-contact";
import { redirect } from "@/i18n/navigation";
import { signupMode } from "@/lib/auth-gate";
import { getCurrentUser } from "@/lib/auth";

// The `— <site name>` suffix comes from the title template in the root layout.
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t(signupMode() === "closed" ? "registerDisabled" : "register") };
}

export default async function RegisterPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;

  // Authoritative "already signed in?" check. This deliberately lives here
  // rather than in proxy.ts: the proxy runs on the edge, can only see that a
  // cookie exists, and a cookie whose session row is gone — every browser's
  // cookie after a redeploy — would otherwise be bounced away from the one
  // page that can fix it.
  //
  // It stays ahead of the closed notice below: someone who already has an
  // account has no business being told they cannot make one.
  if (await getCurrentUser()) return redirect({ href: "/home", locale });

  const mode = signupMode();

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      {mode === "closed" ? (
        <SignupDisabledNotice />
      ) : (
        /* The question, not the key — `signupMode` reads the env var on the
           server and what reaches the form is only *that* a field has to be
           filled in, so the value itself never enters the client bundle. What
           it gates is checked again in `register` regardless of what was
           rendered. */
        <AuthForm mode="register" action={register} loginKeyRequired={mode === "keyed"} />
      )}
    </main>
  );
}

/**
 * What `/register` is while sign-up is closed — the same card the form was
 * drawn in, so the page a "Get started" button lands on still looks like the
 * page it promised, and still offers the way that *is* open underneath: an
 * account that already exists can still sign in.
 *
 * The route is not redirected away and stays in the proxy's public list: a
 * bounce would leave every "Create an account" link in the header, the footer
 * and the landing page pointing somewhere that silently does something else.
 * Saying so once, here, is the honest version.
 */
async function SignupDisabledNotice() {
  const t = await getTranslations("Auth");

  return (
    <AuthCard
      title={t("signupDisabledTitle")}
      subtitle={t("signupDisabledSubtitle")}
      alt={{
        href: "/login",
        text: t("registerAltText"),
        label: t("registerAltLabel"),
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
        {t("signupDisabledBody")}
      </p>

      {/* The notice would otherwise be a dead end: a key is the only way in
          while sign-up is closed, and nothing else on the page says where one
          comes from. */}
      <div className="mt-3">
        <SignupContact />
      </div>
    </AuthCard>
  );
}
