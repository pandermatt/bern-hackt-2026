import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { suggestMerchantCategories } from "@/lib/llm/suggest-merchant-categories";
import { CATEGORIES } from "@/scripts/lib/statement";

type Body = {
  contents: { role: string; parts: { text: string }[] }[];
  systemInstruction: { parts: { text: string }[] };
};

const bodyOf = (init: RequestInit): Body => JSON.parse(String(init.body)) as Body;

/** The names one request is asking about. */
function asked(init: RequestInit): string[] {
  const user = bodyOf(init).contents.at(-1)?.parts[0].text ?? "{}";
  return (JSON.parse(user) as { merchants?: string[] }).merchants ?? [];
}

/**
 * Stands in for the Gemini endpoint. The handler is given the names that
 * request actually asked about, so a test can answer per batch rather than
 * replaying one canned reply to every call.
 */
function mockLlm(reply: (names: string[]) => unknown) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    async (_url, init) => ({
      ok: true,
      status: 200,
      // `text`, not `json`: the shared client reads the body once as text so an
      // unparseable one can be shown in the debug log verbatim.
      text: async () =>
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(reply(asked(init))) }] } },
          ],
        }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Answers every name with the same category. */
const allAs = (category: string) => (names: string[]) => ({
  merchants: names.map((name) => ({ name, category })),
});

describe("suggestMerchantCategories", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test_key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it("files a merchant into a category the app has", async () => {
    mockLlm(allAs("Food & Drink"));

    const filed = await suggestMerchantCategories(["Bäckerei Fleischli"]);

    expect([...filed]).toEqual([["Bäckerei Fleischli", "Food & Drink"]]);
  });

  it("offers the model only categories the app can render", async () => {
    const fetchMock = mockLlm(allAs("Transport"));
    await suggestMerchantCategories(["SBB"]);

    const prompt = bodyOf(fetchMock.mock.calls[0][1]).systemInstruction.parts[0].text;

    // The allowlist is the app's own catalog, not a copy of it — so there is no
    // second list to drift out of step with what the ledger colours and the
    // budget sums.
    for (const category of CATEGORIES) {
      if (category === "Opening balance") continue;
      expect(prompt).toContain(category);
    }
    // Not a place to put a merchant: it is the synthetic line each importer
    // writes to seed the running balance.
    expect(prompt).not.toContain("Opening balance");
  });

  it("drops a category the app does not have rather than repairing it", async () => {
    mockLlm(allAs("Groceries"));
    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());
  });

  it("drops `Other`, which is the absence of an opinion", async () => {
    // The row is already unfiled; storing `Other` would be an opinion that it
    // belongs there.
    mockLlm(allAs("Other"));
    await expect(suggestMerchantCategories(["TWINT"])).resolves.toEqual(new Map());
  });

  it("ignores an answer about a merchant it never asked about", async () => {
    mockLlm(() => ({
      merchants: [{ name: "Somebody Else", category: "Travel" }],
    }));

    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());
  });

  it("matches the name back however the model cased it", async () => {
    mockLlm((names) => ({
      merchants: names.map((name) => ({
        name: ` ${name.toUpperCase()} `,
        category: "Transport",
      })),
    }));

    const filed = await suggestMerchantCategories(["Mobility"]);

    // Keyed by the name as it stands in the ledger, whatever came back.
    expect(filed.get("Mobility")).toBe("Transport");
  });

  it("asks in batches, and merges what comes back", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `Shop ${i}`);
    const fetchMock = mockLlm(allAs("Marketplace"));

    const filed = await suggestMerchantCategories(names);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(filed.size).toBe(25);
  });

  it("keeps the batches that answered when one fails", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        call++;
        // The first batch meets a rejected key, which is not retried down the
        // chain — the second is unaffected.
        if (call === 1) return { ok: false, status: 401, text: async () => "{}" };
        return {
          ok: true,
          status: 200,
          text: async () => {
            const merchants = asked(init).map((name) => ({
              name,
              category: "Marketplace",
            }));
            return JSON.stringify({
              candidates: [
                { content: { parts: [{ text: JSON.stringify({ merchants }) }] } },
              ],
            });
          },
        };
      }),
    );

    const names = Array.from({ length: 25 }, (_, i) => `Shop ${i}`);
    const filed = await suggestMerchantCategories(names);

    expect(filed.size).toBe(5);
  });

  it("never asks without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = mockLlm(allAs("Travel"));

    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never asks about an empty list", async () => {
    const fetchMock = mockLlm(allAs("Travel"));

    await expect(suggestMerchantCategories(["   ", ""])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up quietly when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());
  });

  it("gives up quietly on a reply that is not the shape it asked for", async () => {
    // A response truncated at max_tokens looks exactly like the first of these.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"merchants": [{"nam' }] } }],
          }),
      })),
    );
    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());

    mockLlm(() => ({ merchants: [{ name: "Coop", category: 7 }] }));
    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());

    mockLlm(() => ({ suggestions: { Coop: "Travel" } }));
    await expect(suggestMerchantCategories(["Coop"])).resolves.toEqual(new Map());
  });
});
