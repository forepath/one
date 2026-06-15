import { getName, registerLocale } from 'i18n-iso-countries';

let localeRegistered = false;

function ensureEnglishLocale(): void {
  if (localeRegistered) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  registerLocale(require('i18n-iso-countries/langs/en.json') as Parameters<typeof registerLocale>[0]);
  localeRegistered = true;
}

/**
 * Resolves an ISO 3166-1 alpha-2 code to the official English country name
 * (aligned with the billing console country dropdown).
 */
export function resolveCountryDisplayName(iso2: string | undefined | null): string | undefined {
  const code = iso2?.trim().toUpperCase();

  if (!code) {
    return undefined;
  }

  ensureEnglishLocale();

  return getName(code, 'en', { select: 'official' }) ?? getName(code, 'en') ?? code;
}
