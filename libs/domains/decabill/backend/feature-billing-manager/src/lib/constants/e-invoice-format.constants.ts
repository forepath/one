/** Selectable e-invoice formats (issuer default via env, overridable per customer, snapshotted per invoice). */
export enum EInvoiceFormat {
  /** Factur-X / ZUGFeRD 2.x hybrid PDF, profile EN 16931 (COMFORT). Default. */
  FACTUR_X_EN16931 = 'factur-x-en16931',
  FACTUR_X_BASIC = 'factur-x-basic',
  FACTUR_X_EXTENDED = 'factur-x-extended',
  /** German CIUS XRechnung 3.0 in CII syntax (also embedded as ZUGFeRD XRECHNUNG profile). */
  XRECHNUNG_CII = 'xrechnung-cii',
  /** XRechnung 3.0 in UBL 2.1 syntax. */
  XRECHNUNG_UBL = 'xrechnung-ubl',
  /** Peppol BIS Billing 3.0 (UBL 2.1). */
  PEPPOL_BIS_3 = 'peppol-bis-3',
  /** Plain EN 16931 in UBL 2.1 syntax. */
  UBL_EN16931 = 'ubl-en16931',
}

export interface EInvoiceFormatDefinition {
  format: EInvoiceFormat;
  label: string;
  syntax: 'cii' | 'ubl';
  /** BT-24 specification identifier. */
  customizationId: string;
  /** BT-23 business process (UBL / Peppol). */
  profileId?: string;
  /** Factur-X XMP conformance level of the CII embedded in the PDF. */
  facturXConformance: 'BASIC' | 'EN 16931' | 'EXTENDED' | 'XRECHNUNG';
  /** BT-10 buyer reference is mandatory (XRechnung: Leitweg-ID or other reference). */
  requiresBuyerReference: boolean;
  /** Seller / buyer electronic addresses (BT-34 / BT-49) are mandatory (Peppol). */
  requiresEndpoints: boolean;
}

export const EINVOICE_FORMATS: Record<EInvoiceFormat, EInvoiceFormatDefinition> = {
  [EInvoiceFormat.FACTUR_X_EN16931]: {
    format: EInvoiceFormat.FACTUR_X_EN16931,
    label: 'Factur-X / ZUGFeRD EN 16931',
    syntax: 'cii',
    customizationId: 'urn:cen.eu:en16931:2017',
    facturXConformance: 'EN 16931',
    requiresBuyerReference: false,
    requiresEndpoints: false,
  },
  [EInvoiceFormat.FACTUR_X_BASIC]: {
    format: EInvoiceFormat.FACTUR_X_BASIC,
    label: 'Factur-X / ZUGFeRD BASIC',
    syntax: 'cii',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
    facturXConformance: 'BASIC',
    requiresBuyerReference: false,
    requiresEndpoints: false,
  },
  [EInvoiceFormat.FACTUR_X_EXTENDED]: {
    format: EInvoiceFormat.FACTUR_X_EXTENDED,
    label: 'Factur-X / ZUGFeRD EXTENDED',
    syntax: 'cii',
    customizationId: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
    facturXConformance: 'EXTENDED',
    requiresBuyerReference: false,
    requiresEndpoints: false,
  },
  [EInvoiceFormat.XRECHNUNG_CII]: {
    format: EInvoiceFormat.XRECHNUNG_CII,
    label: 'XRechnung 3.0 (CII)',
    syntax: 'cii',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    facturXConformance: 'XRECHNUNG',
    requiresBuyerReference: true,
    requiresEndpoints: true,
  },
  [EInvoiceFormat.XRECHNUNG_UBL]: {
    format: EInvoiceFormat.XRECHNUNG_UBL,
    label: 'XRechnung 3.0 (UBL)',
    syntax: 'ubl',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    facturXConformance: 'EN 16931',
    requiresBuyerReference: true,
    requiresEndpoints: true,
  },
  [EInvoiceFormat.PEPPOL_BIS_3]: {
    format: EInvoiceFormat.PEPPOL_BIS_3,
    label: 'Peppol BIS Billing 3.0 (UBL)',
    syntax: 'ubl',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    facturXConformance: 'EN 16931',
    requiresBuyerReference: false,
    requiresEndpoints: true,
  },
  [EInvoiceFormat.UBL_EN16931]: {
    format: EInvoiceFormat.UBL_EN16931,
    label: 'EN 16931 (UBL 2.1)',
    syntax: 'ubl',
    customizationId: 'urn:cen.eu:en16931:2017',
    facturXConformance: 'EN 16931',
    requiresBuyerReference: false,
    requiresEndpoints: false,
  },
};

export const EINVOICE_FORMAT_VALUES = Object.values(EInvoiceFormat);

/**
 * Peppol EAS codes for VAT-number endpoints per country (used when no explicit `scheme:id` endpoint is set on the
 * customer profile). Verify against the current Peppol EAS code list before relying on a scheme in production.
 */
export const EAS_VAT_SCHEME_BY_COUNTRY: Readonly<Record<string, string>> = {
  DE: '9930',
  AT: '9914',
  BE: '9925',
  NL: '9944',
  FR: '9957',
  IT: '0211',
  ES: '9920',
  LU: '9938',
  IE: '9935',
  PT: '9946',
  GR: '9933',
  PL: '9945',
  CZ: '9929',
  SK: '9950',
  SI: '9949',
  HU: '9910',
  RO: '9947',
  BG: '9926',
  HR: '9934',
  CY: '9928',
  MT: '9943',
  LV: '9939',
  LT: '9937',
  EE: '9931',
  SE: '9955',
  DK: '9902',
  FI: '0213',
  GB: '9932',
};
