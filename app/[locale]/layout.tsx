import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { FlashToaster } from "@/components/flash-toaster";
import { LocaleSync } from "@/components/locale-sync";
import { ServiceWorkerRegistrar } from "@/components/sw-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth";
import { site } from "@/lib/site";
import "../globals.css";

const googleSansFlex = localFont({
  src: [
    {
      path: "../../public/fonts/google-sans-flex-latin-wght-normal.woff2",
      weight: "100 1000",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const title = `${site.name} — ${t("siteTitle")}`;
  const description = t("siteDescription");

  return {
    // Without metadataBase the OG tags emit relative URLs, which every crawler
    // ignores. `app/[locale]/opengraph-image.tsx` fills in the image itself —
    // it has to live under the locale segment, see the note in that file.
    metadataBase: new URL(site.url),
    title: { default: title, template: `%s — ${site.name}` },
    description,
    applicationName: site.name,
    /*
     * Declared rather than dropped in as `app/icon.svg`. The file convention
     * emits its `<link>` relative to the segment it sits in, so under
     * `[locale]` these were only ever reachable at `/de/icon.svg` — and a
     * manifest, which is locale-independent, cannot name a path like that.
     * Both files now live in `public/` at root paths; this is what puts them
     * back in the `<head>`. `app/favicon.ico` still rides its own convention.
     */
    icons: {
      /* PNG rather than SVG: the dragon artwork in `res/logos` is raster, so
         there is no vector to serve. `app/favicon.ico` still rides its own
         file convention and carries the same mark. */
      icon: [
        { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
        { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      ],
      apple: "/apple-icon.png",
    },
    /*
     * iOS has no manifest-driven install: `capable` is what makes an added
     * home-screen icon open standalone instead of in a Safari tab, and `title`
     * is the name under the icon. `statusBarStyle` stays "default" — the
     * translucent variant draws the page *under* the status bar, and the
     * sticky header in `components/app-header.tsx` has no inset for that.
     */
    appleWebApp: {
      capable: true,
      title: site.name,
      statusBarStyle: "default",
    },
    openGraph: {
      type: "website",
      // The card's own language, so `og:locale` is not a claim the copy
      // contradicts. `localePrefix` is "always", so "/" is never a real page.
      locale,
      url: `/${locale}`,
      siteName: site.name,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Next emits the `width=device-width, initial-scale=1` viewport meta on its own,
 * so this is here for `themeColor` — the colour a phone paints its status bar
 * and the standalone PWA's chrome with.
 *
 * `app/manifest.ts` also carries one, but a manifest takes a single value and
 * pins Supernova. That is the brand colour, not a surface: as a status bar above
 * a #121212 page it reads as a yellow stripe. These two follow the ground the
 * page actually paints, and the meta tags win over the manifest where both apply.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

// Every locale in `routing` gets a shell at build time; anything else 404s
// below rather than rendering an untranslated page.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// The header and footer live here rather than in each page, so a new route
// inherits the chrome for free. Resolving the user here is what makes every
// route dynamic — see the note in the README.
export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  // `hasLocale` narrows the segment to a known locale, which is what lets the
  // rest of the tree treat it as one instead of casting through `any`.
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const messages = await getMessages();
  const user = await getCurrentUser();

  return (
    <html
      lang={locale}
      className={`${googleSansFlex.variable} ${plexMono.variable} h-full antialiased`}
      // next-themes' pre-paint script sets `class="dark"` on this element
      // before React hydrates, so the class it finds never matches the one the
      // server rendered. Without this, that mismatch is a console error on
      // every load.
      suppressHydrationWarning
    >
      {/* `bg-bg`, not `bg-white`: main set `--bg` to #ffffff, so this renders
          identically in light mode while still following the dark theme. A
          literal here would keep the page white on a dark ground. */}
      <body className="min-h-full flex flex-col bg-bg font-sans text-text antialiased">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <AppHeader user={user} />
            {children}
            <AppFooter user={user} />
            <Toaster position="bottom-right" />
            {/* useSearchParams needs a boundary it can suspend against. */}
            <Suspense fallback={null}>
              <FlashToaster />
            </Suspense>
            <ServiceWorkerRegistrar />
            <LocaleSync locale={locale} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
