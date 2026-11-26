// Pure helpers (no server-only imports) so they can be used in client components and tests.
export type Fx = {
  rate: number;          // NGN per 1 USD
  rateUpdatedAt: string | null;
  minUsdCents: number;
  maxUsdCents: number;
  minTopupKobo: number;  // the ₦ minimum shown to users (from site_settings)
};

/** USD cents -> NGN kobo. (cents/100 * rate NGN) * 100 kobo = cents * rate. */
export const usdCentsToKobo = (cents: number, rate: number) => Math.round(cents * rate);

/** NGN kobo -> USD cents, rounded up so we never undercharge. Epsilon avoids 20.000000000000004 -> 21. */
export const koboToUsdCentsCeil = (kobo: number, rate: number) => Math.ceil(kobo / rate - 1e-9);

/** Smallest top-up: the larger of the USD floor and the ₦ minimum converted to USD. */
export const effectiveMinUsdCents = (fx: Pick<Fx, "rate" | "minUsdCents" | "minTopupKobo">) =>
  Math.max(fx.minUsdCents, koboToUsdCentsCeil(fx.minTopupKobo, fx.rate));

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "12", "12.5", "12.50" -> cents. Anything else -> null. */
export function parseUsdInput(s: string): number | null {
  const t = s.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
