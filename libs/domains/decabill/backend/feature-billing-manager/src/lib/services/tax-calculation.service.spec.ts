import { TaxCategory } from '../constants/tax-category.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRateConfigService } from './tax-rate-config.service';
import type { TaxTreatmentResult } from './tax-treatment.service';
import { EinvoiceTaxCategoryCode } from '../constants/tax-mode.constants';

describe('TaxCalculationService with tax treatment', () => {
  const rateConfig = new TaxRateConfigService();
  const service = new TaxCalculationService(rateConfig);

  const reverseCharge: TaxTreatmentResult = {
    taxMode: TaxMode.EU_REVERSE_CHARGE,
    taxCountryCode: 'FR',
    chargeVat: false,
    einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.REVERSE_CHARGE,
    invoiceNoteKey: 'eu_reverse_charge',
    invoiceNote: 'Reverse charge',
    issuerIsInEu: true,
  };

  it('applies zero tax for reverse charge', () => {
    const totals = service.computeLines(
      [{ description: 'SaaS', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
      { taxTreatment: reverseCharge },
    );

    expect(totals.taxTotal).toBe(0);
    expect(totals.totalGross).toBe(100);
    expect(totals.lines[0].taxRate).toBe(0);
  });

  it('applies French standard rate for EU B2C OSS', () => {
    const treatment: TaxTreatmentResult = {
      taxMode: TaxMode.EU_B2C_OSS,
      taxCountryCode: 'FR',
      chargeVat: true,
      einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
      invoiceNoteKey: 'eu_b2c_oss',
      invoiceNote: '',
      issuerIsInEu: true,
    };

    const totals = service.computeLines(
      [{ description: 'SaaS', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
      { taxTreatment: treatment },
    );

    expect(totals.lines[0].taxRate).toBe(20);
    expect(totals.taxTotal).toBe(20);
    expect(totals.totalGross).toBe(120);
  });

  it('falls back to DK standard when reduced is unavailable', () => {
    const treatment: TaxTreatmentResult = {
      taxMode: TaxMode.DOMESTIC_VAT,
      taxCountryCode: 'DK',
      chargeVat: true,
      einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
      invoiceNoteKey: 'domestic_vat',
      invoiceNote: '',
      issuerIsInEu: true,
    };

    const totals = service.computeLines(
      [{ description: 'Item', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.REDUCED }],
      { taxTreatment: treatment },
    );

    expect(totals.lines[0].taxRate).toBe(25);
  });
});
