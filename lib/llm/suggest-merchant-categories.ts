import { z } from "zod";

import { isCategory, UNFILED } from "@/lib/merchant-overrides";
import {
  callGemini,
  geminiApiKey,
  geminiFastModel,
  geminiText,
  modelChain,
  toGeminiBody,
  type GeminiResponse,
} from "@/lib/llm/gemini";
import { CATEGORIES } from "@/scripts/lib/statement";

/*
 * Asks the model which category each unrecognised merchant belongs in.
 *
 * `scripts/lib/statement.ts` files anything its keyword rules cannot place
 * under `Other`, and those rules are code shipped for everybody — they cannot
 * be taught about the shops on somebody's own statement. `/account` has always
 * let a person file those merchants by hand, one select at a time; this is the
 * same list, filled in in one go.
 *
 * Three things it does not do, on purpose:
 *
 * - **It does not write anything.** The answers land in the form's selects and
 *   the person presses Save, because a model quietly re-filing how somebody's
 *   money is categorised — which moves the donut, the budget and the ledger —
 *   is not a decision to take on their behalf while they are looking the other
 *   way. The same "the model proposes, deterministic code co-signs" split the
 *   anomaly engine's `canEscalateToAlert` makes.
 * - **It does not invent a category.** The choices are the app's own
 *   `CATEGORIES`, which is what the ledger colours, the budget sums and the
 *   catalogs translate, so an answer this module accepts is by construction one
 *   the rest of the app can render. Anything else is dropped rather than
 *   repaired.
 * - **It never throws.** A missing key, a timeout, a truncated reply: all of
 *   them mean the same thing here — no suggestions, the list is filled in by
 *   hand as before. The LLM is an enhancement, the way it is everywhere else in
 *   this app.
 *
 * **Only merchant names are sent.** Not the amounts, not the line counts, and
 * never `Transaction.description` — on a real statement that is a payment
 * reference, which is why the narrative layer is careful never to transmit one
 * either. A canonical merchant name is what the narrative layer already sends
 * through its `contextOf` lookup.
 */

/**
 * Merchants per request.
 *
 * The binding constraint is output, not input: one answer is a name and a
 * category, ~20 tokens, so twenty of them is ~400 against the 1200 cap below.
 * The headroom is the point — a reply that runs over the cap is truncated
 * mid-JSON, which is unparseable, which loses the whole batch. Don't raise this
 * to buy fewer round trips.
 */
const MAX_BATCH_MERCHANTS = 20;

/**
 * A sanity bound on the whole job, not a business rule. The mapper's own save
 * accepts 500 entries; an account with more unfiled merchants than this is one
 * where a person is going to want to work through them in passes anyway, and
 * the count in the toast says how many came back.
 */
const MAX_MERCHANTS = 200;

/** Per request. Longer than the goal-icon call, which answers with one word. */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * For the whole job, batches included. A person is waiting on a button, and
 * three batches each walking a four-model chain at twelve seconds a try is
 * minutes of a spinner. Whatever has answered when this trips is what gets
 * filled in.
 */
const OVERALL_TIMEOUT_MS = 30_000;

/** A merchant name longer than this is not a merchant name. */
const MAX_NAME_CHARS = 120;

/**
 * What the model may answer, one per line rather than a comma run-on — the
 * shape `suggest-goal-icon.ts` measured as the difference between a usable
 * answer and an invented word.
 *
 * `Opening balance` is not on it: that is the single synthetic line each
 * importer writes to seed the running balance, not a place to put a merchant.
 * It is the same list the mapper's own select offers, from the same constant,
 * so the model cannot answer something the form has no option for.
 */
const CHOICES = CATEGORIES.filter((category) => category !== "Opening balance")
  .map((category) => `- ${category}`)
  .join("\n");

const SYSTEM_PROMPT = `You file merchants from a Swiss bank statement into spending categories.

The names are shops, services, subscriptions, employers and payment apps. Many
are Swiss and may be in German (Swiss usage); many are international.

These are the only categories that exist:
${CHOICES}

Rules:
- Copy one category from the list above, character for character.
- The list cannot be extended. If the exact fit is missing, pick the nearest
  category that IS on the list — a pharmacy is Health & Insurance, a hairdresser
  is Other, a car park is Transport, a streaming service is Subscriptions.
- "Cash & Transfers" is money that moved without buying anything: an ATM or
  bank machine, a TWINT or Revolut payment to a person, anything written as
  "Sent to" a name or a set of initials, and money moved between the account
  holder's own accounts.
- Answer "${UNFILED}" whenever the name does not say what was bought and is not
  one of the above: a bare payment app, an abbreviation you do not recognise. A
  wrong guess is worse than no guess — it moves somebody's budget.
- "Salary" is money coming in from an employer and "Refund" is money coming
  back from a shop.
- Answer for every name you are given, exactly as it was written.

Answer with JSON and nothing else:
{"merchants": [{"name": "<name as given>", "category": "<one category from the list>"}]}`;

const replySchema = z.object({
  merchants: z
    .array(z.object({ name: z.string(), category: z.string() }))
    .max(MAX_BATCH_MERCHANTS * 2),
});

/** Case and spacing are the model's to get wrong; the name itself is not. */
const normalize = (name: string) => name.trim().toLowerCase();

/**
 * A category for as many of these merchants as the model can place.
 *
 * The map holds only merchants that were asked about and came back with a real
 * category — `Other` is dropped, because "no opinion" is the state every one of
 * these rows is already in, and storing it would be an opinion that they belong
 * in `Other`.
 */
export async function suggestMerchantCategories(
  merchants: string[],
): Promise<Map<string, string>> {
  const names = [...new Set(merchants.map((name) => name.trim()))]
    .filter((name) => name.length > 0 && name.length <= MAX_NAME_CHARS)
    .slice(0, MAX_MERCHANTS);

  const filed = new Map<string, string>();
  if (names.length === 0) return filed;

  const key = geminiApiKey();
  if (!key) {
    console.warn(
      "GEMINI_API_KEY is not set. Skipping the category suggestions; the list is filled in by hand.",
    );
    return filed;
  }

  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += MAX_BATCH_MERCHANTS) {
    batches.push(names.slice(i, i + MAX_BATCH_MERCHANTS));
  }

  // The fast model leads, as it does for the goal icon: this is a person
  // waiting on a button, and filing a merchant is a lookup rather than a
  // reasoning problem.
  const models = modelChain(geminiFastModel());
  const deadline = AbortSignal.timeout(OVERALL_TIMEOUT_MS);

  /*
   * In parallel, not one after another. The batches are independent, a typical
   * account is one or two of them, and the alternative is a spinner that runs
   * for the sum of every round trip. The overall deadline covers them all.
   */
  const answers = await Promise.all(
    batches.map((batch) => requestBatch(batch, key, models, deadline)),
  );

  for (const [index, answer] of answers.entries()) {
    if (!answer) continue;
    const asked = new Map(batches[index].map((name) => [normalize(name), name]));

    for (const entry of answer.merchants) {
      // The model may only answer about names it was given. Anything else is a
      // handle it invented, and filing a merchant nobody asked about would put
      // a category on a row the person cannot see.
      const merchant = asked.get(normalize(entry.name));
      if (merchant === undefined) continue;

      // The co-signature. A category the app does not have is not an answer,
      // and `Other` is the absence of one.
      const category = entry.category.trim();
      if (!isCategory(category) || category === UNFILED) continue;
      if (category === "Opening balance") continue;

      filed.set(merchant, category);
    }
  }

  return filed;
}

/** One batch, or `null` if anything at all went wrong with it. */
async function requestBatch(
  batch: string[],
  key: string,
  models: string[],
  deadline: AbortSignal,
): Promise<z.infer<typeof replySchema> | null> {
  try {
    const call = await callGemini({
      models,
      key,
      body: (target) =>
        toGeminiBody({
          model: target,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({ merchants: batch }) },
          ],
          json: true,
          maxTokens: 1200,
          // Filing a shop under a category is a lookup, not a creative act —
          // the same reasoning the narrative layer and the goal icon use.
          temperature: 0.1,
        }),
      timeoutMs: REQUEST_TIMEOUT_MS,
      extraSignal: deadline,
      onAttempt: (attempt) => {
        if (attempt.error) {
          console.error(
            `Category suggestion failed on ${attempt.model}: ${attempt.error}`,
          );
        }
      },
    });

    if (!call.ok) return null;

    const content = geminiText(JSON.parse(call.raw) as GeminiResponse);
    if (!content) return null;

    const parsed = replySchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // A timeout, a network failure, or a reply that is not JSON. All of them
    // mean the same thing: this batch has no suggestions in it.
    console.error("Category suggestions could not be completed.", error);
    return null;
  }
}
