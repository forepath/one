import { roundMoney } from '../core/random';

export type TaxCategory = 'standard' | 'reduced' | 'custom';

export interface BuyerTaxProfile {
  country: string;
  customerType: 'business' | 'consumer';
  vatId: string | null;
}

export interface ResolvedTax {
  taxMode: string;
  einvoiceCode: string;
  standardRate: number;
  reducedRate: number;
  taxCountry: string;
  note: string | null;
}

const EU_COUNTRIES = new Set(['AT', 'BE', 'DE', 'DK', 'ES', 'FI', 'FR', 'IE', 'IT', 'NL', 'PL', 'PT', 'SE']);
const EU_B2C_RATES: Record<string, [number, number]> = {
  AT: [20, 10],
  FR: [20, 5.5],
  NL: [21, 9],
  PL: [23, 8],
};

export function isEuCountry(country: string): boolean {
  return EU_COUNTRIES.has(country);
}

/**
 * Simplified version of the backend tax resolution for an issuer in `issuerCountry`
 * (domestic VAT, EU reverse charge, OSS for EU consumers, no VAT for third countries).
 */
export function resolveTax(buyer: BuyerTaxProfile, issuerCountry: string): ResolvedTax {
  if (buyer.country === issuerCountry) {
    return {
      taxMode: 'domestic_vat',
      einvoiceCode: 'S',
      standardRate: 19,
      reducedRate: 7,
      taxCountry: issuerCountry,
      note: null,
    };
  }

  if (isEuCountry(buyer.country)) {
    if (buyer.customerType === 'business' && buyer.vatId) {
      return {
        taxMode: 'eu_reverse_charge',
        einvoiceCode: 'AE',
        standardRate: 0,
        reducedRate: 0,
        taxCountry: buyer.country,
        note: 'Reverse charge: VAT liability transfers to the recipient (Art. 196 VAT Directive).',
      };
    }

    const [standardRate, reducedRate] = EU_B2C_RATES[buyer.country] ?? [19, 7];

    return {
      taxMode: 'eu_b2c_oss',
      einvoiceCode: 'S',
      standardRate,
      reducedRate,
      taxCountry: buyer.country,
      note: 'VAT charged at the rate of the member state of consumption (OSS).',
    };
  }

  return buyer.customerType === 'business'
    ? {
        taxMode: 'third_country_b2b_no_vat',
        einvoiceCode: 'O',
        standardRate: 0,
        reducedRate: 0,
        taxCountry: buyer.country,
        note: 'Not taxable in Germany (place of supply abroad).',
      }
    : {
        taxMode: 'third_country_b2c_no_domestic_vat',
        einvoiceCode: 'O',
        standardRate: 0,
        reducedRate: 0,
        taxCountry: buyer.country,
        note: 'Not taxable in Germany (place of supply abroad).',
      };
}

export interface LineInput {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
  unitLabel?: string;
}

export interface ComputedLine extends Required<Omit<LineInput, 'unitLabel'>> {
  unitLabel?: string;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
}

export interface ComputedTotals {
  lines: ComputedLine[];
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  resolvedRate: number;
}

export function computeLines(lines: LineInput[], tax: ResolvedTax): ComputedTotals {
  const computed = lines.map((line): ComputedLine => {
    const taxCategory = line.taxCategory ?? 'standard';
    const taxRate = taxCategory === 'reduced' ? tax.reducedRate : tax.standardRate;
    const lineNet = roundMoney(line.quantity * line.unitPriceNet);
    const lineTax = roundMoney((lineNet * taxRate) / 100);

    return {
      ...line,
      taxCategory,
      taxRate,
      lineNet,
      lineTax,
      lineGross: roundMoney(lineNet + lineTax),
    };
  });
  const subtotalNet = roundMoney(computed.reduce((sum, line) => sum + line.lineNet, 0));
  const taxTotal = roundMoney(computed.reduce((sum, line) => sum + line.lineTax, 0));

  return {
    lines: computed,
    subtotalNet,
    taxTotal,
    totalGross: roundMoney(subtotalNet + taxTotal),
    resolvedRate: computed[0]?.taxRate ?? tax.standardRate,
  };
}
