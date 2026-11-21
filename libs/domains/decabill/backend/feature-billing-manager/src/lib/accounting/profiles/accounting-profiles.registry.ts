import type { AccountingCountryProfile, ChartTemplate } from './accounting-profile.types';
import { AT_EKR_TEMPLATE, AT_PROFILE } from './countries/at.profile';
import { BE_PCMN_TEMPLATE, BE_PROFILE } from './countries/be.profile';
import { CH_KMU_TEMPLATE, CH_PROFILE } from './countries/ch.profile';
import { DE_PROFILE, DE_SKR03_TEMPLATE, DE_SKR04_TEMPLATE } from './countries/de.profile';
import { ES_PGC_TEMPLATE, ES_PROFILE } from './countries/es.profile';
import { FR_PCG_TEMPLATE, FR_PROFILE } from './countries/fr.profile';
import { GB_FRS_TEMPLATE, GB_PROFILE } from './countries/gb.profile';
import { GENERIC_IFRS_TEMPLATE, GENERIC_PROFILE } from './countries/generic.profile';
import { IT_CEE_TEMPLATE, IT_PROFILE } from './countries/it.profile';
import { LU_PCN_TEMPLATE, LU_PROFILE } from './countries/lu.profile';
import { NL_PROFILE, NL_RGS_TEMPLATE } from './countries/nl.profile';

/** National accounting profiles by ISO 3166-1 alpha-2 country; `*` is the generic fallback. */
export const ACCOUNTING_PROFILES: Record<string, AccountingCountryProfile> = {
  DE: DE_PROFILE,
  AT: AT_PROFILE,
  FR: FR_PROFILE,
  NL: NL_PROFILE,
  BE: BE_PROFILE,
  LU: LU_PROFILE,
  ES: ES_PROFILE,
  IT: IT_PROFILE,
  CH: CH_PROFILE,
  GB: GB_PROFILE,
  '*': GENERIC_PROFILE,
};

const TEMPLATE_LIST: ChartTemplate[] = [
  DE_SKR03_TEMPLATE,
  DE_SKR04_TEMPLATE,
  AT_EKR_TEMPLATE,
  FR_PCG_TEMPLATE,
  NL_RGS_TEMPLATE,
  BE_PCMN_TEMPLATE,
  LU_PCN_TEMPLATE,
  ES_PGC_TEMPLATE,
  IT_CEE_TEMPLATE,
  CH_KMU_TEMPLATE,
  GB_FRS_TEMPLATE,
  GENERIC_IFRS_TEMPLATE,
];

/** All chart templates by key (`DE-SKR03`, `FR-PCG`, `GENERIC-IFRS`, …). */
export const CHART_TEMPLATES: Record<string, ChartTemplate> = Object.fromEntries(
  TEMPLATE_LIST.map((template) => [template.key, template]),
);

/** Common aliases that are not ISO 3166-1 alpha-2 codes. */
const COUNTRY_ALIASES: Record<string, string> = { UK: 'GB' };

/** Profile for the issuer country (case-insensitive); falls back to the generic profile. */
export function resolveAccountingProfile(country: string | null | undefined): AccountingCountryProfile {
  const normalized = (country ?? '').trim().toUpperCase();
  const key = COUNTRY_ALIASES[normalized] ?? normalized;

  return (key && ACCOUNTING_PROFILES[key]) || GENERIC_PROFILE;
}

export function listChartTemplates(): ChartTemplate[] {
  return [...TEMPLATE_LIST];
}

/**
 * Countries with statutory real-time e-invoicing / reporting obligations Decabill does not implement. Used to warn
 * when the issuer is located there (whether the country has a profile or falls back to the generic one).
 */
export const EINVOICE_MANDATE_COUNTRIES: Record<string, string> = {
  IT: 'All invoices (B2B, B2C, cross-border) must be transmitted via SDI as FatturaPA; Decabill does not connect to SDI.',
  PL: 'KSeF structured e-invoicing is mandatory from 2026 (phased by company size); Decabill does not connect to KSeF.',
  HU: 'Real-time invoice reporting to NAV (Online Számla) is mandatory; Decabill does not report to NAV.',
  RO: 'RO e-Factura is mandatory for B2B and B2C invoices (plus e-Transport); Decabill does not connect to ANAF SPV.',
  GR: 'myDATA real-time reporting is mandatory and B2B e-invoicing via certified providers is being phased in from 2026; not implemented.',
  PT: 'Invoices must be issued by AT-certified software (ATCUD, QR code, SAF-T PT); Decabill is not certified.',
  HR: 'Fiscalisation 2.0 (B2B e-invoicing and real-time reporting) is mandatory from 2026; not implemented.',
  FR: 'E-invoicing via a plateforme agréée (PA) and e-reporting are mandatory from September 2026/2027; Decabill does not connect to a PA.',
  BE: 'Structured B2B e-invoicing via Peppol is mandatory since 2026; Decabill creates Peppol BIS files but does not transmit them via an access point.',
  ES: 'SII (large companies), VERI*FACTU certified billing software (2027) and TicketBAI (Basque Country) are not implemented.',
  SK: 'B2B e-invoicing and e-reporting are mandatory from 2027; not implemented.',
};
