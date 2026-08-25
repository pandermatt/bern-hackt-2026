import { describe, expect, it } from "vitest";

import {
  extractSql,
  parseAllocationArgs,
  parseChartRequest,
  parseToolCalls,
  TOOL_DEFINITIONS,
} from "@/lib/assistant";
import {
  geminiText,
  geminiUsage,
  toFunctionDeclarations,
  toGeminiBody,
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
