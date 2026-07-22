import { CustomerType } from '../constants/customer-type.constants';
import { VatIdValidationStatus } from '../constants/vat-id-validation.constants';
import { TaxMode, EinvoiceTaxCategoryCode } from '../constants/tax-mode.constants';
import { TaxTreatmentService } from './tax-treatment.service';

describe('TaxTreatmentService', () => {
  const service = new TaxTreatmentService();

  it('applies domestic VAT for same-country customers regardless of VAT ID', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'DE',
      customerType: CustomerType.BUSINESS,
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
      ossDestinationApplies: true,
    });

    expect(result.taxMode).toBe(TaxMode.DOMESTIC_VAT);
    expect(result.chargeVat).toBe(true);
    expect(result.taxCountryCode).toBe('DE');
  });

  it('applies EU reverse charge only when business + valid VAT + other EU country', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'FR',
      customerType: CustomerType.BUSINESS,
      vatId: 'FR12345678901',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
      ossDestinationApplies: false,
    });

    expect(result.taxMode).toBe(TaxMode.EU_REVERSE_CHARGE);
    expect(result.chargeVat).toBe(false);
    expect(result.einvoiceTaxCategoryCode).toBe(EinvoiceTaxCategoryCode.REVERSE_CHARGE);
  });

  it('does not reverse-charge without valid VAT ID status', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'FR',
      customerType: CustomerType.BUSINESS,
      vatId: 'FR12345678901',
      vatIdValidationStatus: VatIdValidationStatus.PENDING,
      ossDestinationApplies: true,
    });

    expect(result.taxMode).toBe(TaxMode.EU_B2C_OSS);
    expect(result.chargeVat).toBe(true);
  });

  it('uses home VAT under OSS threshold for EU B2C', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'FR',
      customerType: CustomerType.CONSUMER,
      ossDestinationApplies: false,
    });

    expect(result.taxMode).toBe(TaxMode.DOMESTIC_VAT);
    expect(result.taxCountryCode).toBe('DE');
  });

  it('uses destination VAT when OSS threshold exceeded', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'FR',
      customerType: CustomerType.CONSUMER,
      ossDestinationApplies: true,
    });

    expect(result.taxMode).toBe(TaxMode.EU_B2C_OSS);
    expect(result.taxCountryCode).toBe('FR');
  });

  it('applies third-country B2B no VAT', () => {
    const result = service.resolve({
      issuerCountry: 'DE',
      customerCountry: 'US',
      customerType: CustomerType.BUSINESS,
      ossDestinationApplies: false,
    });

    expect(result.taxMode).toBe(TaxMode.THIRD_COUNTRY_B2B_NO_VAT);
    expect(result.chargeVat).toBe(false);
  });

  it('handles non-EU issuer to EU B2B as separate mode defaulting to no VAT', () => {
    const result = service.resolve({
      issuerCountry: 'US',
      customerCountry: 'DE',
      customerType: CustomerType.BUSINESS,
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
      ossDestinationApplies: false,
    });

    expect(result.taxMode).toBe(TaxMode.NON_EU_ISSUER_EU_B2B);
    expect(result.chargeVat).toBe(false);
    expect(result.einvoiceTaxCategoryCode).not.toBe(EinvoiceTaxCategoryCode.REVERSE_CHARGE);
  });

  it('charges customer-country VAT for non-EU issuer EU B2B when forced', () => {
    const result = service.resolve({
      issuerCountry: 'US',
      customerCountry: 'DE',
      customerType: CustomerType.BUSINESS,
      ossDestinationApplies: false,
      forceChargeNonEuIssuerEuB2b: true,
    });

    expect(result.taxMode).toBe(TaxMode.NON_EU_ISSUER_EU_B2B);
    expect(result.chargeVat).toBe(true);
  });

  it('charges EU B2C VAT for non-EU issuer', () => {
    const result = service.resolve({
      issuerCountry: 'US',
      customerCountry: 'DE',
      customerType: CustomerType.CONSUMER,
      ossDestinationApplies: false,
    });

    expect(result.taxMode).toBe(TaxMode.NON_EU_ISSUER_EU_B2C);
    expect(result.chargeVat).toBe(true);
    expect(result.taxCountryCode).toBe('DE');
  });
});
