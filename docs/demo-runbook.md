# Demo runbook

The live demo runs a few hours every few months. The marketing page runs every
day. This is how those two facts share one address.

**Hetzner bills a Cloudflare server until it is deleted, not until it is
powered off** — the hardware stays reserved for you either way. So between
demos the box is destroyed and recreated from a snapshot, and a Cloudflare
Worker answers in its place.

| | |
| --- | --- |
| Between demos | **€0.22/month** of snapshot storage — 15.47 GB used at €0.0143/GB/month. Billed on **used** space, not the 80 GB disk, which is why the disk size the snapshot has to be restored onto does not matter to the bill |
| During a demo | the same CX33 the snapshot came from — €8.49/month works out at ~€0.012/hour, so a six-hour demo is about €0.07 |
| Cloudflare | free tier, and roughly one request per page view against 100k/day |

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

Done on 2026-08-26. Kept because a server rebuilt from scratch needs it again,
and because two of these steps are not guessable.

1. Install `cloudflared`. **`pkg.cloudflare.com` is an apt repository, not a
   file server** — the flat `cloudflared-stable-linux-amd64.deb` path that used
   to exist now 404s:

   ```bash
   sudo mkdir -p --mode=0755 /usr/share/keyrings && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   ```

   ```bash
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared
   ```

2. Create the tunnel and route the hostname at it. That hostname must **not** be
   one the Worker is routed on, or every proxied request loops back in:

   ```bash
   cloudflared tunnel login && cloudflared tunnel create beyond-money-origin
   ```

   ```bash
   cloudflared tunnel route dns beyond-money-origin origin.beyond-money.ch
   ```

3. Write `/etc/cloudflared/config.yml`. **The port is the part that bites:**

   ```yaml
   tunnel: 6dc872b1-3e39-4f6d-991f-a29d4237e58a
   credentials-file: /root/.cloudflared/6dc872b1-3e39-4f6d-991f-a29d4237e58a.json

   ingress:
     - hostname: origin.beyond-money.ch
       service: https://localhost:443
       originRequest:
         httpHostHeader: beyond-money.ch
         noTLSVerify: true
     - service: http_status:404
   ```

   Three things, each of which produced a wrong answer on the way here:

   - **`:443`, not `:80`.** Coolify's proxy on port 80 answers everything with a
     302 to `https://beyond-money.ch`. Behind the Worker that is an infinite
     redirect — Worker to tunnel to Coolify to `beyond-money.ch` and back into
     the Worker. Port 443 is where the app actually is.
   - **`httpHostHeader`.** Coolify routes by `Host` and has no route for the
     tunnel's own hostname, so without this it answers 404. Rewriting the header
     is better than registering the hostname in Coolify, which would also make
     it chase a certificate it does not need.
   - **`noTLSVerify`.** The connection is to `localhost` while the certificate
     is for the public name.

   Then check it before starting anything:

   ```bash
   cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
   ```

4. Install it as a service, so a server recreated from the snapshot dials out
   on boot — this is what makes the whole scheme work with no DNS edit:

   ```bash
   sudo cloudflared service install && sudo systemctl enable --now cloudflared
   ```

5. Confirm `ORIGIN` in [edge/wrangler.jsonc](../edge/wrangler.jsonc) matches the
   hostname, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the
   repository secrets, and push to `main`.

   `npm run edge:deploy` refuses to run while that hostname has no DNS record —
   see [scripts/deploy-edge.ts](../scripts/deploy-edge.ts). Deploying the Worker
   before the tunnel existed is what took the site down on 2026-08-26: the
   Worker probed a hostname that was not there, concluded the box was gone, and
   served the asleep page to everyone while the server ran fine behind it.

## DNS records

Two records matter, and the first is counter-intuitive. There is deliberately
no `www` — it is not wanted, and `wrangler.jsonc` carries no route for it.

| Record | Value | Why |
| --- | --- | --- |
| `beyond-money.ch` | `A 192.0.2.1`, **proxied** | A Worker route only fires if a proxied DNS record exists at the hostname. Delete it and the site stops resolving entirely. `192.0.2.1` is the reserved placeholder for an originless name — traffic never reaches it, Cloudflare hands it to the Worker. **Do not leave it pointing at the Hetzner IP**: that address goes back into Hetzner's pool when the server is deleted and is reassigned to somebody else. |
| `origin.beyond-money.ch` | created by `cloudflared tunnel route dns` | The tunnel. Created once, outlives every server built from the snapshot — which is exactly what the deploy guard checks for. |

`dev.beyond-money.ch` is a Cloudflare redirect rule pointing at the GitHub
repository, not a deployment.

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

3. **Take the snapshot**, and give it a name with the date in it. If the app
   was redeployed during this demo, this step is what stops the *next* wake
   starting from the same stale image — an image that is never retaken falls
   further behind `main` every time something merges.

4. **Delete the server.** This is the step that stops the billing; nothing
   before it does.

Within a minute or two the Worker's health probe fails and the site switches
over on its own. Check <https://beyond-money.ch/> shows the asleep notice.

## Waking it up

1. Create a server from the snapshot, **on the type it came from**. A snapshot
   carries its source disk and can only be restored onto a type with at least
   that much — a CX33's 80 GB will not fit on a CX23, and Hetzner refuses with
   *"image disk is bigger than server type disk"*. There is no way to shrink it.
   That is fine: billing is hourly, so the larger type costs pennies for a demo
   and the monthly figure never applies. (An x86 snapshot also cannot go onto an
   ARM/CAX type.)
2. Coolify's containers restart on their own, `cloudflared` dials out, and the
   Worker starts proxying within a minute — **at whatever new IP Hetzner hands
   out**, with nothing to reconfigure. That is what the tunnel buys.

3. **Redeploy in Coolify if anything landed on `main` since the snapshot.**
   The snapshot is an image of the app as it was when it was taken; merging
   while the box is destroyed cannot update it, because Coolify is on the box.
   The edge half *does* keep up — `deploy-edge` runs entirely on a GitHub
   runner — so after a merge into a sleeping deployment the two disagree: the
   edge serves the new prerendered pages and the restored box serves the old
   app. Nothing breaks, and the fix is one deploy from the Coolify UI.

   ```bash
   git log --oneline <snapshot-date>..origin/main
   ```

   Empty means the image is current and there is nothing to do.

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
