import { Injectable } from '@nestjs/common';

import { CustomerType } from '../constants/customer-type.constants';
import { isEuMemberState, normalizeVatCountryCode } from '../constants/eu-member-states.constants';
import { EinvoiceTaxCategoryCode, TaxMode } from '../constants/tax-mode.constants';
import { VatIdValidationStatus } from '../constants/vat-id-validation.constants';

export interface TaxTreatmentContext {
  issuerCountry: string;
  customerCountry?: string | null;
  customerType?: CustomerType | null;
  vatId?: string | null;
  vatIdValidationStatus?: VatIdValidationStatus | null;
  /** When true, EU B2C cross-border uses destination rates (OSS). */
  ossDestinationApplies: boolean;
  /** When true, non_eu_issuer_eu_b2b charges customer-country VAT. */
  forceChargeNonEuIssuerEuB2b?: boolean;
}

export interface TaxTreatmentResult {
  taxMode: TaxMode;
  taxCountryCode: string;
  chargeVat: boolean;
  einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode;
  invoiceNoteKey: string;
  invoiceNote: string;
  issuerIsInEu: boolean;
}

const NOTES: Record<string, string> = {
  domestic_vat: '',
  eu_reverse_charge:
    'Reverse charge: VAT to be accounted for by the recipient pursuant to Article 196 of Directive 2006/112/EC.',
  eu_b2c_oss: 'EU cross-border B2C supply; VAT charged in the customer country (OSS).',
  third_country_b2b_no_vat: 'Supply of services to a non-EU business customer; outside EU VAT scope (no domestic VAT).',
  third_country_b2c_no_domestic_vat: 'Supply of digital services to a non-EU consumer; no domestic EU VAT charged.',
  non_eu_issuer_eu_b2b:
    'Non-EU supplier to EU business customer; no domestic VAT charged under place-of-supply rules for this deployment.',
  non_eu_issuer_eu_b2c: 'Non-EU supplier to EU consumer; EU VAT charged in the customer country (non-Union OSS).',
  non_eu_issuer_eu_b2b_charged: 'Non-EU supplier registered for EU VAT; VAT charged in the customer country.',
};

@Injectable()
export class TaxTreatmentService {
  resolve(context: TaxTreatmentContext): TaxTreatmentResult {
    const issuerCountry = normalizeVatCountryCode(context.issuerCountry) ?? 'DE';
    const customerCountry = normalizeVatCountryCode(context.customerCountry);
    const issuerIsInEu = isEuMemberState(issuerCountry);
    const customerIsInEu = isEuMemberState(customerCountry);
    const customerType = this.resolveCustomerType(context);
    const isBusiness = customerType === CustomerType.BUSINESS;
    const vatValid = Boolean(context.vatId?.trim()) && context.vatIdValidationStatus === VatIdValidationStatus.VALID;
    const reverseChargeEligible = isBusiness && vatValid;

    if (!customerCountry) {
      return this.result({
        taxMode: TaxMode.DOMESTIC_VAT,
        taxCountryCode: issuerCountry,
        chargeVat: true,
        einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
        invoiceNoteKey: 'domestic_vat',
        issuerIsInEu,
      });
    }

    const sameCountry = customerCountry === issuerCountry;

    if (issuerIsInEu) {
      if (sameCountry) {
        return this.result({
          taxMode: TaxMode.DOMESTIC_VAT,
          taxCountryCode: issuerCountry,
          chargeVat: true,
          einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
          invoiceNoteKey: 'domestic_vat',
          issuerIsInEu,
        });
      }

      if (customerIsInEu) {
        if (reverseChargeEligible) {
          return this.result({
            taxMode: TaxMode.EU_REVERSE_CHARGE,
            taxCountryCode: customerCountry,
            chargeVat: false,
            einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.REVERSE_CHARGE,
            invoiceNoteKey: 'eu_reverse_charge',
            issuerIsInEu,
          });
        }

        if (context.ossDestinationApplies) {
          return this.result({
            taxMode: TaxMode.EU_B2C_OSS,
            taxCountryCode: customerCountry,
            chargeVat: true,
            einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
            invoiceNoteKey: 'eu_b2c_oss',
            issuerIsInEu,
          });
        }

        // Under OSS threshold: home-country VAT for cross-border EU B2C / non-RC.
        return this.result({
          taxMode: TaxMode.DOMESTIC_VAT,
          taxCountryCode: issuerCountry,
          chargeVat: true,
          einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
          invoiceNoteKey: 'domestic_vat',
          issuerIsInEu,
        });
      }

      if (isBusiness) {
        return this.result({
          taxMode: TaxMode.THIRD_COUNTRY_B2B_NO_VAT,
          taxCountryCode: customerCountry,
          chargeVat: false,
          einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.OUTSIDE_SCOPE,
          invoiceNoteKey: 'third_country_b2b_no_vat',
          issuerIsInEu,
        });
      }

      return this.result({
        taxMode: TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT,
        taxCountryCode: customerCountry,
        chargeVat: false,
        einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.OUTSIDE_SCOPE,
        invoiceNoteKey: 'third_country_b2c_no_domestic_vat',
        issuerIsInEu,
      });
    }

    // Non-EU issuer
    if (customerIsInEu) {
      if (isBusiness) {
        if (context.forceChargeNonEuIssuerEuB2b) {
          return this.result({
            taxMode: TaxMode.NON_EU_ISSUER_EU_B2B,
            taxCountryCode: customerCountry,
            chargeVat: true,
            einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
            invoiceNoteKey: 'non_eu_issuer_eu_b2b_charged',
            issuerIsInEu,
          });
        }

        return this.result({
          taxMode: TaxMode.NON_EU_ISSUER_EU_B2B,
          taxCountryCode: customerCountry,
          chargeVat: false,
          einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.OUTSIDE_SCOPE,
          invoiceNoteKey: 'non_eu_issuer_eu_b2b',
          issuerIsInEu,
        });
      }

      return this.result({
        taxMode: TaxMode.NON_EU_ISSUER_EU_B2C,
        taxCountryCode: customerCountry,
        chargeVat: true,
        einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
        invoiceNoteKey: 'non_eu_issuer_eu_b2c',
        issuerIsInEu,
      });
    }

    if (isBusiness) {
      return this.result({
        taxMode: TaxMode.THIRD_COUNTRY_B2B_NO_VAT,
        taxCountryCode: customerCountry,
        chargeVat: false,
        einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.OUTSIDE_SCOPE,
        invoiceNoteKey: 'third_country_b2b_no_vat',
        issuerIsInEu,
      });
    }

    return this.result({
      taxMode: TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT,
      taxCountryCode: customerCountry,
      chargeVat: false,
      einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.OUTSIDE_SCOPE,
      invoiceNoteKey: 'third_country_b2c_no_domestic_vat',
      issuerIsInEu,
    });
  }

  isReverseChargeEligible(
    context: Pick<TaxTreatmentContext, 'customerType' | 'vatId' | 'vatIdValidationStatus'>,
  ): boolean {
    const customerType = this.resolveCustomerType(context);

    return (
      customerType === CustomerType.BUSINESS &&
      Boolean(context.vatId?.trim()) &&
      context.vatIdValidationStatus === VatIdValidationStatus.VALID
    );
  }

  private resolveCustomerType(context: Pick<TaxTreatmentContext, 'customerType'>): CustomerType {
    if (context.customerType === CustomerType.BUSINESS || context.customerType === CustomerType.CONSUMER) {
      return context.customerType;
    }

    return CustomerType.CONSUMER;
  }

  private result(partial: Omit<TaxTreatmentResult, 'invoiceNote'> & { invoiceNoteKey: string }): TaxTreatmentResult {
    return {
      ...partial,
      invoiceNote: NOTES[partial.invoiceNoteKey] ?? '',
    };
  }
}
