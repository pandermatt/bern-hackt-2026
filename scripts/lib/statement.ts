/**
 * Everything that turns a raw statement line into a row of `transactions`:
 * the merchant table, the category rules, the natural key, and the money
 * conversion. Imported by `scripts/seed.ts` and by `tests/seed-rules.test.ts`,
 * which asserts the table still covers every merchant in the shipped exports.
 */

export const CATEGORIES = [
  "Opening balance",
  "Housing",
  "Health & Insurance",
  "Utilities & Telecom",
  "Food & Drink",
  "Transport",
  "Travel",
  "Clothing",
  "Electronics",
  "Subscriptions",
  "Gaming",
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
 * The demo account's opening balance: CHF 20'000, booked the day before the
 * first statement line by both importers (`scripts/seed.ts` and
 * `lib/demo-loader.ts`), so the effective balance — the running sum of
 * monthly nets — starts at the figure instead of at zero.
 *
 * Kind `income`, because the balance excludes transfers (only one side of a
 * transfer between own accounts is recorded). Dated into the month *before*
 * the statements, so no statement month's net carries a 10'000 spike — the
 * carried-in money gets a month of its own, which is also what the ledger
 * shows. It does mean the whole-range "Net" total includes it: with an
 * opening balance, net-of-everything *is* the account's closing balance.
 */
export const OPENING_BALANCE_MINOR = 2_000_000;
export const OPENING_BALANCE_LABEL = "Opening balance";

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The row both importers prepend. Not a statement line, so it bypasses
 * `classify` — the income-means-Refund rule must not catch it. */
export function openingBalanceRow(userId: number, firstBookedOn: string) {
  return {
    userId,
    externalId: "opening-balance",
    bookedOn: dayBefore(firstBookedOn),
    kind: "income" as const,
    amountMinor: OPENING_BALANCE_MINOR,
    currency: "CHF",
    originalAmountMinor: OPENING_BALANCE_MINOR,
    account: "Privatkonto",
    merchant: OPENING_BALANCE_LABEL,
    category: "Opening balance" as Category,
    description: "Balance carried into the first statement",
    createdAt: new Date(),
  };
}

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

  // ZKB Privatkonto export (2026)
  Hostpoint: { name: "Hostpoint", category: "Subscriptions" },
  Polizeiinspektorat_Bern: {
    name: "Polizeiinspektorat Bern",
    category: "Taxes & Fees",
  },
  Garage_Johann_Frei: { name: "Garage Johann Frei", category: "Transport" },
  // The Sihlcity Food and Non-Food tills are different shops, not spellings
  // of one — groceries and a department store should not share a ranking row.
  Coop_Sihlcity_Food: { name: "Coop", category: "Food & Drink" },
  Coop_Sihlcity_NF: { name: "Coop City", category: "Home & Office" },
  LimmatSpot: { name: "LimmatSpot", category: "Food & Drink" },
  Strassenverkehrsaemter: {
    name: "Strassenverkehrsämter (asa)",
    category: "Taxes & Fees",
  },
  Pathe: { name: "Pathé", category: "Sports & Leisure" },
  ZKB: { name: "ZKB", category: "Taxes & Fees" },
  Apfelkiste: { name: "Apfelkiste", category: "Electronics" },
  Migros: { name: "Migros", category: "Food & Drink" },
  Wingo: { name: "Wingo", category: "Utilities & Telecom" },
  Brack: { name: "Brack", category: "Electronics" },
  SBB_EasyRide: { name: "SBB", category: "Transport" },
  Fehr_Braunwalder: { name: "Fehr Braunwalder", category: "Home & Office" },
  FedEx: { name: "FedEx", category: "Home & Office" },
  Zuerichsee_Schifffahrt: {
    name: "Zürichsee-Schifffahrt",
    category: "Sports & Leisure",
  },
  Cinerent: { name: "Cinerent Open-Air-Kino", category: "Sports & Leisure" },
  Sportamt_Zuerich: {
    name: "Stadt Zürich Sportamt",
    category: "Sports & Leisure",
  },
  // Person-to-person TWINT payments. "Other" here is a deliberate
  // classification, not a mapping gap — the counterparty is a private
  // individual, so no spending category is honest. The seed's unmapped
  // warning and the merchant-table test both treat an explicit entry as
  // covered.
  TWINT_P2P: { name: "TWINT", category: "Other" },
  Mountain_Vision: {
    name: "Mountain Vision (Laax)",
    category: "Sports & Leisure",
  },

  // Revolut export (2026). Unifications worth knowing: digitec.ch and both
  // Ikea spellings fold onto the existing canonical names, "Fp Zh Sihlcity"
  // is the Fitnesspark in Sihlcity, "Allianz Cinema" is Cinerent's open-air
  // brand, and "Inside Laax Unlimited" is Mountain Vision's app. The "Other"
  // entries at the end are deliberate classifications, not gaps — cash, a
  // barber, crypto: no spending category would be honest.
  // Plain "Coop" and "Coop Pronto" both land here; the Sihlcity Food till
  // above resolves to the same canonical name through its own slug.
  Coop: { name: "Coop", category: "Food & Drink" },
  Obrador_365: { name: "365 Obrador", category: "Food & Drink" },
  Swiss: { name: "SWISS", category: "Travel" },
  Steam: { name: "Steam", category: "Gaming" },
  Nintendo: { name: "Nintendo", category: "Gaming" },
  PlayStation: { name: "PlayStation", category: "Gaming" },
  Pokemon: { name: "Pokémon", category: "Gaming" },
  Xsolla: { name: "Xsolla", category: "Gaming" },
  Humble_Bundle: { name: "Humble Bundle", category: "Gaming" },
  Google_Play: { name: "Google Play", category: "Gaming" },
  Google_One: { name: "Google One", category: "Subscriptions" },
  WeatherPro: { name: "WeatherPro", category: "Subscriptions" },
  Disney_Plus: { name: "Disney+", category: "Subscriptions" },
  Patreon: { name: "Patreon", category: "Subscriptions" },
  Claude: { name: "Claude", category: "Subscriptions" },
  Kickstarter: { name: "Kickstarter", category: "Marketplace" },
  Volg: { name: "Volg", category: "Food & Drink" },
  Lidl: { name: "Lidl", category: "Food & Drink" },
  Aligro: { name: "Aligro", category: "Food & Drink" },
  SPAR: { name: "SPAR", category: "Food & Drink" },
  Marche: { name: "Marché", category: "Food & Drink" },
  Seven_Eleven: { name: "7-Eleven", category: "Food & Drink" },
  ES_Fornet: { name: "ES Fornet", category: "Food & Drink" },
  Vendo: { name: "Vendo", category: "Food & Drink" },
  McDonalds: { name: "McDonald's", category: "Food & Drink" },
  Subway: { name: "Subway", category: "Food & Drink" },
  Five_Guys: { name: "Five Guys", category: "Food & Drink" },
  Nordsee: { name: "Nordsee", category: "Food & Drink" },
  Starbucks: { name: "Starbucks Coffee", category: "Food & Drink" },
  Brezelkoenig: { name: "Brezelkönig", category: "Food & Drink" },
  Laederach: { name: "Läderach", category: "Food & Drink" },
  Manner: { name: "Manner", category: "Food & Drink" },
  Just_Eat: { name: "Just Eat", category: "Food & Drink" },
  Dieci: { name: "dieci", category: "Food & Drink" },
  Rice_Up: { name: "Rice Up!", category: "Food & Drink" },
  Luigia: { name: "Luigia", category: "Food & Drink" },
  Westhive: { name: "Westhive", category: "Food & Drink" },
  Confiserie_Bachmann: { name: "Confiserie Bachmann", category: "Food & Drink" },
  Baeckerei_Lehmann: { name: "Bäckerei Lehmann", category: "Food & Drink" },
  Baeckerei_Oefferl: { name: "Bäckerei Öfferl", category: "Food & Drink" },
  Babus: { name: "Babu's Bakery & Coffeehouse", category: "Food & Drink" },
  Zuri_Restaurant: { name: "Zuri Restaurant", category: "Food & Drink" },
  Indiagate: { name: "Indiagate Restaurant", category: "Food & Drink" },
  Bouddha_Stupa: { name: "Bouddha Stupa Restaurant", category: "Food & Drink" },
  Trisara: { name: "Trisara Restaurant", category: "Food & Drink" },
  Med_Five: { name: "Med Five Restaurant", category: "Food & Drink" },
  Here_Coffee: { name: "Here Coffee and Eatery", category: "Food & Drink" },
  Bento_Sushi: { name: "Bento Sushi", category: "Food & Drink" },
  Hooligans: { name: "Hooligan's Grog & Gruel", category: "Food & Drink" },
  Cosme_Acajor: { name: "Cosme Acajor Baguettes Magique", category: "Food & Drink" },
  Toadstool_Cafe: { name: "Toadstool Cafe", category: "Food & Drink" },
  Luckys_Thai: { name: "Lucky's Thai Food", category: "Food & Drink" },
  Relais_Entrecote: { name: "Le Relais de l'Entrecôte", category: "Food & Drink" },
  Tacos_Plaza: { name: "Tacos Plaza", category: "Food & Drink" },
  Hungry_Pita: { name: "Hungry Pita", category: "Food & Drink" },
  Deliz_Asia: { name: "Deliz Asia", category: "Food & Drink" },
  Topden_Bowls: { name: "Topden Bowls", category: "Food & Drink" },
  Currybag: { name: "Currybag", category: "Food & Drink" },
  Roots: { name: "Roots", category: "Food & Drink" },
  Papa_Burrito: { name: "Papa Burrito", category: "Food & Drink" },
  Machida_Shoten: { name: "Machida Shoten", category: "Food & Drink" },
  Sternen_Grill: { name: "Sternen Grill", category: "Food & Drink" },
  Ayverdis: { name: "Ayverdi's", category: "Food & Drink" },
  Zart: { name: "Zart", category: "Food & Drink" },
  Spoon_Thai: { name: "Spoon Thai Kitchen", category: "Food & Drink" },
  Thai_Wok_Kitchen: { name: "Thai Wok Kitchen", category: "Food & Drink" },
  Thai_Style: { name: "Thai Style Restaurant", category: "Food & Drink" },
  Tortugaa: { name: "Tortugaa", category: "Food & Drink" },
  Frau_Gerolds_Garten: { name: "Frau Gerolds Garten", category: "Food & Drink" },
  Mr_Tenzin: { name: "Mr. Tenzin", category: "Food & Drink" },
  Phills_BBQ: { name: "Phill's BBQ", category: "Food & Drink" },
  Wesleys_Kitchen: { name: "Wesley's Kitchen", category: "Food & Drink" },
  Grande_Gusto: { name: "Grande Gusto", category: "Food & Drink" },
  Old_Aleppo: { name: "Old Aleppo", category: "Food & Drink" },
  Imbiss_Sargon: { name: "Imbiss Sargon", category: "Food & Drink" },
  Sodano: { name: "Sodano", category: "Food & Drink" },
  Mundo_Del_Gusto: { name: "Mundo Del Gusto", category: "Food & Drink" },
  Yoordi: { name: "Yoordi", category: "Food & Drink" },
  Rhystorante: { name: "Rhystorante", category: "Food & Drink" },
  Ustria_Aurora: { name: "Ustria Aurora", category: "Food & Drink" },
  Mazlaria_Venzin: { name: "Mazlaria Venzin", category: "Food & Drink" },
  Buero_Meier: { name: "Büro Meier", category: "Food & Drink" },
  Spheres: { name: "Sphères", category: "Food & Drink" },
  Bar_Lobo: { name: "Bar Lobo", category: "Food & Drink" },
  Joia: { name: "Joia", category: "Food & Drink" },
  El_Turpial: { name: "El Turpial", category: "Food & Drink" },
  Rec_Comtal: { name: "Rec Comtal 21", category: "Food & Drink" },
  Lk_Langos: { name: "LK Langos", category: "Food & Drink" },
  Bio_Cafe_Bluetezeit: { name: "Bio Cafe Blütezeit", category: "Food & Drink" },
  Akakiko: { name: "Akakiko", category: "Food & Drink" },
  Schlawiener: { name: "Schlawiener Wirtshaus", category: "Food & Drink" },
  Terrassencafe_Hundertwasser: { name: "Terrassencafé im Hundertwasserhaus", category: "Food & Drink" },
  Motto_am_Fluss: { name: "Motto am Fluss", category: "Food & Drink" },
  Figlmueller: { name: "Figlmüller", category: "Food & Drink" },
  Do_and_Co: { name: "DO & CO", category: "Food & Drink" },
  Haas_und_Haas: { name: "Teehaus Haas & Haas", category: "Food & Drink" },
  Cafe_Bel_Etage: { name: "Café Bel Étage", category: "Food & Drink" },
  Augenweide: { name: "Augenweide", category: "Food & Drink" },
  Grab: { name: "Grab", category: "Transport" },
  Lyft: { name: "Lyft", category: "Transport" },
  Uber: { name: "Uber", category: "Transport" },
  Taxibetrieb_Akkus: { name: "Taxibetrieb Akkus", category: "Transport" },
  Pgo: { name: "Pgo", category: "Transport" },
  Lomprayah: { name: "Lomprayah High Speed", category: "Transport" },
  Monbus: { name: "Monbus", category: "Transport" },
  Aerobus_Barcelona: { name: "Aerobús Barcelona", category: "Transport" },
  OEBB: { name: "ÖBB", category: "Transport" },
  Parkhaus_Brunaupark: { name: "Parkhaus Brunaupark", category: "Transport" },
  Shell: { name: "Shell", category: "Transport" },
  BP: { name: "BP", category: "Transport" },
  Eni: { name: "Eni", category: "Transport" },
  Bangkok_Airways: { name: "Bangkok Airways", category: "Travel" },
  DoubleTree: { name: "DoubleTree by Hilton", category: "Travel" },
  Holiday_Inn: { name: "Holiday Inn", category: "Travel" },
  Cinnamon_Hotels: { name: "Cinnamon Hotels", category: "Travel" },
  Miiro_Borneta: { name: "Miiro Borneta", category: "Travel" },
  Wilde_Aparthotels: { name: "Wilde Aparthotels", category: "Travel" },
  Universal_Orlando: { name: "Universal Orlando", category: "Travel" },
  Walt_Disney_World: { name: "Walt Disney World", category: "Travel" },
  Vienna_Pass: { name: "Vienna Pass", category: "Travel" },
  Schloss_Schoenbrunn: { name: "Schloss Schönbrunn", category: "Travel" },
  Tiergarten_Schoenbrunn: { name: "Tiergarten Schönbrunn", category: "Travel" },
  Albertina: { name: "Albertina", category: "Travel" },
  US_CBP: { name: "U.S. Customs and Border Protection", category: "Travel" },
  Airalo: { name: "Airalo", category: "Travel" },
  Aelia_Duty_Free: { name: "Aelia Duty Free", category: "Travel" },
  Heinemann: { name: "Heinemann Duty-free", category: "Travel" },
  Barcelona_Airport: { name: "Barcelona-El Prat Airport", category: "Travel" },
  YHHIT: { name: "Y.H.H.I.T. Solution", category: "Travel" },
  Medbase_Apotheken: { name: "Medbase Apotheken", category: "Health & Insurance" },
  Coop_Vitality: { name: "Coop Vitality", category: "Health & Insurance" },
  Stadtspital_Triemli: { name: "Stadtspital Zürich Triemli", category: "Health & Insurance" },
  Apotheke_Roemischer_Kaiser: { name: "Apotheke zum römischen Kaiser", category: "Health & Insurance" },
  Bambu_Lab: { name: "Bambu Lab", category: "Electronics" },
  Seeed_Studio: { name: "Seeed Studio", category: "Electronics" },
  Ubiquiti: { name: "Ubiquiti", category: "Electronics" },
  IKEA: { name: "IKEA", category: "Home & Office" },
  Jumbo: { name: "JUMBO", category: "Home & Office" },
  Soestrene_Grene: { name: "Søstrene Grene", category: "Home & Office" },
  Air_Up: { name: "air up", category: "Home & Office" },
  UPS: { name: "UPS", category: "Home & Office" },
  Vaadin: { name: "Vaadin", category: "Home & Office" },
  Uniqlo: { name: "UNIQLO", category: "Clothing" },
  Peek_Cloppenburg: { name: "Peek & Cloppenburg", category: "Clothing" },
  El_Corte_Ingles: { name: "El Corte Inglés", category: "Clothing" },
  Buchhaus: { name: "Buchhaus.ch", category: "Books & Media" },
  Museum_Rietberg: { name: "Museum Rietberg", category: "Sports & Leisure" },
  Arena_Cinemas: { name: "Arena Cinemas", category: "Sports & Leisure" },
  Mehrspur: { name: "Mehrspur", category: "Sports & Leisure" },
  Fitnesspark: { name: "Fitnesspark", category: "Sports & Leisure" },
  Amsler_Spielwaren: { name: "Amsler Spielwaren", category: "Sports & Leisure" },
  Smyths_Toys: { name: "Smyths Toys", category: "Sports & Leisure" },
  M_Way: { name: "m-way", category: "Sports & Leisure" },
  Two_B_Wild: { name: "2 B Wild", category: "Sports & Leisure" },
  Revolut: { name: "Revolut", category: "Taxes & Fees" },
  Cash_Withdrawal: { name: "Cash withdrawal", category: "Other" },
  Barber_Parado: { name: "The Barber Parado", category: "Other" },
  Wassermann: { name: "Wassermann & Company", category: "Other" },
  Bormuth: { name: "Bormuth", category: "Other" },
  CRO: { name: "CRO", category: "Other" },
  MoonPay: { name: "MoonPay", category: "Other" },
  UBox: { name: "UBox", category: "Other" },
  VIA_Outlets: { name: "VIA Outlets", category: "Other" },
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
 * from counting twice. Verified against the shipped files: 941 rows in, 929
 * distinct keys out, and no duplicates *within* any single file — the Revolut
 * converter appends " (2)" to the second of two same-day, same-amount rows at
 * one merchant precisely so this key stays distinct.
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
