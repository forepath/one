import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
import type { TaxPreviewRequestDto, TaxPreviewResponseDto } from '../dto/tax-preview.dto';

import { InvoiceTaxContextService } from './invoice-tax-context.service';
import type { LineItemInput } from './tax-calculation.service';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRateConfigService } from './tax-rate-config.service';

@Injectable()
export class TaxPreviewService {
  constructor(
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly taxRateConfig: TaxRateConfigService,
  ) {}

  async preview(dto: TaxPreviewRequestDto): Promise<TaxPreviewResponseDto> {
    const context = dto.userId
      ? await this.invoiceTaxContextService.resolveForUser(dto.userId)
      : await this.invoiceTaxContextService.resolveIssuerDefault();

    const rateParams = {
      countryCode: context.treatment.taxCountryCode,
      taxMode: context.treatment.taxMode,
      forceChargeNonEuIssuerEuB2b: context.forceChargeNonEuIssuerEuB2b,
    };

    const rates = {
      standard: context.treatment.chargeVat
        ? this.taxRateConfig.resolveRate({ ...rateParams, taxCategory: TaxCategory.STANDARD })
        : 0,
      reduced: context.treatment.chargeVat
        ? this.taxRateConfig.resolveRate({ ...rateParams, taxCategory: TaxCategory.REDUCED })
        : 0,
    };

    const response: TaxPreviewResponseDto = {
      taxMode: context.treatment.taxMode,
      taxCountryCode: context.treatment.taxCountryCode,
      chargeVat: context.treatment.chargeVat,
      taxNote: context.treatment.invoiceNote || null,
      einvoiceTaxCategoryCode: context.treatment.einvoiceTaxCategoryCode,
      rates,
    };

    if (!dto.lineItems?.length) {
      return response;
    }

    const lineInputs: LineItemInput[] = dto.lineItems.map((line) => ({
      description: line.description?.trim() || 'Line',
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxCategory: line.taxCategory ?? TaxCategory.STANDARD,
    }));

    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: context.treatment,
      forceChargeNonEuIssuerEuB2b: context.forceChargeNonEuIssuerEuB2b,
    });

    return {
      ...response,
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      lines: totals.lines,
    };
  }
}
