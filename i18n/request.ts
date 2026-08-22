import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export { locales, defaultLocale, isAppLocale, type AppLocale } from "./routing";

export default getRequestConfig(async ({ locale, requestLocale }) => {
  // `locale` is set whenever a caller names one — `getTranslations({ locale })`
  // in a `generateMetadata`, and the OG image, which Next resolves through
  // `generateStaticParams` at build time. Awaiting `requestLocale` there reads
  // `headers()`, which throws in that context; preferring the explicit one also
  // keeps those pages statically renderable instead of opting them into
  // dynamic rendering for a locale they already know.
  const requested = locale ?? (await requestLocale);

  // An unknown locale falls back rather than 404s: the segment is already
  // validated by the layout, and a hard `notFound()` here would take out the
  // error and not-found pages themselves, which also render through this config.
  const resolved = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale: resolved,
    messages: (await import(`../messages/${resolved}.json`)).default,
  };
});
