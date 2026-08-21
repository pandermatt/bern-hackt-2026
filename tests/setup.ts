import { vi } from "vitest";

/*
 * `lib/auth.ts` reaches for the request-scoped cookie jar and the actions call
 * revalidatePath; neither exists outside a Next request. The jar is a plain
 * Map so a test can inspect exactly what was set.
 *
 * The factories import the store dynamically because vi.mock is hoisted above
 * the imports in this file.
 */
vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./cookie-jar");

  return {
    cookies: async () => ({
      get: (name: string) =>
        cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
      set: (name: string, value: string) => cookieJar.set(name, value),
      delete: (name: string) => cookieJar.delete(name),
      has: (name: string) => cookieJar.has(name),
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
