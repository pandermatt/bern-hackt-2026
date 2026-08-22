import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * Precached by public/sw.js and served when a navigation fails. Fetched with
 * `credentials: "omit"` at install time, so the copy in Cache Storage is
 * always the signed-out render — no account's data is stored on disk.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <p className="font-mono text-[12px] text-text-subtle">No connection</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-text">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          Your transactions live on the server, so they&apos;ll be here again as soon
          as you reconnect. Nothing has been lost.
        </p>
      </div>
    </main>
  );
}
