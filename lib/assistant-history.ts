/**
 * The shape a chat turn arrives in, shared by the server action and the
 * streaming route so both read it identically. Its own module rather than a
 * member of `lib/assistant.ts`: that one is imported for its types by client
 * components, and this is the server's business.
 */

/**
 * The history, made usable rather than policed. The client ships its whole
 * transcript and assistant bubbles are unbounded (MAX_TOKENS may be unset), so
 * a hard schema reject here once BRICKED long conversations: the rejection's
 * own error bubble pushed every following turn over the same limit, for good.
 * Only garbage is refused now — sizes are clamped to what the prompt would
 * use anyway (the last 24 messages, 2000 chars each).
 */
export function normalizeHistory(
  raw: unknown,
): { role: "user" | "assistant"; content: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw.flatMap(
    (entry): { role: "user" | "assistant"; content: string }[] => {
      if (!entry || typeof entry !== "object") return [];
      const { role, content } = entry as { role?: unknown; content?: unknown };
      if (role !== "user" && role !== "assistant") return [];
      if (typeof content !== "string") return [];
      const trimmed = content.trim();
      return trimmed ? [{ role, content: trimmed.slice(0, 2000) }] : [];
    },
  );
  const tail = cleaned.slice(-24);
  return tail.some((m) => m.role === "user") ? tail : undefined;
}
