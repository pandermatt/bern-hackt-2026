"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { updateProfile, type AuthState } from "@/app/actions/auth";
import { FIELD } from "@/components/auth-form";

/**
 * The one field on this page that writes back to `users`.
 *
 * `useActionState` rather than the `useTransition` + `router.refresh()` pattern
 * the demo-data controls use: `updateProfile` already calls `revalidatePath`,
 * which is what the header pill and the dashboard greeting actually need — both
 * are server-rendered from a per-request cached `getCurrentUser`, so a client
 * refresh alone would not move them.
 */
export function ProfileSettings({ name }: { name: string | null }) {
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
      toast.success("Name updated.");
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor="profile-name" className="text-[13px] font-medium text-text">
          Your name
        </label>
        <input
          id="profile-name"
          name="name"
          type="text"
          maxLength={80}
          autoComplete="name"
          // Uncontrolled, seeded from the server. Clearing it and saving is a
          // real reset — the action stores an empty field as NULL.
          defaultValue={name ?? ""}
          placeholder="What should we call you?"
          className={FIELD}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-10 shrink-0 cursor-pointer rounded-md bg-accent px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {state?.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
