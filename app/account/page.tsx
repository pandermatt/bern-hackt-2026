import { redirect } from "next/navigation";

import { AnomalyScanControls } from "@/components/anomaly-scan-controls";
import { DangerZone } from "@/components/danger-zone";
import { DemoDataControls } from "@/components/demo-data-controls";
import { ProfileSettings } from "@/components/profile-settings";
import { ThemeSetting } from "@/components/theme-setting";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
        Account & Settings
      </h1>
      <p className="mt-1 text-[13.5px] text-text-muted">{user.email}</p>

      <div className="card mt-8 overflow-hidden border-line">
        <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-text">Profile</h2>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[13px] text-text-muted">
            Used to greet you on the dashboard and in the header. Leave it empty
            and we&rsquo;ll use your email instead.
          </p>
          <div className="mt-3">
            <ProfileSettings name={user.name} />
          </div>
        </div>
      </div>

      {/* Demo and Synthetic Data Tools */}
      <DemoDataControls />

      <div className="card mt-8 overflow-hidden border-line">
        <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-text">Appearance</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
          <div>
            <p className="text-[14px] font-medium text-text">Colour theme</p>
            <p className="mt-0.5 text-[13px] text-text-muted">
              Applies to this browser only — the choice is stored locally, not on
              your account. New visitors follow their system setting until they
              pick one here.
            </p>
          </div>
          <ThemeSetting />
        </div>
      </div>

      <AnomalyScanControls />

      <div className="card mt-8 overflow-hidden border-danger/30">
        <div className="border-b border-danger/20 bg-danger-soft px-4 py-3 sm:px-5">
          <h2 className="text-[14.5px] font-semibold text-danger">
            Danger zone
          </h2>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-[14px] font-medium text-text">Delete account</p>
            <p className="mt-0.5 text-[13px] text-text-muted">
              Permanently deletes your account and every transaction. This cannot be
              undone.
            </p>
          </div>
          <DangerZone />
        </div>
      </div>
    </main>
  );
}

