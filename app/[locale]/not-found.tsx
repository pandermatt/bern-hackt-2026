import Link from "next/link";

/** Renders inside the root layout, so it keeps the shared header and footer. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <p className="font-mono text-[12px] text-text-subtle">404</p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-text">
          Page not found
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          That address doesn&apos;t match anything here.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Back to your list
        </Link>
      </div>
    </main>
  );
}
