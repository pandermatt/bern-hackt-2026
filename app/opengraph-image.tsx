import { ImageResponse } from "next/og";

import { SIGNET_PATH, SIGNET_VIEWBOX } from "@/lib/signet";
import { site } from "@/lib/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${site.name} — ${site.description}`;

/* The same mark as app/icon.svg. Satori renders SVG reliably through an <img>
   data URI, so the signet is embedded rather than written as JSX elements. */
const SIGNET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SIGNET_VIEWBOX}"><path d="${SIGNET_PATH}" fill="#004B5A"/></svg>`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f5f8f9",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "96px",
              height: "96px",
              borderRadius: "21px",
              background: "#FFCC00",
            }}
          >
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(SIGNET)}`}
              width={61}
              height={64}
              alt=""
            />
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "28px",
              fontSize: "56px",
              fontWeight: 600,
              color: "#0b2e36",
            }}
          >
            {site.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: "64px",
              fontWeight: 600,
              color: "#0b2e36",
              lineHeight: 1.15,
            }}
          >
            {site.tagline}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: "24px",
              fontSize: "30px",
              color: "#55707a",
            }}
          >
            {site.description}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
