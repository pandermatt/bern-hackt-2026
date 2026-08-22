import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { site } from "@/lib/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * This lives under `[locale]` rather than at the root of `app/`, and it has to.
 * `localePrefix` is "always", so the proxy 307s every unprefixed path — a root
 * `app/opengraph-image.tsx` is advertised as `/opengraph-image`, gets bounced to
 * `/de/opengraph-image`, and 404s there. Under the locale segment the emitted
 * URL already carries the prefix, and `proxy.ts` lets it through unauthenticated
 * by matching on the path with the locale stripped.
 *
 * A crawler renders one card per locale as a result, which is the point: `de` is
 * the default locale, so the most-shared URL is the one that would otherwise
 * have shown English.
 */

/* Copied out of `app/globals.css`, because Satori has no cascade and cannot
   read `var(--brand)`. The card is a Supernova field, which inverts the app's
   usual arrangement: in the UI Supernova is a fill on a white ground and only
   Blue Stone may set type, but *as* the ground it is light enough to carry dark
   ink, so the roles swap. Every pairing used below is measured in a comment. */
const SUPERNOVA = "#FFCC00";
const BRAND_INK = "#5C4700";
const WHITE = "#FFFFFF";
const INK = "#1D1D1F";
const INK_MUTED = "#6E6E73";

/*
 * The bare mark, embedded as a data URI.
 *
 * Read from `res/logos` at module load rather than fetched over the network:
 * this card is generated on the server, and a request back to our own origin
 * to draw our own logo is a round trip that can fail while the page it
 * decorates does not.
 *
 * The *bare* mark, not the app icon — the artwork has an alpha channel now, so
 * it sits straight on the Supernova ground. The white tile this used to need
 * was scaffolding for an earlier, alpha-less file, and a tile here would be a
 * white rectangle on the brand colour for no reason.
 */
const MARK_URI = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "res", "logos", "beyond-money-light-icon-512x512.png"),
).toString("base64")}`;

/* Deliberately a static string and not `generateImageMetadata`, which would be
   the only way to localise it: that convention nests the card under a
   `[__metadata_id__]` segment whose params Next resolves without the parent's,
   so `params.locale` arrives undefined and the image cannot be built at all. */
export const alt = `${site.name} — ${site.tagline}`;

export default async function OpengraphImage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          background: SUPERNOVA,
        }}
      >
        {/* The mark, large, on the right, straight on the brand ground — it
            has its own alpha, so nothing has to sit behind it. The copy column
            ends at x=820; this starts at x=846. */}
        <img
          src={MARK_URI}
          width={300}
          height={300}
          alt=""
          style={{ position: "absolute", top: 165, left: 846 }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "space-between",
            padding: "72px 80px 56px",
          }}
        >
          {/* Mark plus wordmark, with nothing behind either. */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={MARK_URI} width={72} height={72} alt="" />
            <div
              style={{
                display: "flex",
                marginLeft: 26,
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: INK,
              }}
            >
              {site.name}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* 11.1:1 on Supernova. 66px rather than the 74 this sat at while
                it was only ever set in English: the German tagline is six
                characters longer, took a third line, and pushed the block into
                the lockup — `space-between` has no room left to give at that
                size. Both locales wrap to two lines here. */}
            <div
              style={{
                display: "flex",
                maxWidth: 740,
                fontSize: 66,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.03em",
                color: INK,
              }}
            >
              {t("siteTagline")}
            </div>
            {/* `--brand-ink` — Supernova darkened until it clears AA on
                Supernova. 5.9:1. The UI's grey `--text-muted` would be 2.4:1
                here, which is why the secondary line takes a brand tone instead
                of the neutral one it uses on white. */}
            <div
              style={{
                display: "flex",
                maxWidth: 660,
                marginTop: 24,
                fontSize: 29,
                lineHeight: 1.35,
                color: BRAND_INK,
              }}
            >
              {t("siteDescription")}
            </div>
          </div>
        </div>

        {/* A white footer to close the field and stop the card bleeding into a
            light feed background. 16.8:1 and 5.1:1 — the app's own ink pair,
            back on the ground they were derived for. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 88,
            padding: "0 80px",
            background: WHITE,
            fontSize: 25,
            fontWeight: 600,
            color: INK,
          }}
        >
          <div style={{ display: "flex" }}>{t("siteTitle")}</div>
          <div style={{ display: "flex", color: INK_MUTED }}>{new URL(site.url).host}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
