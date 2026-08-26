import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Assembled by `npm run edge:build` — this build's `_next/static` and
    // `public/`, plus four prerendered documents. Generated output, and the
    // minified chunks in it are 120k lint warnings on their own.
    "edge/dist/**",
    "edge/.wrangler/**",
  ]),
]);

export default eslintConfig;
