import { sql } from "drizzle-orm";

import { db } from "@/db";
import pkg from "@/package.json";

// Never cached: a healthcheck that answers from cache is not a healthcheck.
export const dynamic = "force-dynamic";

/**
 * Target for the host's healthcheck (Coolify). Touches the database so a
 * missing volume or unpushed schema shows up as unhealthy rather than as a
 * page that renders and then 500s on first use.
 *
 * Listed in the proxy's public allowlist — healthchecks carry no session.
 */
export async function GET() {
  try {
    db.get(sql`select 1`);
    return Response.json({ ok: true, version: pkg.version });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        version: pkg.version,
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
}
