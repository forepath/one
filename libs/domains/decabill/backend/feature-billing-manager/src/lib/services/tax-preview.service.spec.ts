import { TaxCategory } from '../constants/tax-category.constants';
import { TaxMode } from '../constants/tax-mode.constants';

import { TaxPreviewService } from './tax-preview.service';

describe('TaxPreviewService', () => {
  const invoiceTaxContextService = {
    resolveForUser: jest.fn(),
    resolveIssuerDefault: jest.fn(),
  };
  const taxCalculationService = {
    computeLines: jest.fn(),
  };
  const taxRateConfig = {
    resolveRate: jest.fn(),
  };

  const service = new TaxPreviewService(
    invoiceTaxContextService as never,
    taxCalculationService as never,
    taxRateConfig as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    invoiceTaxContextService.resolveIssuerDefault.mockResolvedValue({
      treatment: {
        taxMode: TaxMode.DOMESTIC_VAT,
        taxCountryCode: 'DE',
        chargeVat: true,
        invoiceNote: '',
        einvoiceTaxCategoryCode: 'S',
      },
      forceChargeNonEuIssuerEuB2b: false,
    });
    taxRateConfig.resolveRate.mockImplementation(({ taxCategory }: { taxCategory: TaxCategory }) =>
      taxCategory === TaxCategory.REDUCED ? 7 : 19,
    );
  });

  it('returns issuer rates when no userId is provided', async () => {
    const result = await service.preview({});

    expect(invoiceTaxContextService.resolveIssuerDefault).toHaveBeenCalled();
    expect(result.rates).toEqual({ standard: 19, reduced: 7 });
    expect(result.taxMode).toBe(TaxMode.DOMESTIC_VAT);
  });

  it('returns zero rates when chargeVat is false', async () => {
    invoiceTaxContextService.resolveForUser.mockResolvedValue({
      treatment: {
        taxMode: TaxMode.EU_REVERSE_CHARGE,
        taxCountryCode: 'FR',
        chargeVat: false,
        invoiceNote: 'RC',
        einvoiceTaxCategoryCode: 'AE',
      },
      forceChargeNonEuIssuerEuB2b: false,
    });

    const result = await service.preview({ userId: '11111111-1111-4111-8111-111111111111' });

    expect(result.rates).toEqual({ standard: 0, reduced: 0 });
    expect(result.chargeVat).toBe(false);
  });

  it('includes computed lines when lineItems are provided', async () => {
    taxCalculationService.computeLines.mockReturnValue({
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      lines: [
        {
          description: 'Line',
          quantity: 1,
          unitPriceNet: 100,
          taxCategory: TaxCategory.STANDARD,
          taxRate: 19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
        },
      ],
    });

    const result = await service.preview({
      lineItems: [{ quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
    });

    expect(result.totalGross).toBe(119);
    expect(result.lines).toHaveLength(1);
  });
});
