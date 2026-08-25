/**
 * The one place that knows what Google's Gemini API looks like.
 *
 * Three callers speak to a model — the chat assistant's tool loop
 * (`app/actions/chat.ts`), the anomaly narrative layer
 * (`lib/llm/analyze-insights.ts`) and the savings-goal icon picker
 * (`lib/llm/suggest-goal-icon.ts`) — and each of them used to hand-roll its own
 * request and its own `choices[0].message.content` read against an
 * OpenAI-compatible endpoint. They keep composing their prompts in that same
 * `{ role, content }` shape, which is the readable one; this module translates
 * it, and translates the answer back.
 *
 * No `server-only` import, for the reason `lib/assistant.ts` gives: the chat
 * action imports from both, and a value import that drags server modules into
 * the client bundle is a mistake only `npm run build` would catch.
 */

/** The shape the callers already write their prompts in. */
export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

/** An OpenAI-style declaration, as `TOOL_DEFINITIONS` in `lib/assistant.ts`
 * still spells them — that file is where the tools are described, and it has
 * no business knowing which vendor reads them. */
export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  };
};

/** What comes back, as much of it as anything here cares about. */
export type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Thinking tokens are billed against `maxOutputTokens`, so the budget is a
 * number this module has to know rather than a knob the callers pass through.
 * 2048 is comfortable for a tool round and still leaves Gemini Pro's floor
 * (128) far below it — Pro cannot switch thinking off at all, and a request
 * that budgets nothing for it comes back as an empty candidate with
 * `finishReason: "MAX_TOKENS"`, which every caller here would report as "the
 * model returned an empty answer".
 */
const DEFAULT_THINKING_BUDGET = 2048;

/**
 * Above this, a Gemini 3 model is asked to think "high" rather than "low".
 * The 3.x family dropped the numeric budget for a two-step level, so the
 * number every caller here reasons in has to be mapped onto it.
 */
const HIGH_THINKING_FROM = 4096;

/** The smallest budget a 2.5-era Pro model accepts; below it the request is
 * rejected outright rather than answered without thinking. */
const PRO_MIN_THINKING = 128;

/**
 * How a model spells its thinking control. Gemini 3 rejects
 * `thinkingConfig.thinkingBudget` outright — `400 INVALID_ARGUMENT`, before it
 * reads anything else — and wants `thinkingLevel` instead; 2.5-era models
 * (which the `-latest` aliases still resolve to) want the budget and do not
 * know the level. Getting this wrong is a hard failure rather than a
 * degradation, so it is decided from the model id rather than configured.
 */
/**
 * What the model will actually spend on thoughts, which is not always what was
 * asked for: a Pro model refuses to stop thinking — "Budget 0 is invalid. This
 * model only works in thinking mode", a 400 rather than a slower answer. The
 * one caller that asks for none is the goal-icon pick, written for a Flash
 * model; clamping keeps it working for anyone who points GEMINI_FAST_MODEL at
 * Pro instead. The clamped figure is what `maxOutputTokens` budgets around,
 * so the thoughts cannot eat the answer's own allowance.
 */
function effectiveThinking(model: string, budget: number): number {
  if (budget === 0 && !/gemini-3/i.test(model) && /pro/i.test(model)) {
    return PRO_MIN_THINKING;
  }
  return budget;
}

function thinkingConfigFor(model: string, budget: number): Record<string, unknown> {
  if (/gemini-3/i.test(model)) {
    return {
      thinkingLevel: budget >= HIGH_THINKING_FROM ? "high" : "low",
    };
  }
  return { thinkingBudget: budget };
}

/**
 * Read per call rather than frozen at module load: an edited `.env.local`
 * should land on the next request in dev, and the chat debug panel's header
 * has to name what the *next* request would use, not what the server booted
 * with.
 */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-pro-latest";
}

/**
 * The model for the calls a person is waiting on — today only the goal-icon
 * pick inside `createSavingsGoal`. Flash, because it is the one that can be
 * told not to think: that call has a six-second budget and a 32-token answer,
 * and a reasoning model fits in neither.
 */
export function geminiFastModel(): string {
  return process.env.GEMINI_FAST_MODEL ?? "gemini-flash-latest";
}

export function geminiEndpoint(model: string): string {
  const base = process.env.GEMINI_URL ?? DEFAULT_BASE_URL;
  return `${base.replace(/\/$/, "")}/models/${model}:generateContent`;
}

export function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

/** The key travels in a header, the way the old bearer token did, so it stays
 * out of the request snapshots `lib/assistant-log.ts` stores. */
export function geminiHeaders(key: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-goog-api-key": key };
}

export function thinkingBudget(): number {
  const raw = Number.parseInt(process.env.GEMINI_THINKING_BUDGET ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_THINKING_BUDGET;
}

/**
 * OpenAI declarations → Gemini function declarations.
 *
 * One correction is required rather than optional: a `parameters` object whose
 * `properties` is empty is rejected, so the tools that take no arguments
 * (`get_subscriptions`, `get_recent_anomalies` — `EMPTY_PARAMETERS` in
 * `lib/assistant.ts`) are declared with no `parameters` at all.
 */
export function toFunctionDeclarations(
  definitions: readonly OpenAiToolDefinition[],
): { name: string; description: string; parameters?: unknown }[] {
  return definitions.map(({ function: fn }) => {
    const empty =
      !fn.parameters || Object.keys(fn.parameters.properties ?? {}).length === 0;
    return empty
      ? { name: fn.name, description: fn.description }
      : { name: fn.name, description: fn.description, parameters: fn.parameters };
  });
}

type GeminiContent = { role: "user" | "model"; parts: { text: string }[] };

/**
 * Messages → `systemInstruction` plus `contents`.
 *
 * `assistant` becomes `model`; `user` and `tool` both become `user`, a tool
 * result keeping the JSON string its caller already built. Consecutive
 * same-role messages are merged into one entry with several parts — a chat
 * round that calls two tools pushes two `tool` messages back to back, and the
 * API wants one turn per speaker.
 */
function toContents(messages: LlmMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
} {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    const role = message.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text: message.content });
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return {
    ...(system.length > 0
      ? { systemInstruction: { parts: [{ text: system.join("\n") }] } }
      : {}),
    contents,
  };
}

export type GeminiRequest = {
  /** Which model this body is for. Only the thinking control depends on it,
   * and only because Gemini 3 and 2.5 spell that control differently. */
  model?: string;
  messages: LlmMessage[];
  /** The VISIBLE answer's budget — what `MAX_TOKENS` has always meant here.
   * The thinking budget is added on top before it goes over the wire. */
  maxTokens?: number;
  /** Overrides `GEMINI_THINKING_BUDGET`; 0 switches thinking off, which only
   * a Flash model accepts. */
  thinking?: number;
  temperature?: number;
  /** Ask for a JSON body, replacing OpenAI's `response_format`. */
  json?: boolean;
  tools?: readonly OpenAiToolDefinition[];
};

export function toGeminiBody({
  model,
  messages,
  maxTokens,
  thinking,
  temperature,
  json,
  tools,
}: GeminiRequest): Record<string, unknown> {
  const target = model ?? geminiModel();
  const budget = effectiveThinking(target, thinking ?? thinkingBudget());
  const generationConfig: Record<string, unknown> = {
    thinkingConfig: thinkingConfigFor(target, budget),
  };
  // An unset cap means "no cap": the request then carries no maxOutputTokens
  // at all and the model's own default applies.
  if (maxTokens !== undefined) {
    generationConfig.maxOutputTokens = maxTokens + budget;
  }
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (json) generationConfig.responseMimeType = "application/json";

  return {
    ...toContents(messages),
    generationConfig,
    ...(tools && tools.length > 0
      ? { tools: [{ functionDeclarations: toFunctionDeclarations(tools) }] }
      : {}),
  };
}

/**
 * The answer as one string — and the seam that lets everything downstream stay
 * as it was.
 *
 * Text parts pass through. A `functionCall` part is written out as
 * `{"<tool name>": {…args…}}`, which is exactly the shape `lib/assistant.ts`
 * already reads: `parseToolCalls` finds the name by substring, and
 * `extractJsonAfter` unwraps a `{ "<marker>": {…} }` wrapper before handing the
 * arguments to `extractSql` / `parseAllocationArgs` / `parseChartRequest`.
 * Those parsers were written to survive a small model's mangled JSON; they now
 * read structured arguments instead, and stay in place as the net for a model
 * that writes its call out as prose anyway.
 */
export function geminiText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const pieces: string[] = [];
  for (const part of parts) {
    if (typeof part.text === "string" && part.text) pieces.push(part.text);
    if (part.functionCall?.name) {
      pieces.push(
        JSON.stringify({ [part.functionCall.name]: part.functionCall.args ?? {} }),
      );
    }
  }
  return pieces.join("\n").trim();
}

/** Why an answer is empty, when it is — `finishReason: "MAX_TOKENS"` on a
 * thinking model means the budget went on thoughts, which is worth seeing in
 * the debug log rather than guessing at. */
export function geminiFinishReason(data: GeminiResponse): string | undefined {
  return data.candidates?.[0]?.finishReason;
}

export function geminiUsage(
  data: GeminiResponse,
): { promptTokens?: number; completionTokens?: number } | undefined {
  const usage = data.usageMetadata;
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokenCount,
    // Thoughts are billed and counted separately; the visible answer is what
    // the log's "completion" column has always meant.
    completionTokens: usage.candidatesTokenCount,
  };
}
