import { Injectable } from '@nestjs/common';

import { CustomerType } from '../constants/customer-type.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { normalizeVatId } from '../utils/vat-id.utils';

import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { OssThresholdService } from './oss-threshold.service';
import type { TaxTreatmentResult } from './tax-treatment.service';
import { TaxTreatmentService } from './tax-treatment.service';

export interface ResolvedInvoiceTaxContext {
  treatment: TaxTreatmentResult;
  forceChargeNonEuIssuerEuB2b: boolean;
  buyerVatId: string | null;
  buyerCountry: string | null;
  buyerCustomerType: CustomerType | null;
  issuerCountry: string;
  /** Whether this issue should count toward the OSS cross-border B2C ledger. */
  countsTowardOssLedger: boolean;
}

@Injectable()
export class InvoiceTaxContextService {
  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly taxTreatmentService: TaxTreatmentService,
    private readonly ossThresholdService: OssThresholdService,
  ) {}

  async resolveForUser(userId: string): Promise<ResolvedInvoiceTaxContext> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);
    const issuer = this.billingIssuerConfig.getConfig();
    const issuerCountry = (issuer.country || 'DE').toUpperCase();
    const forceChargeNonEuIssuerEuB2b = this.isForceChargeNonEuIssuerEuB2b();
    const oss = await this.ossThresholdService.getDecision();
    const buyerCountry = profile?.country ?? null;
    const buyerCustomerType = profile?.customerType ?? null;
    const buyerVatId = normalizeVatId(profile?.vatId ?? null);

    const treatment = this.taxTreatmentService.resolve({
      issuerCountry,
      customerCountry: buyerCountry,
      customerType: buyerCustomerType,
      vatId: buyerVatId,
      vatIdValidationStatus: profile?.vatIdValidationStatus,
      ossDestinationApplies: oss.ossDestinationApplies,
      forceChargeNonEuIssuerEuB2b,
    });

    const isEuCrossBorderNonReverseCharge =
      treatment.issuerIsInEu &&
      Boolean(buyerCountry) &&
      buyerCountry!.toUpperCase() !== issuerCountry &&
      treatment.taxMode !== TaxMode.EU_REVERSE_CHARGE &&
      treatment.taxMode !== TaxMode.THIRD_COUNTRY_B2B_NO_VAT &&
      treatment.taxMode !== TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT &&
      treatment.taxMode !== TaxMode.NON_EU_ISSUER_EU_B2B &&
      treatment.taxMode !== TaxMode.NON_EU_ISSUER_EU_B2C &&
      (treatment.taxMode === TaxMode.EU_B2C_OSS || treatment.taxMode === TaxMode.DOMESTIC_VAT);

    return {
      treatment,
      forceChargeNonEuIssuerEuB2b,
      buyerVatId,
      buyerCountry,
      buyerCustomerType,
      issuerCountry,
      countsTowardOssLedger: isEuCrossBorderNonReverseCharge,
    };
  }

  /** Issuer domestic VAT context (catalogue / admin estimates without a customer). */
  async resolveIssuerDefault(): Promise<ResolvedInvoiceTaxContext> {
    const issuer = this.billingIssuerConfig.getConfig();
    const issuerCountry = (issuer.country || 'DE').toUpperCase();
    const forceChargeNonEuIssuerEuB2b = this.isForceChargeNonEuIssuerEuB2b();
    const treatment = this.taxTreatmentService.resolve({
      issuerCountry,
      customerCountry: issuerCountry,
      customerType: CustomerType.CONSUMER,
      vatId: null,
      vatIdValidationStatus: null,
      ossDestinationApplies: false,
      forceChargeNonEuIssuerEuB2b,
    });

    return {
      treatment,
      forceChargeNonEuIssuerEuB2b,
      buyerVatId: null,
      buyerCountry: issuerCountry,
      buyerCustomerType: CustomerType.CONSUMER,
      issuerCountry,
      countsTowardOssLedger: false,
    };
  }

  private isForceChargeNonEuIssuerEuB2b(): boolean {
    const raw = (process.env.BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT ?? '').trim().toLowerCase();

    return raw === 'true' || raw === '1';
  }
}
