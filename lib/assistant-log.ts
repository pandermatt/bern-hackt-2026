/**
 * In-memory ring buffer of the assistant's upstream API calls, for the chat
 * sidebar's debug menu. Deliberately not a table: debug telemetry has no
 * business surviving a restart, and the database schema stays untouched.
 *
 * `server-only` because entries hold prompts built from a user's finances.
 * The client imports only the types (type imports are erased at compile
 * time, so they don't trip the poison). Cached on `globalThis` for the same
 * reason as `db/index.ts` — dev HMR must not reset the buffer.
 */
import "server-only";

export type AssistantLogStatus = "ok" | "error";

export type AssistantLogEntry = {
  id: number;
  userId: number;
  /** ISO timestamp of when the turn started. */
  at: string;
  durationMs: number;
  status: AssistantLogStatus;
  /** Missing when the request never left the server (config error, etc.). */
  httpStatus?: number;
  error?: string;
  model: string;
  maxTokens: number;
  question: string;
  /** Which round of the tool loop this request was, and what it fetched. */
  note?: string;
  /** How many chat messages were sent upstream, system prompt included. */
  messageCount: number;
  /** The JSON body sent upstream, pretty-printed and truncated. No key. */
  request?: string;
  /** The raw upstream response body, truncated. */
  response?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
};

/** What the debug menu receives — everything except the owner scoping. */
export type AssistantLogView = Omit<AssistantLogEntry, "userId">;

const CAPACITY = 50;
/** Payload snapshots are for eyeballing, not archiving. */
export const SNAPSHOT_LIMIT = 6000;

const globalStore = globalThis as unknown as {
  __assistantLog?: { seq: number; entries: AssistantLogEntry[] };
};

const store = (globalStore.__assistantLog ??= { seq: 0, entries: [] });

export function truncateSnapshot(text: string): string {
  return text.length > SNAPSHOT_LIMIT
    ? `${text.slice(0, SNAPSHOT_LIMIT)}\n… truncated (${text.length} chars total)`
    : text;
}

export function pushAssistantLog(entry: Omit<AssistantLogEntry, "id">): void {
  store.entries.push({ ...entry, id: ++store.seq });
  if (store.entries.length > CAPACITY) {
    store.entries.splice(0, store.entries.length - CAPACITY);
  }
}

/** Newest first, and only ever the caller's own turns. */
export function listAssistantLog(userId: number): AssistantLogView[] {
  return store.entries
    .filter((entry) => entry.userId === userId)
    .map((entry) => {
      const { userId: _, ...view } = entry;
      void _;
      return view;
    })
    .reverse();
}

export function clearAssistantLog(userId: number): void {
  store.entries = store.entries.filter((entry) => entry.userId !== userId);
}
