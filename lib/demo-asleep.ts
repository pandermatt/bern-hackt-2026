import { headers } from "next/headers";

/**
 * The demo server exists for a few hours every few months; the marketing page
 * has to be up every day. A Cloudflare Worker in front of the origin serves a
 * prerendered copy of the landing page whenever the box is gone — see
 * `edge/worker.ts` and `docs/demo-runbook.md`.
 *
 * That copy needs its call-to-action buttons to say something other than "Sign
 * in", because there is nothing behind them. This header is how CI asks the
 * running server for that second render: the deploy curls `/de` twice, once
 * plain and once with the header set, and ships both documents.
 *
 * **A request header rather than a query string**, deliberately. The two
 * documents have to be interchangeable at the same URL — the Worker serves
 * either one at `/de` — and Next inlines the route's own search params into the
 * flight payload it hydrates from. `/de?asleep=1` would hydrate claiming a
 * query string the address bar does not have.
 *
 * Trusting a header off the wire is only safe because of how the box is
 * reached: `cloudflared` dials out, so the origin has no public address and
 * every request arrives through the Worker, which never forwards this. And the
 * blast radius if one ever did is that a visitor reads the wrong sentence
 * about a server that is, in fact, running.
 */
export const DEMO_ASLEEP_HEADER = "x-demo-asleep";

/** Whether this render is the "origin is gone" copy of the landing page. */
export async function isDemoAsleep(): Promise<boolean> {
  return (await headers()).get(DEMO_ASLEEP_HEADER) === "1";
}
