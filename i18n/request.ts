import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export { locales, defaultLocale, isAppLocale, type AppLocale } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // An unknown locale falls back rather than 404s: the segment is already
  // validated by the layout, and a hard `notFound()` here would take out the
  // error and not-found pages themselves, which also render through this config.
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
