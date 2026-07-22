/**
 * EU member state codes used for VAT / place-of-supply.
 * Greece uses VAT code EL (ISO 3166-1 alpha-2 GR is accepted as an alias).
 */
export const EU_MEMBER_STATE_CODES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;

export type EuMemberStateCode = (typeof EU_MEMBER_STATE_CODES)[number];

const EU_MEMBER_STATE_SET = new Set<string>(EU_MEMBER_STATE_CODES);

/** Normalize ISO country codes for VAT lookups (GR → EL). */
export function normalizeVatCountryCode(countryCode: string | undefined | null): string | null {
  if (!countryCode || typeof countryCode !== 'string') {
    return null;
  }

  const normalized = countryCode.trim().toUpperCase();

  if (normalized.length !== 2) {
    return null;
  }

  if (normalized === 'GR') {
    return 'EL';
  }

  return normalized;
}

export function isEuMemberState(countryCode: string | undefined | null): boolean {
  const normalized = normalizeVatCountryCode(countryCode);

  return normalized !== null && EU_MEMBER_STATE_SET.has(normalized);
}
