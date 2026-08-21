import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Suspense } from "react";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { FlashToaster } from "@/components/flash-toaster";
import { ServiceWorkerRegistrar } from "@/components/sw-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";
import { site } from "@/lib/site";
import "./globals.css";

const googleSansFlex = localFont({
  src: [
    {
      path: "../public/fonts/google-sans-flex-latin-wght-normal.woff2",
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

const TITLE = `${site.name} — Personal Finance Insights`;

export const metadata: Metadata = {
  // Without metadataBase the OG tags emit relative URLs, which every crawler
  // ignores. `app/opengraph-image.tsx` fills in the image itself.
  metadataBase: new URL(site.url),
  title: { default: TITLE, template: `%s — ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    title: TITLE,
    description: site.description,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: site.description },
};

/**
 * The header and footer live here rather than in each page, so a new route
 * inherits the chrome for free. Resolving the user here is what makes every
 * route dynamic — see the note in the README.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      className={`${nunito.variable} ${plexMono.variable} h-full antialiased`}
      // next-themes' pre-paint script sets `class="dark"` on this element
      // before React hydrates, so the class it finds never matches the one the
      // server rendered. Without this, that mismatch is a console error on
      // every load.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-bg font-sans">
        <ThemeProvider>
          <AppHeader user={user} />
          {children}
          <AppFooter />
          <Toaster position="bottom-right" />
          {/* useSearchParams needs a boundary it can suspend against. */}
          <Suspense fallback={null}>
            <FlashToaster />
          </Suspense>
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      className={`${googleSansFlex.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white font-sans text-text antialiased">
        <AppHeader user={user} />
        {children}
        <AppFooter />
        <Toaster position="bottom-right" />
        {/* useSearchParams needs a boundary it can suspend against. */}
        <Suspense fallback={null}>
          <FlashToaster />
        </Suspense>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

