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
     * installable; the maskable copy is the square-cornered variant, so
     * Android can apply its own adaptive-icon shape without clipping the
     * signet. All three are rasterized from public/icon.svg — see the README.
     *
     * Every path here is a root path, and has to be: a manifest is fetched
     * without a locale and resolves its icons against `scope`. `/icon.svg`
     * used to point at `app/[locale]/icon.svg`, which the file convention
     * serves at `/de/icon.svg` — so this entry was a silent 404.
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
