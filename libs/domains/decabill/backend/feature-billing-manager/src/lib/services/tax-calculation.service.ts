import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import type { TaxTreatmentResult } from './tax-treatment.service';

import { TaxRateConfigService } from './tax-rate-config.service';

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
}

export interface ComputedLineItem {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory: TaxCategory;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
}

export interface InvoiceTotals {
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  lines: ComputedLineItem[];
  taxBreakdown: { taxCategory: TaxCategory; taxRate: number; taxAmount: number }[];
  taxTreatment?: TaxTreatmentResult;
  resolvedTaxRate?: number;
}

export interface ComputeLinesOptions {
  taxTreatment?: TaxTreatmentResult;
  forceChargeNonEuIssuerEuB2b?: boolean;
}

@Injectable()
export class TaxCalculationService {
  constructor(private readonly taxRateConfig: TaxRateConfigService) {}

  computeLines(inputs: LineItemInput[], options?: ComputeLinesOptions): InvoiceTotals {
    const treatment = options?.taxTreatment;
    const taxMode = treatment?.taxMode ?? TaxMode.DOMESTIC_VAT;
    const taxCountryCode = treatment?.taxCountryCode;
    const forceCharge = options?.forceChargeNonEuIssuerEuB2b === true;

    const lines: ComputedLineItem[] = inputs.map((input) => {
      const taxCategory = input.taxCategory ?? TaxCategory.STANDARD;
      const taxRate =
        treatment && !treatment.chargeVat
          ? 0
          : this.taxRateConfig.resolveRate({
              countryCode: taxCountryCode,
              taxCategory,
              taxMode,
              forceChargeNonEuIssuerEuB2b: forceCharge,
            });
      const lineNet = this.round(input.quantity * input.unitPriceNet);
      const lineTax = this.round(lineNet * (taxRate / 100));
      const lineGross = this.round(lineNet + lineTax);

      return {
        description: input.description,
        quantity: input.quantity,
        unitPriceNet: input.unitPriceNet,
        taxCategory,
        taxRate,
        lineNet,
        lineTax,
        lineGross,
      };
    });
    const subtotalNet = this.round(lines.reduce((sum, line) => sum + line.lineNet, 0));
    const taxTotal = this.round(lines.reduce((sum, line) => sum + line.lineTax, 0));
    const totalGross = this.round(subtotalNet + taxTotal);
    const taxByKey = new Map<string, { taxCategory: TaxCategory; taxRate: number; taxAmount: number }>();

    for (const line of lines) {
      const key = `${line.taxCategory}:${line.taxRate}`;
      const existing = taxByKey.get(key);

      if (existing) {
        existing.taxAmount = this.round(existing.taxAmount + line.lineTax);
      } else {
        taxByKey.set(key, {
          taxCategory: line.taxCategory,
          taxRate: line.taxRate,
          taxAmount: line.lineTax,
        });
      }
    }

    const resolvedTaxRate =
      lines.length === 0
        ? 0
        : lines.every((line) => line.taxRate === lines[0].taxRate)
          ? lines[0].taxRate
          : lines[0].taxRate;

    return {
      subtotalNet,
      taxTotal,
      totalGross,
      lines,
      taxBreakdown: Array.from(taxByKey.values()),
      taxTreatment: treatment,
      resolvedTaxRate,
    };
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
