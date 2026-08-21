/* Version comes from package.json at build time. This is a server component,
   so the import is resolved on the server and package.json never reaches the
   client bundle. */
import pkg from "@/package.json";
import { site } from "@/lib/site";

export function AppFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-6">
        <div className="font-mono text-[12px] text-text-subtle">
          <p>
            {site.name} — {site.description}
          </p>
          <p className="mt-1">
            Made with <span aria-hidden>❤️</span>
            <span className="sr-only">love</span> in Switzerland{" "}
            <span aria-hidden>🇨🇭</span>
          </p>
        </div>
        <p className="font-mono text-[12px] text-text-subtle" title="App version">
          v{pkg.version}
        </p>
      </div>
    </footer>
  );
}
