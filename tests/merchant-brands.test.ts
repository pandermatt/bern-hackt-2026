import { describe, expect, it, vi } from "vitest";

import {
  MERCHANT_BRANDS,
  domainForSlug,
  merchantDomain,
  merchantSlug,
} from "@/lib/merchant-brands";
import { ABSTRACT_GLYPHS } from "@/components/merchant-avatar";
import { generateYearlyTransactions } from "@/lib/synthetic-generator";
import { MERCHANTS } from "@/scripts/lib/statement";

/**
 * The transfer line never goes through `classify()` — both importers write this
 * literal (`scripts/seed.ts`, `lib/demo-loader.ts`), so the brand map has to
 * know it or the coverage check below has a hole exactly where the ledger does.
 */
const TRANSFER_NAME = "Credit card payment";

/** Every canonical name the three row sources can put in `transactions.merchant`. */
function everyCanonicalName(): string[] {
  const fromImporter = Object.values(MERCHANTS).map((rule) => rule.name);

  // Generating rows rather than reading the generator's private table: it also
  // catches the names it hardcodes outside that table (Zalando Retoure,
  // Bucherer, Swisslos …), which is where a gap would actually appear.
  const fromGenerator = generateYearlyTransactions(1, {
    seed: 42,
    targetCount: 800,
  }).map((row) => row.merchant);

  return [...new Set([...fromImporter, ...fromGenerator, TRANSFER_NAME])];
}

describe("merchant brand map", () => {
  it("has an entry for every merchant name the app can store", () => {
    const missing = everyCanonicalName()
      .filter((name) => !(name in MERCHANT_BRANDS))
      .sort();

    // A merchant with no logo belongs here as `null`. Absent means somebody
    // added one and forgot — which is the only thing this asserts.
    expect(missing).toEqual([]);
  });

  it("stores bare domains, never URLs", () => {
    const shape = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

    for (const [name, domain] of Object.entries(MERCHANT_BRANDS)) {
      if (domain === null) continue;
      expect(domain, `${name} → ${domain}`).toMatch(shape);
    }
  });

  it("resolves without touching the network", () => {
    // The privacy claim, made executable: nothing on the render path fetches.
    // Only the browser's own request for the <img> reaches the icon route.
    const fetchSpy = vi.fn(() => {
      throw new Error("the resolver must not fetch");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      for (const name of everyCanonicalName()) {
        expect(() => merchantDomain(name)).not.toThrow();
        expect(() => merchantSlug(name)).not.toThrow();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("produces filename-safe slugs that do not collide", () => {
    expect(merchantSlug("Orell Füssli")).toBe("orell-fussli");
    expect(merchantSlug("Zoll (BAZG)")).toBe("zoll-bazg");
    expect(merchantSlug("Pizzeria & Grill, Samedan")).toBe(
      "pizzeria-grill-samedan",
    );

    for (const name of everyCanonicalName()) {
      // Both a path segment and a filename, so nothing that could escape either.
      expect(merchantSlug(name), name).toMatch(/^[a-z0-9-]+$/);
    }

    const slugs = Object.keys(MERCHANT_BRANDS).map(merchantSlug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("folds legal suffixes onto the same brand", () => {
    expect(merchantDomain("Manor AG")).toBe(merchantDomain("Manor"));
    expect(merchantDomain("Netflix")).toBe("netflix.com");
    // Not folded: `Coop Supermarkt` and `Coop Tankstelle` are separate entries
    // that happen to share a domain, which is why the normaliser must not strip
    // those words the way `normalizeMerchant` does.
    expect(merchantDomain("Coop Supermarkt")).toBe("coop.ch");
  });

  it("returns null for merchants that deliberately have no mark", () => {
    for (const name of ["Rent", "Krankenkasse", "Taxi", TRANSFER_NAME]) {
      expect(merchantDomain(name), name).toBeNull();
    }
    expect(merchantDomain("Some Merchant Nobody Mapped")).toBeNull();
  });

  it("only gives a glyph to merchants that have no logo", () => {
    for (const name of Object.keys(ABSTRACT_GLYPHS)) {
      // A name with a domain renders its real mark, so a glyph for it would be
      // dead code — and a typo here would silently never render at all.
      expect(merchantDomain(name), `${name} has a logo`).toBeNull();
      expect(name in MERCHANT_BRANDS, `${name} is not a known merchant`).toBe(
        true,
      );
    }
  });

  it("only resolves slugs that are in the map", () => {
    // The route's whole SSRF guard: it fetches `domainForSlug(slug)` and 404s
    // on null, so anything not listed here is unreachable from the outside.
    expect(domainForSlug("netflix")).toBe("netflix.com");
    expect(domainForSlug("evil-corp")).toBeNull();
    expect(domainForSlug("")).toBeNull();
    // Present in the map, but with no domain — must not resolve either.
    expect(domainForSlug(merchantSlug("Rent"))).toBeNull();
  });
});
