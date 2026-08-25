import { GOAL_ICONS, isGoalIconName, type GoalIconName } from "@/lib/goal-icon";
import {
  geminiApiKey,
  geminiEndpoint,
  geminiFastModel,
  geminiHeaders,
  geminiText,
  toGeminiBody,
  type GeminiResponse,
} from "@/lib/llm/gemini";

/**
 * Asks the model which glyph a savings goal should wear.
 *
 * The keyword table in `lib/goal-icon.ts` is tried first and for free; this is
 * only reached for a name it has nothing to say about — "Töggelikasten",
 * "Kite-Surf-Brett", "Hüttenwochenende" — which would otherwise fall back to
 * the piggy bank and stay there, since a goal's name can never be edited.
 *
 * **The model picks from a list, it does not name a picture.** The choices are
 * the keys of `GOAL_ICONS`, which is the same map the pot renders from, so an
 * answer this file accepts is by construction one the component can draw. An
 * answer outside the list is dropped rather than repaired — the same shape as
 * `canEscalateToAlert` in the anomaly engine, where the model proposes and
 * deterministic code co-signs.
 *
 * **Never throws, and answering `null` is fine.** A goal with no icon is a goal
 * with a piggy bank, which is exactly what the app did before this existed. The
 * same contract `analyzeTransactionInsights` keeps: the LLM is an enhancement,
 * and everything works without it.
 *
 * The goal's name is the only thing sent. That is a label someone typed for
 * their own pot — unlike `Transaction.description`, which the narrative layer
 * is careful never to transmit because on a real statement it is a payment
 * reference.
 */

/**
 * Shorter than the scan's timeout. This one sits inside `createSavingsGoal`,
 * so it is a person waiting on a form rather than a background job — and a
 * goal created promptly with a piggy bank beats a goal that takes half a
 * minute to arrive with a dog on it.
 *
 * It is also why this is the one call that does not use the assistant's model:
 * `geminiFastModel` is a Flash model, and Flash is the one that can be told
 * not to think at all. A reasoning model fits in neither this budget nor the
 * 32-token answer below.
 */
const REQUEST_TIMEOUT_MS = 6_000;

/** A goal name longer than this is not a goal name. */
const MAX_NAME_CHARS = 120;

/**
 * One name per line, not a comma run-on.
 *
 * Measured against the 8B model, and the difference is not subtle: with the
 * list inline and the constraint stated once, it answered "Kite" for a
 * kitesurf board and "Coat" for a winter jacket — plausible words, no such
 * icons, both correctly thrown away below and both a piggy bank on screen. As
 * a scannable list, with the "pick the nearest thing that IS on the list" rule
 * and four worked examples of doing exactly that, 15 of 16 Swiss-German goal
 * names came back usable — a surfboard as `Ship`, a garden as `Sprout`, a
 * marathon as `Dumbbell`.
 */
const CHOICES = Object.keys(GOAL_ICONS)
  .map((name) => `- ${name}`)
  .join("\n");

const SYSTEM_PROMPT = `You pick an icon for a personal savings goal.

The name may be in German (Swiss usage), English, or Swiss German dialect.

These are the only icons that exist:
${CHOICES}

Rules:
- Copy one name from the list above, character for character.
- The list cannot be extended. If the exact object is missing, pick the nearest
  thing that IS on the list — a surfboard is Ship, a winter coat is Shirt, a
  garden is Sprout, a marathon is Dumbbell.
- Only answer PiggyBank when nothing on the list is any closer than "money".
- Never write a word that is not on the list.

Answer with JSON and nothing else: {"icon": "<one name from the list>"}`;

export async function suggestGoalIcon(name: string): Promise<GoalIconName | null> {
  const goal = name.trim().slice(0, MAX_NAME_CHARS);
  if (!goal) return null;

  const key = geminiApiKey();
  if (!key) {
    console.warn(
      "GEMINI_API_KEY is not set. Skipping the icon suggestion and falling back to the keyword rules.",
    );
    return null;
  }

  const model = geminiFastModel();

  try {
    const response = await fetch(geminiEndpoint(model), {
      method: "POST",
      headers: geminiHeaders(key),
      body: JSON.stringify(
        toGeminiBody({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Savings goal: ${goal}` },
          ],
          json: true,
          // The reply is one word in a JSON wrapper. A cap this low also means
          // a model that starts explaining itself is cut off rather than
          // billed — which only works with thinking switched off, since
          // thoughts are charged against the same budget.
          maxTokens: 32,
          thinking: 0,
          // Naming a picture for a phrase is a lookup, not a creative act; the
          // same reasoning the narrative layer uses.
          temperature: 0.1,
        }),
      ),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Icon suggestion failed with status ${response.status}.`);
      return null;
    }

    const content = geminiText((await response.json()) as GeminiResponse);
    if (!content) return null;

    const parsed: unknown = JSON.parse(content);
    const suggested =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { icon?: unknown }).icon
        : undefined;

    // The co-signature. Anything that is not one of ours is not an answer.
    if (typeof suggested !== "string" || !isGoalIconName(suggested)) {
      return null;
    }

    return suggested;
  } catch (error) {
    // A timeout, a network failure, or a reply that is not JSON. All of them
    // mean the same thing here: no icon, carry on.
    console.error("Icon suggestion could not be completed.", error);
    return null;
  }
}
