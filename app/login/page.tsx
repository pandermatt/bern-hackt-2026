import type { Metadata } from "next";

import { login } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";

// The `— <site name>` suffix comes from the title template in the root layout.
export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <AuthForm mode="login" action={login} />
    </main>
  );
}
