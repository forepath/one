export interface SharedContactDetails {
  readonly companyName: string;
  readonly addressLines: readonly string[];
  readonly email: string;
  readonly phoneDisplay: string;
  readonly phoneHref: string;
  readonly faxDisplay?: string;
  readonly websiteDisplay: string;
  readonly websiteHref: string;
}

export const SHARED_IPVX_COMPANY_NAME = 'IPvX UG (haftungsbeschränkt)';

export const SHARED_IPVX_CONTACT_ADDRESS_LINES = [
  'Leopoldstraße 2-8',
  '32051 Herford',
  'Nordrhein-Westfalen, Germany',
] as const;

export const SHARED_IPVX_CONTACT_PHONE = {
  phoneDisplay: '+49 (0) 5221 1411690',
  phoneHref: 'tel:+4952211411690',
  faxDisplay: '+49 (0) 5221 1411699',
} as const;

export function createBrandContactDetails(options: { email: string; websiteUrl: string }): SharedContactDetails {
  const websiteHref = options.websiteUrl.startsWith('http') ? options.websiteUrl : `https://${options.websiteUrl}`;
  const websiteDisplay = websiteHref.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return {
    companyName: SHARED_IPVX_COMPANY_NAME,
    addressLines: SHARED_IPVX_CONTACT_ADDRESS_LINES,
    email: options.email,
    websiteDisplay,
    websiteHref,
    ...SHARED_IPVX_CONTACT_PHONE,
  };
}
