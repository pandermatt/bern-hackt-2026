# Demo runbook

The live demo runs a few hours every few months. The marketing page runs every
day. This is how those two facts share one address.

**Hetzner bills a Cloudflare server until it is deleted, not until it is
powered off** — the hardware stays reserved for you either way. So between
demos the box is destroyed and recreated from a snapshot, and a Cloudflare
Worker answers in its place.

| | |
| --- | --- |
| Between demos | ~€0.15–0.25/month of snapshot storage (€0.0143/GB/month on used space) |
| During a demo | a CX23 at ~€5.49/month, billed by the hour |
| Cloudflare | free tier |

## How it fits together

```
visitor → Cloudflare Worker (always on)
            ├── prerendered landing + offline pages, _next/static, public/
            └── fetch(ORIGIN) → Cloudflare Tunnel → Hetzner box (only during a demo)
```

- [edge/worker.ts](../edge/worker.ts) probes `/api/health` and proxies
  everything to the box while it answers. With the box gone, `/de` and `/en`
  serve a prerendered landing page whose sign-up buttons are replaced by a
  "the live demo is asleep" note, and every other address gets the app's own
  offline page with a 503.
- The documents are curled out of a real `next start` by the `deploy-edge` job
  in [.github/workflows/ci.yml](../.github/workflows/ci.yml) on every push to
  `main`, so the copy sitting on Cloudflare for a quarter is always the current
  build's. Which render you get is decided by one request header — see
  [lib/demo-asleep.ts](../lib/demo-asleep.ts).
- **The tunnel is why none of this needs reconfiguring.** `cloudflared` is
  installed in the snapshot and dials *out*, so a recreated server is reachable
  at the same hostname with a new IP, no DNS edit and no Worker redeploy. It
  also means the box needs no public IPv4 at all.

## One-time setup

Do this on the box **as it stands today**, before the first snapshot. A
snapshot taken before the tunnel is configured comes back unreachable.

1. Install `cloudflared` and create a named tunnel:

   ```bash
   cloudflared tunnel login
   ```

   ```bash
   cloudflared tunnel create beyond-money-origin
   ```

2. Route the origin hostname at it. This hostname must **not** be one the
   Worker is routed on, or every proxied request loops back into the Worker:

   ```bash
   cloudflared tunnel route dns beyond-money-origin origin.beyond-money.ch
   ```

3. Point the tunnel at Coolify's port in `/etc/cloudflared/config.yml`, then
   install it as a service so a recreated server dials out on boot:

   ```bash
   sudo cloudflared service install
   ```

4. Confirm `ORIGIN` in [edge/wrangler.jsonc](../edge/wrangler.jsonc) matches
   that hostname, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the
   repository secrets, and push to `main` to deploy the Worker.

5. **Rehearse the whole cycle before relying on it.** Take a snapshot, create a
   *second* server from it, and check the app comes up with the demo account's
   transactions intact and the tunnel reconnected. Only delete the original
   once that has passed. This is the step that turns "the snapshot should
   contain everything" into something you know.

## Putting the demo to sleep

The order matters. The database runs in WAL mode
([db/index.ts](../db/index.ts)), and Hetzner does not guarantee disk
consistency on a snapshot of a running system — a live snapshot can capture a
torn write.

1. **Stop the app**, so SQLite checkpoints its WAL and closes cleanly. From
   Coolify, stop the application; or on the box:

   ```bash
   docker compose down
   ```

2. **Power the server off** — a full shutdown, not a reboot. Wait for Hetzner
   to report it off.

3. **Take the snapshot**, and give it a name with the date in it.

4. **Delete the server.** This is the step that stops the billing; nothing
   before it does.

Within a minute or two the Worker's health probe fails and the site switches
over on its own. Check <https://beyond-money.ch/> shows the asleep notice.

## Waking it up

1. Create a server from the snapshot. The type must have **at least** the
   snapshot's disk size, and an x86 snapshot cannot be restored onto an ARM
   (CAX) type — pick the same family you snapshotted from.
2. That is the whole procedure. Coolify's containers restart on their own,
   `cloudflared` dials out, and the Worker starts proxying within a minute.

Check <https://beyond-money.ch/api/health> returns `{"ok":true}` and that the
landing page has its sign-in buttons back.

## Things that will bite

- **Snapshots do not include attached Volumes.** This deployment keeps `data/`
  on the root disk, which is why the plain snapshot is enough. If a Volume is
  ever attached and `DATABASE_PATH` moved onto it, the snapshot will silently
  stop containing the database.
- **`edge/dist` is never committed.** It is this build's `_next/static` under
  this build's content hashes; a stale copy is an unstyled page.
- **Don't point `ORIGIN` at a hostname the Worker serves.** The Worker would
  proxy to itself.
- The landing page is prerendered, so its links prefetch against an origin that
  is not there. Those requests fail in the console and the links still work —
  Next falls back to a full navigation, which the Worker answers.

## Doing it by hand

The Worker deploys from CI, but both halves can be run locally:

```bash
npm run build && npx next start & npm run edge:build
```

```bash
npm run edge:dev
```

`edge:dev` accepts `--var ORIGIN:http://127.0.0.1:3000` to test against a local
server, and any dead address to test the asleep path.
