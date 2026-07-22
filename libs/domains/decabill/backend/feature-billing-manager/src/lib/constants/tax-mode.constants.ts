export enum TaxMode {
  DOMESTIC_VAT = 'domestic_vat',
  EU_REVERSE_CHARGE = 'eu_reverse_charge',
  EU_B2C_OSS = 'eu_b2c_oss',
  THIRD_COUNTRY_B2B_NO_VAT = 'third_country_b2b_no_vat',
  THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT = 'third_country_b2c_no_domestic_vat',
  NON_EU_ISSUER_EU_B2B = 'non_eu_issuer_eu_b2b',
  NON_EU_ISSUER_EU_B2C = 'non_eu_issuer_eu_b2c',
}

/** UNCL 5305 VAT category codes used in EN 16931 / CII. */
export enum EinvoiceTaxCategoryCode {
  STANDARD = 'S',
  REVERSE_CHARGE = 'AE',
  ZERO_RATED = 'Z',
  EXEMPT = 'E',
  OUTSIDE_SCOPE = 'O',
}
