import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

import { site } from "@/lib/site";

/**
 * What this app is, said on the way in.
 *
 * It is a hackathon build on a public domain wearing a finance UI, so the two
 * facts a visitor needs before they type anything are that it came out of
 * BärnHäckt and that it is a prototype. `AuthCard` renders it above the card,
 * which is what puts it on `/login` and `/register` alike from one line.
 *
 * No `"use client"`: `useTranslations` is next-intl's shared API and resolves
 * in both trees (`components/app-footer.tsx` is the precedent), which is what
 * lets `AuthForm` — a client component — and the server-rendered sign-up
 * notice render the same box.
 */
export function PrototypeNotice() {
  const t = useTranslations("Auth");

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-line bg-surface-muted px-3.5 py-3">
      {/* Decorative — the sentence beside it says the same thing in words. */}
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <p className="text-[12.5px] leading-relaxed text-text-muted">
        {/* One sentence per locale with the link inside it rather than
            fragments spliced around it — German puts the event elsewhere in
            the clause. Same `t.rich` idiom as the budget page's subtitle. */}
        {t.rich("prototypeNotice", {
          bernhackt: (chunks) => (
            <a
              href={site.hackathon.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:text-accent-hover hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
