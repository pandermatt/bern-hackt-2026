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
 * The app icon, embedded as a data URI.
 *
 * Read from `public/` at module load rather than fetched over the network:
 * this card is generated on the server, and a request back to our own origin
 * to draw our own logo is a round trip that can fail while the page it
 * decorates does not.
 *
 * It used to be an inline SVG whose `fill` this file chose — that is what let
 * the old signet be re-tinted for the ground it sat on. The dragon is raster
 * and has no alpha, so it cannot be tinted and cannot sit directly on the
 * brand ground; it gets the same white tile the header gives it.
 */
const MARK_URI = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public", "icon-512.png"),
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
        {/* The mark, large, on the right. It used to be an oversized silhouette
            bleeding off the edge — that worked because it was a tintable vector
            that could be a single Blue Stone shape on the yellow. A raster with
            a white ground cannot bleed off anything without reading as a torn
            white rectangle, so it is contained on its own rounded tile
            instead. The copy column ends at x=820; this starts at x=856. */}
        <img
          src={MARK_URI}
          width={288}
          height={288}
          alt=""
          style={{
            position: "absolute",
            top: 171,
            left: 856,
            borderRadius: 48,
            background: WHITE,
          }}
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
          {/* Mark plus wordmark. The mark keeps its white tile here too — the
              artwork has no alpha, so the tile is not a decision, it is what
              the file already is. */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <img
              src={MARK_URI}
              width={72}
              height={72}
              alt=""
              style={{ borderRadius: 14, background: WHITE }}
            />
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
