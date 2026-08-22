import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

/** Served at /manifest.webmanifest — kept in the proxy's public allowlist. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    /*
     * The app's stable identity. Without it the browser derives one from
     * `start_url`, so changing where the app launches would orphan every
     * existing install and offer itself as a second, unrelated app.
     */
    id: "/",
    /*
     * Deliberately unprefixed, even though `localePrefix` is "always" and "/"
     * is therefore never a rendered page. The launch navigation carries the
     * NEXT_LOCALE cookie, so the proxy sends each person to their own locale —
     * a hardcoded "/de" would instead launch every English install in German.
     * "/" also redirects a signed-in visitor on to /home once `getCurrentUser`
     * has confirmed the session, which is the right landing for an installed app.
     */
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2f2f2",
    theme_color: "#FFCC00",
    /*
     * Chrome wants a 192 and a 512 PNG before it treats the app as
     * installable; the maskable copy insets the mark into Android's safe zone,
     * so its adaptive shape crops the white ground rather than the dragon.
     * They come from `res/logos` — see the README.
     *
     * **No SVG entry.** There used to be one, rasterized into these PNGs, but
     * the dragon artwork is raster-only: there is no vector source to serve.
     * Add one back the day someone draws the mark as paths.
     *
     * Every path here is a root path, and has to be: a manifest is fetched
     * without a locale and resolves its icons against `scope`. An entry
     * pointing at a file under `app/[locale]/` is served at `/de/…` and is a
     * silent 404 here.
     */
    icons: [
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
