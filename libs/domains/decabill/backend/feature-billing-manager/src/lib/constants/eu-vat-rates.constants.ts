/**
 * EU VAT rates for Decabill tax resolution.
 *
 * Source: Your Europe — VAT rates applied in EU member countries
 * https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm
 * sourceCheckedAt: 2026-07-13
 *
 * Domain mapping: TaxCategory.REDUCED uses the lowest reduced rate ≥ 5%.
 * Super-reduced, parking, and zero rates are out of scope for TaxCategory.
 * Regional specials (Azores, Canary Islands, etc.) are excluded.
 *
 * Do not refresh these numbers opportunistically from newer web sources.
 */

export const EU_VAT_RATES_SOURCE_URL =
  'https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm';

export const EU_VAT_RATES_SOURCE_CHECKED_AT = '2026-07-13';

export interface EuVatRateEntry {
  countryCode: string;
  standard: number;
  /** Lowest reduced rate ≥ 5%, or null when unavailable (e.g. DK). */
  reduced: number | null;
}

export const EU_VAT_RATES: Record<string, EuVatRateEntry> = {
  AT: { countryCode: 'AT', standard: 20, reduced: 10 },
  BE: { countryCode: 'BE', standard: 21, reduced: 6 },
  BG: { countryCode: 'BG', standard: 20, reduced: 9 },
  CY: { countryCode: 'CY', standard: 19, reduced: 5 },
  CZ: { countryCode: 'CZ', standard: 21, reduced: 12 },
  DE: { countryCode: 'DE', standard: 19, reduced: 7 },
  DK: { countryCode: 'DK', standard: 25, reduced: null },
  EE: { countryCode: 'EE', standard: 24, reduced: 9 },
  EL: { countryCode: 'EL', standard: 24, reduced: 6 },
  ES: { countryCode: 'ES', standard: 21, reduced: 10 },
  FI: { countryCode: 'FI', standard: 25.5, reduced: 10 },
  FR: { countryCode: 'FR', standard: 20, reduced: 5.5 },
  HR: { countryCode: 'HR', standard: 25, reduced: 5 },
  HU: { countryCode: 'HU', standard: 27, reduced: 5 },
  IE: { countryCode: 'IE', standard: 23, reduced: 9 },
  IT: { countryCode: 'IT', standard: 22, reduced: 5 },
  LT: { countryCode: 'LT', standard: 21, reduced: 5 },
  LU: { countryCode: 'LU', standard: 17, reduced: 8 },
  LV: { countryCode: 'LV', standard: 21, reduced: 5 },
  MT: { countryCode: 'MT', standard: 18, reduced: 5 },
  NL: { countryCode: 'NL', standard: 21, reduced: 9 },
  PL: { countryCode: 'PL', standard: 23, reduced: 5 },
  PT: { countryCode: 'PT', standard: 23, reduced: 6 },
  RO: { countryCode: 'RO', standard: 21, reduced: 11 },
  SE: { countryCode: 'SE', standard: 25, reduced: 6 },
  SI: { countryCode: 'SI', standard: 22, reduced: 5 },
  SK: { countryCode: 'SK', standard: 23, reduced: 5 },
};
