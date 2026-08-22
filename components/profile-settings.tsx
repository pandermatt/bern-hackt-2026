"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { updateProfile, type AuthState } from "@/app/actions/auth";
import { FIELD } from "@/components/auth-form";
import { SETTINGS_GROUP, SettingsRow } from "@/components/settings-row";

/**
 * The one part of this page that writes back to `users`.
 *
 * `useActionState` rather than the `useTransition` + `router.refresh()` pattern
 * the demo-data controls use: `updateProfile` already calls `revalidatePath`,
 * which is what the header pill and the dashboard greeting actually need — both
 * are server-rendered from a per-request cached `getCurrentUser`, so a client
 * refresh alone would not move them.
 *
 * It owns the whole group's panel rather than being dropped into one, because
 * the two fields and the Save button have to sit inside a single `<form>` —
 * so the divider class lives here instead of on the `Section`.
 */
export function ProfileSettings({
  user,
}: {
  user: { name: string | null; email: string };
}) {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    updateProfile,
    undefined,
  );

  // A ref, not the state object: `state` is a fresh object on every submit, so
  // an effect keyed on it would re-toast for a second save of the same value.
  const announced = useRef<AuthState>(undefined);

  useEffect(() => {
    if (state?.saved && announced.current !== state) {
      announced.current = state;
      toast.success(t("updated"));
    }
  }, [state, t]);

  return (
    <form action={formAction} className={SETTINGS_GROUP}>
      <SettingsRow label={t("yourName")} labelFor="profile-name">
        <input
          id="profile-name"
          name="name"
          type="text"
          maxLength={80}
          autoComplete="name"
          // Uncontrolled, seeded from the server. Clearing it and saving is a
          // real reset — the action stores an empty field as NULL.
          defaultValue={user.name ?? ""}
          placeholder={t("namePlaceholder")}
          className={`${FIELD} w-full sm:w-72`}
        />
      </SettingsRow>

      <SettingsRow label={t("emailAddress")} labelFor="profile-email">
        <input
          id="profile-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={user.email}
          className={`${FIELD} w-full sm:w-72`}
        />
      </SettingsRow>

      {/* The group's footer rather than a row: Save belongs to both fields
          above, and the error it can come back with belongs beside it. */}
      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3.5 sm:px-5">
        {state?.error && (
          <p
            role="alert"
            className="min-w-0 flex-1 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger"
          >
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="h-10 shrink-0 cursor-pointer rounded-md bg-accent px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60 max-sm:w-full"
        >
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
