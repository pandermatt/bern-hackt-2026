import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { register } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";

// The `— <site name>` suffix comes from the title template in the root layout.
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("register") };
}

export default async function RegisterPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;

  // Authoritative "already signed in?" check. This deliberately lives here
  // rather than in proxy.ts: the proxy runs on the edge, can only see that a
  // cookie exists, and a cookie whose session row is gone — every browser's
  // cookie after a redeploy — would otherwise be bounced away from the one
  // page that can fix it.
  if (await getCurrentUser()) return redirect({ href: "/home", locale });

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <AuthForm mode="register" action={register} />
    </main>
  );
}
