/**
 * The assistant's eval: the real tool-calling loop, run end to end against
 * recorded model responses.
 *
 * `tests/assistant.test.ts` covers the pure helpers. This covers the thing
 * those helpers serve — which tool the model picks, whether the arguments
 * survive, and whether the words that reach the customer are an answer made
 * of the customer's own figures. That was untested before, and it is exactly
 * where a model swap shows up.
 *
 * Fixtures are real responses, captured once per model against the synthetic
 * account in `fixtures/assistant/account.ts`. Recording is opt-in and hits
 * the live endpoint:
 *
 *     RECORD_ASSISTANT=1 npx vitest run tests/assistant-eval
 *
 * Without it the suite is offline and deterministic, like every other test
 * here. Re-record when the prompt or the tool definitions change — a stale
 * fixture proves the old prompt worked, not the new one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_ANOMALIES,
  FIXTURE_DASHBOARD,
  FIXTURE_ROWS,
} from "./fixtures/assistant/account";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: 1, email: "eval@example.com", name: "Eval" }),
}));

vi.mock("@/app/actions/transactions", () => ({
  getDashboard: async () => FIXTURE_DASHBOARD,
  listTransactions: async () => FIXTURE_ROWS,
}));

vi.mock("@/app/actions/anomalies", () => ({
  getAnomalyOverview: async () => FIXTURE_ANOMALIES,
}));

// No goals: the savings tools are exercised for tool choice and for the
// shape of what comes back, and `buildAllocationProposal` has its own unit
// tests for everything downstream of that.
vi.mock("@/app/actions/savings", () => ({
  getSavingsOverview: async () => null,
}));

// next-intl reads a request context these tests do not have. The follow-up
// fallback only needs stable strings.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `[${key}]`,
}));

// The real static guard still runs — a model that writes a banned statement
// must fail the eval — but the worker and better-sqlite3 stay out of it.
vi.mock("@/lib/sql-sandbox", () => ({
  runSandboxSql: async (_rows: unknown, sql: string) => {
    const { validateSelect } = await import("@/lib/assistant");
    const invalid = validateSelect(sql);
    if (invalid) return { ok: false, error: invalid };
    return {
      ok: true,
      columns: ["weekday", "spent"],
      rows: [
        { weekday: "Wednesday", spent: 1200.0 },
        { weekday: "Thursday", spent: 988.7 },
      ],
      rowCount: 2,
    };
  },
}));

const { runAssistantTurn } = await import("@/lib/assistant-runner");

type Case = {
  name: string;
  locale: "de" | "en";
  question: string;
  /** Tools the turn must have called. */
  calls?: string[];
  /**
   * A pattern the reply must match — something only a tool result could have
   * supplied. Written per locale where the model rightly translates it.
   */
  mentions?: RegExp;
};

const CASES: Case[] = [
  // German first: it is the default locale, and the routing this replaced was
  // English-only — a German turn used to answer "Ich rufe die Ausgaben … ab".
  {
    name: "de-where",
    locale: "de",
    question: "Wo geht mein Geld hin?",
    calls: ["get_spending_by_category"],
  },
  {
    name: "de-weekday",
    locale: "de",
    question: "An welchem Wochentag gebe ich am meisten aus?",
    calls: ["run_sql"],
    mentions: /mittwoch/i,
  },
  { name: "de-month", locale: "de", question: "Wie viel habe ich im März 2025 ausgegeben?" },
  {
    name: "de-subscriptions",
    locale: "de",
    question: "Welche Abos zahle ich regelmässig?",
    calls: ["get_subscriptions"],
  },
  {
    name: "de-anomalies",
    locale: "de",
    question: "Gibt es etwas Auffälliges auf meinem Konto?",
    calls: ["get_recent_anomalies"],
  },
  {
    name: "de-merchants",
    locale: "de",
    question: "Wer sind meine Top-Händler?",
    calls: ["get_top_merchants"],
  },
  { name: "en-where", locale: "en", question: "Where does my money go?" },
  {
    name: "en-weekday",
    locale: "en",
    question: "Which weekday do I spend the most on?",
    calls: ["run_sql"],
    mentions: /wednesday/i,
  },
  {
    name: "en-savings",
    locale: "en",
    question: "Where could I save more money?",
    calls: ["get_savings_potential"],
  },
  { name: "en-saved", locale: "en", question: "How much did I save this year?" },
];

/**
 * Cases a given model is known to get wrong, recorded so the gap is visible
 * rather than absent. These run as `it.fails`: the suite stays green while
 * the gap holds, and turns red the day the model closes it — which is the
 * signal to delete the entry, not to widen it. The list describes the
 * committed fixture, so re-recording means re-checking it.
 */
const KNOWN_GAPS: Record<string, string[]> = {};

const RECORDING = process.env.RECORD_ASSISTANT === "1";
const MODEL = process.env.CHAT_MODEL ?? process.env.MODEL ?? "apertus-v1.5-70b";
const DIR = join(import.meta.dirname, "fixtures", "assistant");
const FILE = join(DIR, `${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}.json`);

type Recording = Record<string, string[]>;

const recorded: Recording = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8")) as Recording)
  : {};
const captured: Recording = {};

const realFetch = globalThis.fetch;
let current: Case;
let cursor = 0;

beforeEach(() => {
  cursor = 0;
  // Replay never reaches the network, but the runner refuses to start without
  // a key — that check is the one thing here that must not be mocked away.
  if (!RECORDING) vi.stubEnv("CHAT_KEY", "replay");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (RECORDING) {
      // The gateway 502s intermittently under back-to-back requests. A flaky
      // capture would bake a failure into the fixture, so retry here — the
      // replay path stays a straight read.
      for (let attempt = 1; ; attempt++) {
        const response = await realFetch(url, init);
        const body = await response.text();
        if (response.ok || attempt === 4) {
          (captured[current.name] ??= []).push(body);
          return new Response(body, { status: response.status });
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
    const body = recorded[current.name]?.[cursor++];
    if (body === undefined) {
      throw new Error(
        `No recorded response ${cursor} for "${current.name}" on ${MODEL}. Re-record.`,
      );
    }
    return new Response(body, { status: 200 });
  });
});

afterAll(() => {
  if (!RECORDING) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(captured, null, 2)}\n`);
});

/** Which tools a recorded turn actually asked for, read off the fixtures. */
function calledTools(name: string): string[] {
  return (recorded[name] ?? captured[name] ?? []).flatMap((body) => {
    try {
      const data = JSON.parse(body) as {
        choices?: { message?: { tool_calls?: { function?: { name?: string } }[] } }[];
      };
      return (data.choices?.[0]?.message?.tool_calls ?? []).map(
        (call) => call.function?.name ?? "",
      );
    } catch {
      return [];
    }
  });
}

async function run(scenario: Case) {
  current = scenario;
  let turn;
  for await (const event of runAssistantTurn({
    rawHistory: [{ role: "user", content: scenario.question }],
    locale: scenario.locale,
  })) {
    if (event.type === "done") turn = event.turn;
  }
  if (!turn) throw new Error("The runner produced no result.");
  return turn;
}

describe(`assistant turns on ${MODEL}`, () => {
  for (const scenario of CASES) {
    // Recording has to run every case, gap or not, or the fixture loses it.
    const test =
      !RECORDING && KNOWN_GAPS[MODEL]?.includes(scenario.name) ? it.fails : it;
    test(
      `${scenario.name}: ${scenario.question}`,
      async () => {
        const turn = await run(scenario);

        expect(turn.error, turn.reply).toBeFalsy();
        expect(turn.reply.trim().length).toBeGreaterThan(0);

        // Nothing internal reaches the bubble: no reasoning, no control
        // tokens, no leftover FOLLOWUP markers, no tool names, no JSON.
        expect(turn.reply).not.toMatch(/<think>|<\|/);
        expect(turn.reply).not.toMatch(/FOLLOW[\s-]?UPS?\s*:/i);
        expect(turn.reply).not.toMatch(
          /\b(get_overview|get_spending_by_category|get_top_merchants|get_income_breakdown|get_monthly_series|get_savings_potential|get_subscriptions|get_recent_anomalies|get_savings_goals|propose_allocation|run_sql)\b/,
        );
        expect(turn.reply).not.toMatch(/\{\s*"[^"\n]+"\s*:/);

        // The turn must answer, not narrate the fetch it is about to do. This
        // is the failure the old content-scraping loop shipped to German
        // readers as the answer.
        expect(turn.reply).not.toMatch(
          /^(ich (rufe|schaue|hole|werde)|lass(en)? (mich|sie)|einen moment|let me|i'?ll |i will |i need to |one moment)/i,
        );

        // No figure that only exists as a formatting example in the prompt.
        expect(turn.reply).not.toContain("1'234.55");

        // Swiss grouping, never commas — `formatSwissNumbers` guarantees it.
        expect(turn.reply).not.toMatch(/\d,\d{3}\b/);

        if (scenario.mentions) expect(turn.reply).toMatch(scenario.mentions);
        for (const tool of scenario.calls ?? []) {
          expect(calledTools(scenario.name)).toContain(tool);
        }

        // Follow-ups are always offered: the model's own, or the starters. An
        // empty chip row is a dead end for the reader.
        expect(turn.followUps?.length).toBeGreaterThan(0);
        // Generous only while recording, where this waits on the live
        // endpoint through up to five rounds; replay never comes close.
      },
      RECORDING ? 180_000 : 5_000,
    );
  }
});
