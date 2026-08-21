import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

/** Served at /manifest.webmanifest — kept in the proxy's public allowlist. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f8f9",
    theme_color: "#FFCC00",
    /*
     * Chrome wants a 192 and a 512 PNG before it treats the app as
     * installable; the maskable copy is the square-cornered variant, so
     * Android can apply its own adaptive-icon shape without clipping the
     * signet. All three are rasterized from app/icon.svg — see the README.
     */
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
      {
        src: "/icon-maskable-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };
}
