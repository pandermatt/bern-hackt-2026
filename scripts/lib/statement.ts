/**
 * Everything that turns a raw statement line into a row of `transactions`:
 * the merchant table, the category rules, the natural key, and the money
 * conversion. Imported by `scripts/seed.ts` and by `tests/seed-rules.test.ts`,
 * which asserts the table still covers every merchant in the shipped exports.
 */

export const CATEGORIES = [
  "Housing",
  "Health & Insurance",
  "Utilities & Telecom",
  "Food & Drink",
  "Transport",
  "Travel",
  "Clothing",
  "Electronics",
  "Subscriptions",
  "Books & Media",
  "Sports & Leisure",
  "Taxes & Fees",
  "Marketplace",
  "Home & Office",
  "Pets",
  "Other",
  "Salary",
  "Refund",
  "Transfer",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Rule = { name: string; category: Category };

/**
 * Merchant slug (`target_id` for an expense, `source_id` for income) →
 * canonical display name + category.
 *
 * The canonical name matters as much as the category: the statements spell the
 * same merchant several ways — Orell Fuessli / Orell Füssli, Swiss Intl.
 * Airlines / SWISS International Airlines, SBB / SBB CFF FSS Ticket Shop,
 * Digitec Galaxus / Galaxus AG, Amazon / Amazon.com — and grouping on the raw
 * label splits them across the top-merchants list.
 */
export const MERCHANTS: Record<string, Rule> = {
  // Housing and fixed costs
  Rent: { name: "Rent", category: "Housing" },
  Krankenkasse: { name: "Krankenkasse", category: "Health & Insurance" },
  Hügi_Optik: { name: "Hügi Optik", category: "Health & Insurance" },
  BKW: { name: "BKW", category: "Utilities & Telecom" },
  MobileProvider: { name: "Mobile Provider", category: "Utilities & Telecom" },

  // Food and drink
  KantineAG: { name: "Kantine AG", category: "Food & Drink" },
  Ristorante_Luce: { name: "Ristorante Luce", category: "Food & Drink" },
  Ristorante_Pizzeria_Da_Rasso: {
    name: "Ristorante & Pizzeria Da Rasso",
    category: "Food & Drink",
  },
  Molino_Zürich: { name: "Molino Zürich", category: "Food & Drink" },
  "PIZZERIA_&_GRIL,_Samedan": {
    name: "Pizzeria & Grill, Samedan",
    category: "Food & Drink",
  },
  LA_SALLE_TERMINAL_2_GBR: {
    name: "La Salle, Terminal 2",
    category: "Food & Drink",
  },
  WH_SMITH_TRAVEL_HEATHROW_T_2_GBR: {
    name: "WH Smith Travel",
    category: "Food & Drink",
  },

  // Transport
  SBB: { name: "SBB", category: "Transport" },
  SBB_CFF_FSS_Ticket_Shop: { name: "SBB", category: "Transport" },
  Libero: { name: "Libero-Tarifverbund", category: "Transport" },
  CoopTankstelleTalgutZentrum: {
    name: "Coop Tankstelle",
    category: "Transport",
  },
  Taxi: { name: "Taxi", category: "Transport" },

  // Travel
  "Swiss_Intl._Airlines": { name: "SWISS", category: "Travel" },
  SWISS_International_Airlines: { name: "SWISS", category: "Travel" },
  Lufhansa_Köln: { name: "Lufthansa", category: "Travel" },
  AirBnB: { name: "AirBnB", category: "Travel" },
  MONDRIAN_LONDON_LONDON_GBR: { name: "Mondrian London", category: "Travel" },
  MANDARIN_ORIENTAL_LV_LAS_VEGAS_NV: {
    name: "Mandarin Oriental, Las Vegas",
    category: "Travel",
  },
  Hotel_Waldhof: { name: "Hotel Waldhof", category: "Travel" },
  Carlton_Zürich_Agloft: { name: "Carlton Zürich", category: "Travel" },
  VISITBRITAINSHOP_DE_LONDON_GBR: {
    name: "VisitBritain Shop",
    category: "Travel",
  },
  Yellowstone: { name: "Yellowstone", category: "Travel" },
  OMNI_DEVELOPMENT_INC: { name: "Omni Development", category: "Travel" },

  // Clothing and department stores
  Aebercrombie: { name: "Abercrombie & Fitch", category: "Clothing" },
  "H&M": { name: "H&M", category: "Clothing" },
  Thommy_Hilfiger: { name: "Tommy Hilfiger", category: "Clothing" },
  Zalando: { name: "Zalando", category: "Clothing" },
  "Superdry.com": { name: "Superdry", category: "Clothing" },
  Tally_Weijl: { name: "Tally Weijl", category: "Clothing" },
  Mango: { name: "Mango", category: "Clothing" },
  "s-Oliver.com": { name: "s.Oliver", category: "Clothing" },
  "Nike.com": { name: "Nike", category: "Clothing" },
  COMPANYS_Retail_AG: { name: "Companys Retail", category: "Clothing" },
  Globus: { name: "Globus", category: "Clothing" },
  Manor_AG: { name: "Manor", category: "Clothing" },

  // Electronics
  Digitec_Galaxus: { name: "Digitec Galaxus", category: "Electronics" },
  Galaxus_AG: { name: "Digitec Galaxus", category: "Electronics" },
  Apple_Online_Store: { name: "Apple Online Store", category: "Electronics" },
  Mediamarkt_AG: { name: "MediaMarkt", category: "Electronics" },
  MOUSER_ELECTRONICS: { name: "Mouser Electronics", category: "Electronics" },
  Microsoft: { name: "Microsoft", category: "Electronics" },
  "shop.heinigerag.ch": { name: "Heiniger AG", category: "Electronics" },

  // Subscriptions
  Netflix: { name: "Netflix", category: "Subscriptions" },
  Spotify: { name: "Spotify", category: "Subscriptions" },
  "iTunes.com": { name: "iTunes", category: "Subscriptions" },
  Teleboy: { name: "Teleboy", category: "Subscriptions" },

  // Books and media
  OrellFuessli: { name: "Orell Füssli", category: "Books & Media" },
  Orell_Füssli: { name: "Orell Füssli", category: "Books & Media" },

  // Sports and leisure
  Veloshop: { name: "Veloshop", category: "Sports & Leisure" },
  "www.ochsner-sport.ch": { name: "Ochsner Sport", category: "Sports & Leisure" },
  GurtenFestival: { name: "Gurten Festival", category: "Sports & Leisure" },
  Mika_Timing_GmbH: { name: "Mika Timing", category: "Sports & Leisure" },

  // Public sector
  Steuerverwaltung: { name: "Steuerverwaltung", category: "Taxes & Fees" },
  BAZG: { name: "Zoll (BAZG)", category: "Taxes & Fees" },

  // Marketplaces — the merchant behind the line is not knowable from the export
  Amazon: { name: "Amazon", category: "Marketplace" },
  "Amazon.com": { name: "Amazon", category: "Marketplace" },
  Paypal: { name: "PayPal", category: "Marketplace" },

  // Long tail
  "CAIRO.DE": { name: "Cairo.de", category: "Home & Office" },
  unitedprint: { name: "Unitedprint", category: "Home & Office" },
  "www.post.ch": { name: "Die Post", category: "Home & Office" },
  "petcenter.ch": { name: "Pet Center", category: "Pets" },

  // Income
  EmployerAG: { name: "Employer AG", category: "Salary" },
};

/**
 * Second-tier keyword rules, so a merchant that only appears in a future
 * export lands somewhere sensible instead of "Other". Matched against the
 * lowercased label.
 */
const KEYWORDS: [RegExp, Category][] = [
  [/restaurant|pizzeria|ristorante|kantine|coffee|bar\b/, "Food & Drink"],
  [/airlines|airways|hotel|hostel|airbnb|resort/, "Travel"],
  [/sbb|cff|tarifverbund|tankstelle|taxi|parking/, "Transport"],
  [/versicherung|krankenkasse|apotheke|optik/, "Health & Insurance"],
  [/steuer|zoll|gebühr/, "Taxes & Fees"],
  [/netflix|spotify|itunes|disney|abo/, "Subscriptions"],
];

export function classify(slug: string, label: string): Rule {
  const hit = MERCHANTS[slug];
  if (hit) return hit;

  const lowered = label.toLowerCase();
  for (const [pattern, category] of KEYWORDS) {
    if (pattern.test(lowered)) return { name: label, category };
  }
  return { name: label, category: "Other" };
}

/**
 * The statement line's identity. Deduplicating on this is what stops the 12
 * credit-card payments — which appear byte-identical in both account exports —
 * from counting twice. Verified against the shipped files: 525 rows in, 513
 * distinct keys out, and no duplicates *within* either file.
 */
export function naturalKey(row: Record<string, string>): string {
  return [
    row.transaction_date,
    row.type,
    row.source_id,
    row.target_id,
    row.amount,
    row.name,
  ].join("|");
}

/** `"46.96976052505031"` → `4697`. Rounds once, at the boundary. */
export function toMinor(amount: string): number {
  return Math.round(Number(amount) * 100);
}
