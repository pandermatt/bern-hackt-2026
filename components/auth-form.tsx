"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { AuthState } from "@/app/actions/auth";
import { Link } from "@/i18n/navigation";

type Mode = "login" | "register";

/**
 * Everything that differs between the two modes. The words themselves live in
 * the `Auth` namespace, keyed by mode — only the browser's autocomplete hint
 * and the "or do the other thing" link are decided here.
 */
const AUTOCOMPLETE = { login: "current-password", register: "new-password" } as const;

const ALT_HREF = { login: "/register", register: "/login" } as const;

/**
 * Shared by every input on this form. `text-[16px]` below `sm` is deliberate:
 * anything smaller makes iOS Safari zoom the viewport on focus.
 */
export const FIELD =
  "h-10 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-text outline-none transition-shadow placeholder:text-text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-[14px]";

export function AuthForm({
  mode,
  action,
}: {
  mode: Mode;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
}) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined,
  );

  return (
    <div className="w-full max-w-[26rem]">
      <div className="card p-7">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
          {t(`${mode}Title`)}
        </h1>
        <p className="mt-1.5 text-[14px] text-text-muted">{t(`${mode}Subtitle`)}</p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          {/* Registration only. Optional — the greeting falls back to the
              email's local part, so nobody is blocked on filling this in. */}
          {mode === "register" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="name"
                className="text-[13px] font-medium text-text"
              >
                {t("name")}{" "}
                <span className="font-normal text-text-subtle">{t("nameOptional")}</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                maxLength={80}
                autoComplete="name"
                placeholder={t("namePlaceholder")}
                className={FIELD}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-[13px] font-medium text-text"
            >
              {t("email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-text"
            >
              {t("password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={AUTOCOMPLETE[mode]}
              placeholder={t("passwordPlaceholder")}
              className={FIELD}
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
            {pending ? t(`${mode}Pending`) : t(`${mode}Submit`)}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[13px] text-text-muted">
        {t(`${mode}AltText`)}{" "}
        <Link
          href={ALT_HREF[mode]}
          className="font-medium text-accent hover:text-accent-hover hover:underline"
        >
          {t(`${mode}AltLabel`)}
        </Link>
      </p>
    </div>
  );
}
