import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOAL_ICONS } from "@/lib/goal-icon";
import { suggestGoalIcon } from "@/lib/llm/suggest-goal-icon";

/** Stands in for the Apertus endpoint, answering with one icon name. */
function mockLlm(content: string) {
  // Typed through the generic rather than by declaring parameters the stub does
  // not use: a `vi.fn` with no arguments records its calls as `[]`, and the
  // prompt assertion below reads the request body out of `calls[0][1]`.
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("suggestGoalIcon", () => {
  const originalKey = process.env.APERTUS_KEY;

  beforeEach(() => {
    process.env.APERTUS_KEY = "test_key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.APERTUS_KEY;
    else process.env.APERTUS_KEY = originalKey;
  });

  it("takes a name that is in the catalogue", async () => {
    mockLlm(JSON.stringify({ icon: "Gamepad2" }));
    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBe("Gamepad2");
  });

  it("offers the model only names the pot can draw", async () => {
    const fetchMock = mockLlm(JSON.stringify({ icon: "Dog" }));
    await suggestGoalIcon("Hundewelpe");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      messages: { role: string; content: string }[];
    };
    const prompt = body.messages[0].content;

    // The allowlist is the render table, not a copy of it — so there is no
    // second list that can drift out of step with what `GOAL_ICONS` holds.
    for (const icon of Object.keys(GOAL_ICONS)) {
      expect(prompt).toContain(icon);
    }
  });

  it("drops a name it cannot draw rather than repairing it", async () => {
    // An 8B model asked for a word will happily invent one.
    mockLlm(JSON.stringify({ icon: "Unicorn" }));
    await expect(suggestGoalIcon("Einhorn")).resolves.toBeNull();
  });

  it("never asks without a key", async () => {
    delete process.env.APERTUS_KEY;
    const fetchMock = mockLlm(JSON.stringify({ icon: "Dog" }));

    await expect(suggestGoalIcon("Hundewelpe")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never asks about a name with nothing in it", async () => {
    const fetchMock = mockLlm(JSON.stringify({ icon: "Dog" }));

    await expect(suggestGoalIcon("   ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up quietly when the endpoint refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );

    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBeNull();
  });

  it("gives up quietly when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBeNull();
  });

  it("gives up quietly on a reply that is not the shape it asked for", async () => {
    // A response truncated at max_tokens looks exactly like the first of these.
    mockLlm('{"icon":');
    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBeNull();

    mockLlm(JSON.stringify({ suggestion: "Dog" }));
    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBeNull();

    mockLlm(JSON.stringify({ icon: 7 }));
    await expect(suggestGoalIcon("Töggelikasten")).resolves.toBeNull();
  });
});
