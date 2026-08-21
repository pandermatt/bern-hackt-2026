import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here("./"),
      /*
       * `server-only` throws unless it is resolved under Next's `react-server`
       * condition — which is the point of the package, and which vitest does
       * not set. `lib/auth.ts` and `db/index.ts` both import it, so without
       * this alias every test that touches the data layer fails at import.
       */
      "server-only": here("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    /*
     * Every file talks to the same SQLite database and truncates the tables in
     * beforeEach. Run in parallel and one file wipes another's fixtures
     * mid-test, which surfaces as a rare, confusing failure. The whole suite
     * takes ~2s serialized.
     */
    fileParallelism: false,
  },
});
