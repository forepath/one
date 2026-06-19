import { BILLING_SUPPORTED_ALPHA2_CODES } from '@forepath/agenstra/frontend/data-access-billing-console';
import { getNames, registerLocale } from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

export interface BillingCountryOption {
  code: string;
  name: string;
}

registerLocale(enLocale as unknown as Parameters<typeof registerLocale>[0]);

export const BILLING_COUNTRY_OPTIONS: BillingCountryOption[] = (() => {
  const supported = new Set(BILLING_SUPPORTED_ALPHA2_CODES);
  const names = getNames('en', { select: 'official' });

  return Object.entries(names)
    .filter(([code]) => supported.has(code))
    .map(([code, name]) => ({ code, name: name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();

export const DEFAULT_BILLING_COUNTRY_CODE = BILLING_COUNTRY_OPTIONS[0]?.code ?? '';

const COUNTRY_NAME_BY_CODE = new Map(BILLING_COUNTRY_OPTIONS.map((option) => [option.code, option.name]));

export function getCountryDisplayName(code: string | null | undefined): string {
  if (!code?.trim()) {
    return $localize`:@@featureBilling-countryNotAvailable:N/A`;
  }

  return COUNTRY_NAME_BY_CODE.get(code.trim()) ?? code.trim();
}
