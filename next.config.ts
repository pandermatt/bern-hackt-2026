import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Pin the workspace root; an unrelated lockfile in a parent directory would
  // otherwise be inferred as the root.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },

  // better-sqlite3 is a native module and must be `require`d at runtime rather
  // than bundled. Next already externalizes it by default; declaring it keeps
  // the constraint explicit and survives changes to that default list.
  serverExternalPackages: ["better-sqlite3"],

  // The floating dev badge sits on top of the colophon rule.
  devIndicators: false,

  experimental: {
    // A Server Action body is capped at 1 MB by default, and the CSV uploader
    // posts the statement itself. The app's own cap is `MAX_CSV_BYTES` (2 MB)
    // in `lib/csv-import.ts`; this leaves room above it for the multipart
    // boundaries and part headers, so the limit a person hits is ours — which
    // comes with a sentence explaining it — rather than a framework 413.
    serverActions: { bodySizeLimit: "3mb" },
  },

  async headers() {
    return [
      {
        // Without this the worker itself can be served from cache, and a
        // stale worker keeps serving a stale app long after a deploy.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
