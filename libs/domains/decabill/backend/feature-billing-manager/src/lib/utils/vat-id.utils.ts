import { normalizeVatCountryCode, isEuMemberState } from '../constants/eu-member-states.constants';

/**
 * Normalize VAT ID: uppercase, strip spaces and dots/hyphens commonly present in user input.
 */
export function normalizeVatId(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.replace(/[\s.-]/g, '').toUpperCase();

  return normalized.length > 0 ? normalized : null;
}

export function maskVatId(vatId: string | undefined | null): string | null {
  const normalized = normalizeVatId(vatId);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 4) {
    return `${normalized.slice(0, 2)}***`;
  }

  return `${normalized.slice(0, 2)}***${normalized.slice(-3)}`;
}

/**
 * Basic EU VAT ID format check: country prefix + alphanumeric body.
 * Full VIES validation is separate.
 */
export function isValidEuVatIdFormat(vatId: string | undefined | null): boolean {
  const normalized = normalizeVatId(vatId);

  if (!normalized || normalized.length < 4 || normalized.length > 14) {
    return false;
  }

  const country = normalizeVatCountryCode(normalized.slice(0, 2));

  if (!country || !isEuMemberState(country)) {
    return false;
  }

  const body = normalized.slice(2);

  return /^[A-Z0-9]+$/.test(body) && body.length >= 2;
}

export function extractVatIdCountryCode(vatId: string | undefined | null): string | null {
  const normalized = normalizeVatId(vatId);

  if (!normalized || normalized.length < 2) {
    return null;
  }

  return normalizeVatCountryCode(normalized.slice(0, 2));
}
