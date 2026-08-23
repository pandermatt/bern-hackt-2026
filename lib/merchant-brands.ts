/**
 * Canonical merchant name → the brand's primary domain.
 *
 * Keyed by the *name* the database stores, not by the importer's slug. Three
 * reasons, all load-bearing:
 *
 *  1. `MERCHANTS` in `scripts/lib/statement.ts` is keyed by slug and the slug is
 *     discarded at import — `scripts/seed.ts` and `lib/demo-loader.ts` both
 *     write `rule.name`, and there is no slug column on `transactions`. A
 *     slug-keyed domain would have to be inverted at read time, and the
 *     inversion would have to prove that `OrellFuessli`/`Orell_Füssli`,
 *     `Digitec_Galaxus`/`Galaxus_AG` and both SWISS spellings agree.
 *  2. It would cover only one of three row sources. `lib/synthetic-generator.ts`
 *     has its own merchant table and never calls `classify()`.
 *  3. `classify()`'s keyword fallback mints canonical names that were never in
 *     the table at all.
 *
 * A name-keyed map covers all three sources without editing any of them, and
 * retroactively covers rows already in the database.
 *
 * `null` is a decision, not a gap: an abstract line with no merchant behind it
 * (Rent, Krankenkasse), a local business with no findable mark, or a domain
 * neither icon service has. Every `null` below was checked against both
 * upstreams — see the note on each. `tests/merchant-brands.test.ts` asserts
 * every canonical name the importer can emit has an *entry* here, so "we looked
 * and there isn't one" stays distinguishable from "someone added a merchant and
 * forgot".
 */
export const MERCHANT_BRANDS: Record<string, string | null> = {
  // ── Retail and marketplaces ───────────────────────────────────────────────
  "Abercrombie & Fitch": "abercrombie.com",
  Amazon: "amazon.com",
  "Apple Online Store": "apple.com",
  iTunes: "apple.com", // Two names, one mark. Deliberate.
  "Cairo.de": "cairo.de",
  "Companys Retail": "companys.com",
  Globus: "globus.ch",
  "H&M": "hm.com",
  IKEA: "ikea.com",
  Mango: "mango.com",
  Manor: "manor.ch",
  "Manor AG": "manor.ch",
  MediaMarkt: "mediamarkt.ch",
  Nike: "nike.com",
  "Ochsner Sport": "ochsner-sport.ch",
  PayPal: "paypal.com",
  "Pet Center": "petcenter.ch",
  "s.Oliver": "soliver.com",
  Superdry: "superdry.com",
  "Tally Weijl": "tally-weijl.com",
  "Tommy Hilfiger": "tommy.com",
  Unitedprint: "unitedprint.com",
  "WH Smith Travel": "whsmith.co.uk",
  Zalando: "zalando.ch",
  "Zalando Retoure": "zalando.ch",
  "Bucherer Luxury Watches": "bucherer.com",

  // ── Groceries, food and drink ─────────────────────────────────────────────
  "Coop Tankstelle": "coop.ch",
  "Coop Supermarkt": "coop.ch",
  Coop: "coop.ch",
  "Coop City": "coop.ch",
  Migros: "migros.ch",
  "Starbucks Coffee": "starbucks.com",

  // ── Electronics ───────────────────────────────────────────────────────────
  "Digitec Galaxus": "galaxus.ch",
  Microsoft: "microsoft.com",
  "Mouser Electronics": "mouser.ch",
  Apfelkiste: "apfelkiste.ch",
  Brack: "brack.ch",

  // ── Subscriptions and media ───────────────────────────────────────────────
  Netflix: "netflix.com",
  Spotify: "spotify.com",
  Teleboy: "teleboy.ch",
  "Orell Füssli": "orellfuessli.ch",

  // ── Transport and travel ──────────────────────────────────────────────────
  SBB: "sbb.ch",
  "Libero-Tarifverbund": "mylibero.ch",
  SWISS: "swiss.com",
  Lufthansa: "lufthansa.com",
  "Uber B.V.": "uber.com",
  AirBnB: "airbnb.com",
  "Mondrian London": "mondrianshoreditch.com",
  "Mandarin Oriental, Las Vegas": "mandarinoriental.com",
  Yellowstone: "nps.gov",
  "Omni Development": "omnigroup.com",
  "VisitBritain Shop": "visitbritainshop.com",

  // ── Utilities, public sector, leisure ─────────────────────────────────────
  BKW: "bkw.ch",
  "Die Post": "post.ch",
  FedEx: "fedex.com",
  Hostpoint: "hostpoint.ch",
  Wingo: "wingo.ch",
  ZKB: "zkb.ch",
  TWINT: "twint.ch",
  "Pathé": "pathe.ch",
  "Zürichsee-Schifffahrt": "zsg.ch",
  "Stadt Zürich Sportamt": "stadt-zuerich.ch",
  "Polizeiinspektorat Bern": "bern.ch",
  "Strassenverkehrsämter (asa)": "asa.ch",
  "Mountain Vision (Laax)": "laax.com",
  Steuerverwaltung: "be.ch",
  "Zoll (BAZG)": "bazg.admin.ch",
  "Gurten Festival": "gurtenfestival.ch",
  "Mika Timing": "mikatiming.de",
  Fitnesspark: "fitnesspark.ch",
  "Swiss Casinos Interlaken": "swisscasinos.ch",
  "Swisslos Interkantonale Lotterie": "swisslos.ch",

  // ── No mark: neither upstream has one (both verified 404) ─────────────────
  Veloshop: null,
  "Heiniger AG": null,
  "Hügi Optik": null,

  // ── No mark: abstract lines with no merchant behind them ──────────────────
  "Opening balance": null,
  Rent: null,
  Krankenkasse: null,
  "Mobile Provider": null,
  "Employer AG": null,
  "Credit card payment": null,
  Taxi: null,
  "Taxi Services": null,
  "Unknown Digital Merchant UK": null,

  // ── No mark: local businesses, nothing findable ───────────────────────────
  "Cinerent Open-Air-Kino": null,
  "Fehr Braunwalder": null,
  "Garage Johann Frei": null,
  LimmatSpot: null,
  "Kantine AG": null,
  "Ristorante Luce": null,
  "Ristorante & Pizzeria Da Rasso": null,
  "Molino Zürich": null,
  "Pizzeria & Grill, Samedan": null,
  "Pizzeria & Grill": null,
  "La Salle, Terminal 2": null,
  "Local Bakery & Café": null,
  "Hotel Waldhof": null,
  "Carlton Zürich": null,

  // ── Revolut statement merchants (2026) ────────────────────────────────────
  // Chains and platforms carry their primary domain; the nulls are one-off
  // restaurants, kiosks and local businesses with no findable mark (not
  // verified against the icon upstreams the way the entries above were).
  "365 Obrador": null,
  Steam: "steampowered.com",
  Nintendo: "nintendo.com",
  PlayStation: "playstation.com",
  "Pokémon": "pokemon.com",
  Xsolla: "xsolla.com",
  "Humble Bundle": "humblebundle.com",
  "Google Play": "play.google.com",
  "Google One": "google.com",
  WeatherPro: null,
  "Disney+": "disneyplus.com",
  Patreon: "patreon.com",
  Claude: "claude.ai",
  Kickstarter: "kickstarter.com",
  Volg: "volg.ch",
  Lidl: "lidl.ch",
  Aligro: "aligro.ch",
  SPAR: null,
  "Marché": null,
  "7-Eleven": "7-eleven.com",
  "ES Fornet": null,
  Vendo: null,
  "McDonald's": "mcdonalds.com",
  Subway: "subway.com",
  "Five Guys": "fiveguys.com",
  Nordsee: "nordsee.com",
  "Brezelkönig": "brezelkoenig.ch",
  "Läderach": "laederach.com",
  Manner: "manner.com",
  "Just Eat": "just-eat.ch",
  dieci: "dieci.ch",
  "Rice Up!": "riceup.ch",
  Luigia: "luigia.ch",
  Westhive: "westhive.com",
  "Confiserie Bachmann": null,
  "Bäckerei Lehmann": null,
  "Bäckerei Öfferl": null,
  "Babu's Bakery & Coffeehouse": null,
  "Zuri Restaurant": null,
  "Indiagate Restaurant": null,
  "Bouddha Stupa Restaurant": null,
  "Trisara Restaurant": null,
  "Med Five Restaurant": null,
  "Here Coffee and Eatery": null,
  "Bento Sushi": null,
  "Hooligan's Grog & Gruel": null,
  "Cosme Acajor Baguettes Magique": null,
  "Toadstool Cafe": null,
  "Lucky's Thai Food": null,
  "Le Relais de l'Entrecôte": null,
  "Tacos Plaza": null,
  "Hungry Pita": null,
  "Deliz Asia": null,
  "Topden Bowls": null,
  Currybag: null,
  Roots: null,
  "Papa Burrito": null,
  "Machida Shoten": null,
  "Sternen Grill": null,
  "Ayverdi's": null,
  Zart: null,
  "Spoon Thai Kitchen": null,
  "Thai Wok Kitchen": null,
  "Thai Style Restaurant": null,
  Tortugaa: null,
  "Frau Gerolds Garten": null,
  "Mr. Tenzin": null,
  "Phill's BBQ": null,
  "Wesley's Kitchen": null,
  "Grande Gusto": null,
  "Old Aleppo": null,
  "Imbiss Sargon": null,
  Sodano: null,
  "Mundo Del Gusto": null,
  Yoordi: null,
  Rhystorante: null,
  "Ustria Aurora": null,
  "Mazlaria Venzin": null,
  "Büro Meier": null,
  "Sphères": null,
  "Bar Lobo": null,
  Joia: null,
  "El Turpial": null,
  "Rec Comtal 21": null,
  "LK Langos": null,
  "Bio Cafe Blütezeit": null,
  Akakiko: null,
  "Schlawiener Wirtshaus": null,
  "Terrassencafé im Hundertwasserhaus": null,
  "Motto am Fluss": null,
  "Figlmüller": null,
  "DO & CO": null,
  "Teehaus Haas & Haas": null,
  "Café Bel Étage": null,
  Augenweide: null,
  Grab: "grab.com",
  Lyft: "lyft.com",
  Uber: "uber.com",
  "Taxibetrieb Akkus": null,
  Pgo: null,
  "Lomprayah High Speed": null,
  Monbus: "monbus.es",
  "Aerobús Barcelona": null,
  "ÖBB": "oebb.at",
  "Parkhaus Brunaupark": null,
  Shell: "shell.com",
  BP: "bp.com",
  Eni: "eni.com",
  "Bangkok Airways": "bangkokair.com",
  "DoubleTree by Hilton": "hilton.com",
  "Holiday Inn": "ihg.com",
  "Cinnamon Hotels": "cinnamonhotels.com",
  "Miiro Borneta": null,
  "Wilde Aparthotels": null,
  "Universal Orlando": "universalorlando.com",
  "Walt Disney World": "disneyworld.disney.go.com",
  "Vienna Pass": null,
  "Schloss Schönbrunn": "schoenbrunn.at",
  "Tiergarten Schönbrunn": "zoovienna.at",
  Albertina: "albertina.at",
  "U.S. Customs and Border Protection": "cbp.gov",
  Airalo: "airalo.com",
  "Aelia Duty Free": null,
  "Heinemann Duty-free": null,
  "Barcelona-El Prat Airport": null,
  "Y.H.H.I.T. Solution": null,
  "Medbase Apotheken": "medbase.ch",
  "Coop Vitality": "coopvitality.ch",
  "Stadtspital Zürich Triemli": null,
  "Apotheke zum römischen Kaiser": null,
  "Bambu Lab": "bambulab.com",
  "Seeed Studio": "seeedstudio.com",
  Ubiquiti: "ui.com",
  JUMBO: "jumbo.ch",
  "Søstrene Grene": "sostrenegrene.com",
  "air up": "air-up.com",
  UPS: "ups.com",
  Vaadin: "vaadin.com",
  UNIQLO: "uniqlo.com",
  "Peek & Cloppenburg": "peek-cloppenburg.de",
  "El Corte Inglés": "elcorteingles.es",
  "Buchhaus.ch": "buchhaus.ch",
  "Museum Rietberg": "rietberg.ch",
  "Arena Cinemas": "arena.ch",
  Mehrspur: null,
  "Amsler Spielwaren": null,
  "Smyths Toys": "smythstoys.com",
  "m-way": "m-way.ch",
  "2 B Wild": null,
  Revolut: "revolut.com",
  "Cash withdrawal": null,
  "The Barber Parado": null,
  "Wassermann & Company": null,
  Bormuth: null,
  CRO: null,
  MoonPay: "moonpay.com",
  UBox: null,
  "VIA Outlets": null,

  // ── Uploaded statements ───────────────────────────────────────────────────
  // Merchants that reach the ledger through `lib/csv-upload.ts` rather than the
  // shipped exports, so they have no `MERCHANTS` entry to sit beside — the name
  // the free-text classifier settled on is the key, as it is everywhere here.
  //
  // A canteen borrows the institution that runs it: the mensa has no mark of
  // its own, and the university's is the one on the building.
  "Mensa Cafeteria UZH": "uzh.ch",
  Sunrise: "sunrise.ch",
};

/**
 * The lookup key for the forgiving fallback: case, accents, punctuation and
 * legal suffixes folded away.
 *
 * Deliberately *not* `normalizeMerchant` from `lib/anomaly-engine.ts`. That one
 * also strips `coop|supermarkt|online|store`, which is right when the question
 * is "are these the same merchant?" and wrong when it is "which brand is this?"
 * — it would collapse Coop Supermarkt and Coop Tankstelle onto one entry.
 */
function brandKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ag|sa|gmbh|inc|corp|ltd|llc|bv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_KEY = new Map<string, string | null>(
  Object.entries(MERCHANT_BRANDS).map(([name, domain]) => [
    brandKey(name),
    domain,
  ]),
);

/**
 * Filename- and URL-safe identity for a merchant. This is both the cache
 * filename and the route parameter, so it must stay a pure function of the
 * name — the route and the component derive it independently and have to agree.
 */
export function merchantSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "merchant"
  );
}

/** `null` when the merchant has no mark — the caller renders a monogram. */
export function merchantDomain(name: string): string | null {
  if (name in MERCHANT_BRANDS) return MERCHANT_BRANDS[name];
  return BY_KEY.get(brandKey(name)) ?? null;
}

/**
 * Slug → domain, for the route. Built from the same map so a slug the app never
 * renders cannot resolve to a domain — which is what keeps the route from being
 * an open proxy. Entries with no domain are omitted entirely.
 */
const BY_SLUG = new Map<string, string>(
  Object.entries(MERCHANT_BRANDS)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([name, domain]) => [merchantSlug(name), domain]),
);

/** The allowlist check. `null` means "not a merchant we know" — a 404. */
export function domainForSlug(slug: string): string | null {
  return BY_SLUG.get(slug) ?? null;
}
