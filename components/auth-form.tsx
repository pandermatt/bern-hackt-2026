"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthState } from "@/app/actions/auth";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Sign in",
    subtitle: "Welcome back. Enter your details to continue.",
    submit: "Sign in",
    pending: "Signing in…",
    altText: "Don't have an account?",
    altLabel: "Create one",
    altHref: "/register",
    autoComplete: "current-password",
  },
  register: {
    title: "Create an account",
    subtitle: "Your statements stay private to your account.",
    submit: "Create account",
    pending: "Creating account…",
    altText: "Already have an account?",
    altLabel: "Sign in",
    altHref: "/login",
    autoComplete: "new-password",
  },
} as const;

export function AuthForm({
  mode,
  action,
}: {
  mode: Mode;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined,
  );
  const copy = COPY[mode];

  return (
    <div className="w-full max-w-[26rem]">
      <div className="card p-7">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
          {copy.title}
        </h1>
        <p className="mt-1.5 text-[14px] text-text-muted">{copy.subtitle}</p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-[13px] font-medium text-text"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-text outline-none transition-shadow placeholder:text-text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-[14px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-text"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={copy.autoComplete}
              placeholder="At least 8 characters"
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-text outline-none transition-shadow placeholder:text-text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-[14px]"
            />
          </div>

          {state?.error && (
            <p
              role="alert"
              className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 h-10 cursor-pointer rounded-md bg-accent text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
          >
            {pending ? copy.pending : copy.submit}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[13px] text-text-muted">
        {copy.altText}{" "}
        <Link
          href={copy.altHref}
          className="font-medium text-accent hover:text-accent-hover hover:underline"
        >
          {copy.altLabel}
        </Link>
      </p>
    </div>
  );
}
