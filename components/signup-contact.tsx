import { useTranslations } from "next-intl";

import { site } from "@/lib/site";

/**
 * How to get a sign-up key.
 *
 * Rendered in the two places where a key is the subject: under the notice on a
 * closed `/register`, and under the key field when `LOGIN_KEY` is configured.
 * One component so the two say the same thing, and one string so the address
 * is written once — it comes from `site.contactEmail` rather than the
 * catalogs.
 *
 * Server-safe for the same reason `PrototypeNotice` is; see the note there.
 */
export function SignupContact() {
  const t = useTranslations("Auth");

  return (
    <p className="text-[13px] text-text-muted">
      {t.rich("signupContact", {
        email: site.contactEmail,
        mail: (chunks) => (
          <a
            href={`mailto:${site.contactEmail}`}
            /* `whitespace-nowrap` so the address never breaks across lines —
               German wrapped it after the hyphen, and half an email address at
               the end of a line reads as a typo. It is 18 characters; it fits
               on its own line at every width the card has. */
            className="font-medium whitespace-nowrap text-accent hover:text-accent-hover hover:underline"
          >
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}
