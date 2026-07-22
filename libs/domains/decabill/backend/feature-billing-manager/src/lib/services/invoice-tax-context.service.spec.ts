import { CustomerType } from '../constants/customer-type.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { VatIdValidationStatus } from '../constants/vat-id-validation.constants';

import { InvoiceTaxContextService } from './invoice-tax-context.service';

describe('InvoiceTaxContextService', () => {
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const billingIssuerConfig = {
    getConfig: jest.fn(),
  };
  const taxTreatmentService = {
    resolve: jest.fn(),
  };
  const ossThresholdService = {
    getDecision: jest.fn(),
  };

  const service = new InvoiceTaxContextService(
    customerProfilesRepository as never,
    billingIssuerConfig as never,
    taxTreatmentService as never,
    ossThresholdService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT;
    billingIssuerConfig.getConfig.mockReturnValue({ country: 'DE' });
    ossThresholdService.getDecision.mockResolvedValue({ ossDestinationApplies: false });
    taxTreatmentService.resolve.mockReturnValue({
      taxMode: TaxMode.DOMESTIC_VAT,
      taxCountryCode: 'DE',
      chargeVat: true,
      issuerIsInEu: true,
    });
  });

  it('resolveForUser maps profile fields into tax treatment', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      country: 'fr',
      customerType: CustomerType.BUSINESS,
      vatId: 'FR12345678901',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
    });
    taxTreatmentService.resolve.mockReturnValue({
      taxMode: TaxMode.EU_REVERSE_CHARGE,
      taxCountryCode: 'FR',
      chargeVat: false,
      issuerIsInEu: true,
    });

    const result = await service.resolveForUser('user-1');

    expect(taxTreatmentService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerCountry: 'DE',
        customerCountry: 'fr',
        customerType: CustomerType.BUSINESS,
        vatId: 'FR12345678901',
        vatIdValidationStatus: VatIdValidationStatus.VALID,
        ossDestinationApplies: false,
        forceChargeNonEuIssuerEuB2b: false,
      }),
    );
    expect(result.buyerVatId).toBe('FR12345678901');
    expect(result.buyerCountry).toBe('fr');
    expect(result.countsTowardOssLedger).toBe(false);
  });

  it('resolveForUser counts OSS ledger for EU cross-border domestic/OSS modes', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      country: 'FR',
      customerType: CustomerType.CONSUMER,
      vatId: null,
      vatIdValidationStatus: VatIdValidationStatus.NONE,
    });
    ossThresholdService.getDecision.mockResolvedValue({ ossDestinationApplies: true });
    taxTreatmentService.resolve.mockReturnValue({
      taxMode: TaxMode.EU_B2C_OSS,
      taxCountryCode: 'FR',
      chargeVat: true,
      issuerIsInEu: true,
    });

    const result = await service.resolveForUser('user-1');

    expect(result.countsTowardOssLedger).toBe(true);
  });

  it('resolveForUser does not count OSS for reverse charge or third-country modes', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      country: 'US',
      customerType: CustomerType.CONSUMER,
      vatId: null,
      vatIdValidationStatus: VatIdValidationStatus.NONE,
    });
    taxTreatmentService.resolve.mockReturnValue({
      taxMode: TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT,
      taxCountryCode: 'US',
      chargeVat: false,
      issuerIsInEu: true,
    });

    const result = await service.resolveForUser('user-1');

    expect(result.countsTowardOssLedger).toBe(false);
  });

  it('resolveForUser defaults issuer country to DE when unset', async () => {
    billingIssuerConfig.getConfig.mockReturnValue({ country: '' });
    customerProfilesRepository.findByUserId.mockResolvedValue(null);

    await service.resolveForUser('user-1');

    expect(taxTreatmentService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerCountry: 'DE',
        customerCountry: null,
        customerType: null,
        vatId: null,
      }),
    );
  });

  it('resolveIssuerDefault uses issuer domestic consumer treatment', async () => {
    const result = await service.resolveIssuerDefault();

    expect(taxTreatmentService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerCountry: 'DE',
        customerCountry: 'DE',
        customerType: CustomerType.CONSUMER,
        vatId: null,
        ossDestinationApplies: false,
      }),
    );
    expect(ossThresholdService.getDecision).not.toHaveBeenCalled();
    expect(result.countsTowardOssLedger).toBe(false);
    expect(result.buyerCountry).toBe('DE');
  });

  it('honors BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT', async () => {
    process.env.BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT = 'true';
    customerProfilesRepository.findByUserId.mockResolvedValue(null);

    await service.resolveForUser('user-1');

    expect(taxTreatmentService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ forceChargeNonEuIssuerEuB2b: true }),
    );
  });
});
