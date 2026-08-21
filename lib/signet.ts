/**
 * The PostFinance signet, lifted verbatim from the supplied brand SVG
 * (`PostFinance/PostFinance_Logo_0.svg`). It is drawn in a 17.08 × 18 box, so
 * every consumer scales it with a viewBox rather than editing the path.
 *
 * Kept in one module because it is needed in three places that cannot share a
 * component: `components/logo.tsx` (JSX), `app/opengraph-image.tsx` (a data
 * URI, because Satori renders SVG reliably only through an <img>), and
 * `app/icon.svg` (a static file, which holds its own copy).
 */
export const SIGNET_PATH =
  "M16.8641 6.30447C16.6127 6.2861 16.3602 6.2861 16.1089 6.2861C13.6969 6.2861 11.5741 6.80892 9.85516 7.82518C11.2948 5.91388 12.0182 3.4063 11.9731 0.467724V0H6.50138L6.5087 0.539964C6.54408 2.53697 6.07682 4.03075 5.124 4.94783C3.88326 6.1355 1.87026 6.31549 0.395281 6.24325L0 6.22243V11.6821L0.215941 11.6955C0.467261 11.7139 0.719801 11.7139 0.971121 11.7139C3.38306 11.7139 5.50586 11.1911 7.22484 10.1748C5.78524 12.0861 5.06178 14.5937 5.10692 17.5323V18H10.5786L10.5713 17.46C10.5359 15.463 11.0032 13.9693 11.956 13.0522C13.1967 11.8645 15.2097 11.6845 16.6847 11.7568L17.08 11.7776V6.31794L16.8641 6.30447Z";

export const SIGNET_VIEWBOX = "0 0 17.08 18";
