import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractSql,
  parseAllocationArgs,
  parseChartRequest,
  parseToolCalls,
  TOOL_DEFINITIONS,
} from "@/lib/assistant";
import {
  callGemini,
  geminiText,
  geminiUsage,
  isRetryableStatus,
  modelChain,
  toFunctionDeclarations,
  toGeminiBody,
  type GeminiAttempt,
  type GeminiResponse,
} from "@/lib/llm/gemini";

/**
 * The adapter between the app's `{ role, content }` prompts and Gemini's
 * `contents` / `parts`, and back again. The last block is the load-bearing
 * one: `lib/assistant.ts`'s parsers were written for a model that wrote its
 * tool calls into the message text, and what keeps them working is
 * `geminiText` rendering a structured `functionCall` back into that shape.
 */
describe("toGeminiBody", () => {
  it("hoists system messages and maps assistant to model", () => {
    const body = toGeminiBody({
      messages: [
        { role: "system", content: "You are the assistant." },
        { role: "user", content: "Where does my money go?" },
        { role: "assistant", content: "Fetching." },
      ],
    }) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.systemInstruction.parts[0].text).toBe("You are the assistant.");
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model"]);
  });

  it("merges consecutive same-role messages into one turn", () => {
    // A round that calls two tools pushes two tool messages back to back.
    const body = toGeminiBody({
      messages: [
        { role: "user", content: "and?" },
        { role: "assistant", content: "call" },
        { role: "tool", content: '{"tool":"get_overview"}' },
        { role: "tool", content: '{"tool":"get_top_merchants"}' },
      ],
    }) as { contents: { role: string; parts: { text: string }[] }[] };
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[2].parts).toHaveLength(2);
  });

  it("budgets thinking on top of the visible answer, never out of it", () => {
    const body = toGeminiBody({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1000,
      thinking: 2048,
    }) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig.maxOutputTokens).toBe(3048);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });

  it("spells the thinking control the way the model expects", () => {
    // Gemini 3 rejects a numeric budget outright (400), and 2.5 does not know
    // the level — so the field is chosen from the model id, not configured.
    const three = toGeminiBody({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "hi" }],
      thinking: 2048,
    }) as { generationConfig: Record<string, unknown> };
    expect(three.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });

    const deep = toGeminiBody({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "hi" }],
      thinking: 8192,
    }) as { generationConfig: Record<string, unknown> };
    expect(deep.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });

    const latest = toGeminiBody({
      model: "gemini-pro-latest",
      messages: [{ role: "user", content: "hi" }],
      thinking: 2048,
    }) as { generationConfig: Record<string, unknown> };
    expect(latest.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });

  it("never asks a Pro model for no thinking at all", () => {
    // "Budget 0 is invalid. This model only works in thinking mode" — a 400,
    // not a faster answer. Only the icon pick asks for zero, and it is written
    // for a Flash model.
    const pro = toGeminiBody({
      model: "gemini-pro-latest",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 32,
      thinking: 0,
    }) as { generationConfig: Record<string, unknown> };
    expect(pro.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 128 });
    // And the clamp is budgeted for: 32 tokens of answer plus the thoughts it
    // was forced to allow, or the thinking would eat the answer.
    expect(pro.generationConfig.maxOutputTokens).toBe(160);

    const flash = toGeminiBody({
      model: "gemini-flash-latest",
      messages: [{ role: "user", content: "hi" }],
      thinking: 0,
    }) as { generationConfig: Record<string, unknown> };
    expect(flash.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("sends no output cap at all when none was asked for", () => {
    const body = toGeminiBody({
      messages: [{ role: "user", content: "hi" }],
    }) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig).not.toHaveProperty("maxOutputTokens");
  });

  it("asks for JSON where the callers used response_format", () => {
    const body = toGeminiBody({
      messages: [{ role: "user", content: "hi" }],
      json: true,
      temperature: 0.1,
    }) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.temperature).toBe(0.1);
  });
});

describe("toFunctionDeclarations", () => {
  const declarations = toFunctionDeclarations(TOOL_DEFINITIONS);
  const byName = new Map(declarations.map((d) => [d.name, d]));

  it("declares every tool the assistant offers", () => {
    expect(declarations).toHaveLength(TOOL_DEFINITIONS.length);
    expect(byName.has("run_sql")).toBe(true);
    expect(byName.has("display_chart")).toBe(true);
  });

  it("omits the schema of a tool that takes nothing", () => {
    // An object with no properties is rejected outright, so the tools built on
    // EMPTY_PARAMETERS have to be declared bare.
    expect(byName.get("get_subscriptions")).not.toHaveProperty("parameters");
    expect(byName.get("get_recent_anomalies")).not.toHaveProperty("parameters");
    expect(byName.get("get_overview")).toHaveProperty("parameters");
  });
});

describe("geminiText", () => {
  const answered = (parts: unknown[]): GeminiResponse =>
    ({ candidates: [{ content: { parts } }] }) as GeminiResponse;

  it("returns plain text as it stands", () => {
    expect(geminiText(answered([{ text: "You spent CHF 1'234.55." }]))).toBe(
      "You spent CHF 1'234.55.",
    );
    expect(geminiText({} as GeminiResponse)).toBe("");
  });

  it("renders a function call into the shape the parsers read", () => {
    const content = geminiText(
      answered([
        {
          functionCall: {
            name: "get_spending_by_category",
            args: { period: "ytd" },
          },
        },
      ]),
    );
    expect(parseToolCalls(content)).toEqual(["get_spending_by_category"]);
  });

  it("carries a SELECT through to extractSql", () => {
    const sql = "SELECT merchant FROM transactions LIMIT 1";
    const content = geminiText(
      answered([{ functionCall: { name: "run_sql", args: { sql } } }]),
    );
    expect(extractSql(content)).toBe(sql);
  });

  it("carries an allocation array through to parseAllocationArgs", () => {
    const content = geminiText(
      answered([
        {
          functionCall: {
            name: "propose_allocation",
            args: {
              allocations: [
                { goal: "Ferien", amount_chf: 600 },
                { goal: "Auto", amount_chf: 250.5 },
              ],
            },
          },
        },
      ]),
    );
    expect(parseAllocationArgs(content)).toEqual([
      { goal: "Ferien", amountMinor: 60_000 },
      { goal: "Auto", amountMinor: 25_050 },
    ]);
  });

  it("carries chart choices through to parseChartRequest", () => {
    const content = geminiText(
      answered([
        {
          functionCall: {
            name: "display_chart",
            args: { source: "merchants", top_n: 3, period: "2025" },
          },
        },
      ]),
    );
    expect(parseToolCalls(content)).toContain("display_chart");
    expect(parseChartRequest(content)).toMatchObject({
      source: "merchants",
      topN: 3,
    });
  });

  it("keeps prose and a call together when the model writes both", () => {
    const content = geminiText(
      answered([
        { text: "Let me look that up." },
        { functionCall: { name: "get_overview", args: {} } },
      ]),
    );
    expect(content).toContain("Let me look that up.");
    expect(parseToolCalls(content)).toEqual(["get_overview"]);
  });
});

describe("geminiUsage", () => {
  it("reports the visible answer's tokens, not the thoughts'", () => {
    expect(
      geminiUsage({
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: 90,
          thoughtsTokenCount: 800,
        },
      }),
    ).toEqual({ promptTokens: 1200, completionTokens: 90 });
    expect(geminiUsage({})).toBeUndefined();
  });
});

/* =========================================================================
   THE FALLBACK CHAIN

   Gemini answers `503 UNAVAILABLE — this model is currently experiencing high
   demand` under load, and on a live deployment a single model is a single
   point of failure for the whole assistant. A turn walks the chain instead.
   ========================================================================= */

describe("isRetryableStatus", () => {
  it("moves on for capacity, stays put for a bad key or a bad request", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    // These would fail identically on every model in the chain.
    for (const status of [400, 401, 403]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("moves on from a retired model id", () => {
    // Google took `gemini-2.5-flash` away from new users mid-flight; a pinned
    // GEMINI_MODEL that retires must not take the assistant with it.
    expect(isRetryableStatus(404)).toBe(true);
  });
});

describe("modelChain", () => {
  it("puts the caller's pick first and never repeats a name", () => {
    const chain = modelChain("gemini-3.6-flash");
    expect(chain[0]).toBe("gemini-3.6-flash");
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("leads with Flash and keeps Pro as a fallback", () => {
    // A deliberate choice, and a one-word edit away from being undone: a chat
    // turn is up to five rounds and Pro spends ten to fifteen seconds thinking
    // on each of them. Pro has to stay *in* the chain, though — dropping it
    // would leave nothing behind Flash but more Flash.
    const chain = modelChain();
    expect(chain[0]).toBe("gemini-flash-latest");
    expect(chain).toContain("gemini-pro-latest");
    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("callGemini", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answers each call from a queue: a number is an HTTP status, a thrown
   * Error stands in for a transport failure. */
  function mockFetch(...replies: (number | Error)[]) {
    // Typed through the generic rather than by declaring parameters the stub
    // does not use: a bare `vi.fn` records its calls as `[]`, and the
    // per-model body assertion below reads `calls[n][1]`.
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(async () => {
      const reply = replies.shift() ?? 200;
      if (reply instanceof Error) throw reply;
      return {
        ok: reply < 400,
        status: reply,
        text: async () => JSON.stringify({ status: reply }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const call = (models: string[], onAttempt?: (a: GeminiAttempt) => void) =>
    callGemini({
      models,
      key: "test_key",
      body: (model) => ({ model }),
      timeoutMs: 1000,
      onAttempt,
    });

  it("moves to the next model on a 503 and answers from it", async () => {
    const fetchMock = mockFetch(503, 200);
    const result = await call(["first", "second", "third"]);

    expect(result.ok).toBe(true);
    expect(result.model).toBe("second");
    // Stops as soon as one answers — the third is never asked.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at a rejected key rather than spending the chain on it", async () => {
    const fetchMock = mockFetch(403, 200);
    const result = await call(["first", "second"]);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403, model: "first" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a transport failure as worth another model", async () => {
    const fetchMock = mockFetch(new Error("network down"), 200);
    const result = await call(["first", "second"]);

    expect(result.ok).toBe(true);
    expect(result.model).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the last failure when the whole chain is down", async () => {
    mockFetch(503, 503, 429);
    const result = await call(["first", "second", "third"]);

    expect(result).toMatchObject({ ok: false, status: 429, model: "third" });
  });

  it("names every failed try, and whether another one is coming", async () => {
    const attempts: GeminiAttempt[] = [];
    mockFetch(503, 200);
    await call(["first", "second"], (attempt) => attempts.push(attempt));

    // Only the failure is reported as an error; the success carries none.
    expect(attempts.map((a) => [a.model, a.status, a.retrying, !!a.error])).toEqual([
      ["first", 503, true, true],
      ["second", 200, false, false],
    ]);
  });

  it("builds the body per model, since the thinking control depends on it", async () => {
    const fetchMock = mockFetch(503, 200);
    await call(["gemini-pro-latest", "gemini-3.6-flash"]);

    const sent = fetchMock.mock.calls.map(
      (args) => JSON.parse(String(args[1].body)).model,
    );
    expect(sent).toEqual(["gemini-pro-latest", "gemini-3.6-flash"]);
  });

  it("keeps the key out of the snapshot it hands the log", async () => {
    const attempts: GeminiAttempt[] = [];
    mockFetch(503, 503);
    await call(["first", "second"], (attempt) => attempts.push(attempt));

    for (const attempt of attempts) expect(attempt.request).not.toContain("test_key");
  });
});
