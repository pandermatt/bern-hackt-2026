/**
 * `wrangler deploy`, with one preflight check in front of it.
 *
 * The Worker's routes claim `beyond-money.ch/*`, so deploying it puts it in
 * front of production immediately. Its whole job is deciding "is the box
 * there?" by probing `ORIGIN` — and the first time this was run, `ORIGIN` was
 * a hostname the tunnel had not created yet. The Worker did exactly what it is
 * built to do, concluded the server was gone, and served the "demo is asleep"
 * page to every visitor while the box hummed along behind it.
 *
 * **The check is DNS, not liveness**, and that distinction is the whole point.
 * A dead origin is the normal steady state here — the box is destroyed between
 * demos, and CI still deploys on every push to `main`, so refusing when
 * `ORIGIN` does not *answer* would block every ordinary deploy. What must never
 * happen is deploying when `ORIGIN` does not *exist*: `cloudflared tunnel route
 * dns` creates that record once and it outlives every server built from the
 * snapshot. Present means the tunnel was set up; absent means it never was.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { resolve } from "node:path";

const CONFIG = resolve("edge/wrangler.jsonc");

/**
 * Public resolvers, asked directly rather than through the system one.
 *
 * The machine that sets the tunnel up is the machine most likely to have
 * cached the *absence* of that hostname minutes earlier, and a negative cache
 * entry outlives the record's creation — which would fail this check on the
 * one deploy it was written to allow. These see the record the moment
 * Cloudflare has it.
 */
const RESOLVERS = ["1.1.1.1", "8.8.8.8"];

/** Codes that mean "the name genuinely is not there", as opposed to "ask again". */
const ABSENT = new Set(["ENOTFOUND", "NOTFOUND", "NXDOMAIN", "ENODATA"]);

/** The `ORIGIN` var, read out of the Worker's own config. */
function originHostname(): string {
  // `wrangler.jsonc` allows comments, and there is no JSONC parser in the
  // dependency tree for one field. The var is a plain string on its own line.
  const config = readFileSync(CONFIG, "utf8");
  const match = config.match(/"ORIGIN"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`no ORIGIN var found in ${CONFIG}`);
  }
  return new URL(match[1]).hostname;
}

async function main(): Promise<void> {
  const hostname = originHostname();
  const resolver = new Resolver();
  resolver.setServers(RESOLVERS);

  try {
    await resolver.resolve(hostname);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";

    // A resolver that could not be reached says nothing about the hostname.
    // Blocking a deploy on a network hiccup is worse than the mistake this
    // guards against, which is a one-time setup order, so say so and continue.
    if (!ABSENT.has(code)) {
      console.warn(
        `Could not check ${hostname} (${code || "unknown DNS error"}). ` +
          `Proceeding.\n`,
      );
    } else {
      console.error(
        `\nRefusing to deploy: ${hostname} does not exist.\n\n` +
          `The Worker takes over beyond-money.ch the moment it deploys, and it\n` +
          `decides whether the app is up by asking ${hostname}. With no DNS\n` +
          `record there, every visitor gets the "demo is asleep" page even while\n` +
          `the server is running.\n\n` +
          `Set the tunnel up first — docs/demo-runbook.md, "One-time setup".\n` +
          `That record is created once and survives every snapshot, so this\n` +
          `check passes from then on, including while the box is destroyed.\n`,
      );
      process.exit(1);
    }
  }

  console.log(`${hostname} resolves — deploying.\n`);

  const deploy = spawnSync(
    "wrangler",
    ["deploy", "--config", CONFIG, ...process.argv.slice(2)],
    { stdio: "inherit", shell: true },
  );
  process.exit(deploy.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
