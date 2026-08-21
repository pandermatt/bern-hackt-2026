/** Backing store for the `next/headers` mock in tests/setup.ts. */
export const cookieJar = new Map<string, string>();

export function resetCookies() {
  cookieJar.clear();
}
