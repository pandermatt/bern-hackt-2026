import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

import { SIGNET_PATHS, SIGNET_VIEWBOX } from "@/lib/signet";
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
   read `var(--brand)`.

   The card used to be a full-bleed Supernova field with the PostFinance signet
   in Blue Stone over it, which worked because that mark was one flat colour
   and could be given whichever one the ground needed. The dragon cannot: its
   own yellows and its orange head are the drawing, and on Supernova half the
   coil simply vanished. So the field and the band traded places — white ground
   for the artwork, Supernova for the closing band — and the ink assignments
   below moved with them. Every pairing carries its measured ratio. */
const SUPERNOVA = "#FFCC00";
const BRAND_INK = "#5C4700";
const WHITE = "#FFFFFF";
const INK = "#1D1D1F";
const INK_MUTED = "#6E6E73";

/* Satori renders SVG reliably through an <img> data URI, so the mark is
   embedded rather than written as JSX elements. No fill parameter, unlike the
   single-path signet this replaced: the colours belong to the artwork. */
function dragonUri() {
  const paths = SIGNET_PATHS.map(
    (path) => `<path d="${path.d}" fill="${path.fill}"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SIGNET_VIEWBOX}">${paths}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

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
          background: WHITE,
        }}
      >
        {/* The dragon, oversized and just running off the right edge. How far
            it may bleed is bounded on both sides: the artwork's own left margin
            has to clear the copy column, which ends at x=820, and the card's
            edge has to fall in the tail flames rather than through the head.
            At this offset the drawing spans x 875–1226 and the head, which sits
            in its upper right, survives the cut. The bottom stops at 510, above
            the band at 542. */}
        <img
          src={dragonUri()}
          width={480}
          height={480}
          alt=""
          style={{ position: "absolute", top: 30, right: -100 }}
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
          {/* Mark plus wordmark, with no tile behind it — the ground is already
              the white the app's own tile provides, so a tile here would be a
              white square on white. */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={dragonUri()} width={72} height={72} alt="" />
            <div
              style={{
                display: "flex",
                marginLeft: 20,
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
            {/* 16.8:1 on white. 66px rather than the 74 this sat at while it
                was only ever set in English: the German tagline is six
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
            {/* 5.1:1 on white — the app's own muted ink, back on the ground it
                was derived for. On the old Supernova field this line had to
                take a brand tone instead; it does not any more. */}
            <div
              style={{
                display: "flex",
                maxWidth: 660,
                marginTop: 24,
                fontSize: 29,
                lineHeight: 1.35,
                color: INK_MUTED,
              }}
            >
              {t("siteDescription")}
            </div>
          </div>
        </div>

        {/* A Supernova band to close the field. It is what keeps the brand
            colour on a card whose ground had to give it up, and it stops a
            white card bleeding into a white feed. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 88,
            padding: "0 80px",
            background: SUPERNOVA,
            fontSize: 25,
            fontWeight: 600,
            color: INK,
          }}
        >
          {/* 11.1:1 on Supernova. */}
          <div style={{ display: "flex" }}>{t("siteTitle")}</div>
          {/* `--brand-ink`, Supernova darkened until it clears AA on Supernova:
              5.9:1. The grey above would be 2.4:1 here, which is the whole
              reason this band could not simply keep the ink it had on white. */}
          <div style={{ display: "flex", color: BRAND_INK }}>
            {new URL(site.url).host}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
