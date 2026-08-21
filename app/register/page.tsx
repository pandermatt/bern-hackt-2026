import type { Metadata } from "next";

import { register } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";

// The `— <site name>` suffix comes from the title template in the root layout.
export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <AuthForm mode="register" action={register} />
    </main>
  );
}
