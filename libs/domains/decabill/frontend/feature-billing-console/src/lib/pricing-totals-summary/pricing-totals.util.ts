export interface PricingTaxRow {
  taxRate: number;
  taxAmount: number;
}

export interface PricingTotalsSummary {
  subtotalNet: number;
  taxRows: PricingTaxRow[];
  totalGross: number;
}

export interface PricingTotalsLeadingRow {
  label: string;
  amount: number;
  strong?: boolean;
  invalid?: boolean;
  invalidLabel?: string;
  borderBottom?: boolean;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPricingCurrencyAmount(amount: number): string {
  return `€${amount.toFixed(2)}`;
}

export function buildPricingTotalsSummary(input: {
  net: number;
  tax: number;
  taxRate: number;
  gross?: number;
}): PricingTotalsSummary | null {
  const net = Number(input.net);
  const tax = Number(input.tax);
  const taxRate = Number(input.taxRate);
  const gross = input.gross != null ? Number(input.gross) : net + tax;

  if (
    !Number.isFinite(net) ||
    net < 0 ||
    !Number.isFinite(tax) ||
    tax < 0 ||
    !Number.isFinite(gross) ||
    gross < 0 ||
    !Number.isFinite(taxRate) ||
    taxRate < 0
  ) {
    return null;
  }

  return {
    subtotalNet: roundMoney(net),
    taxRows: [{ taxRate, taxAmount: roundMoney(tax) }],
    totalGross: roundMoney(gross),
  };
}

export function aggregatePricingTotalsSummaries(
  summaries: Array<PricingTotalsSummary | null>,
): PricingTotalsSummary | null {
  if (summaries.length === 0) {
    return null;
  }

  let subtotalNet = 0;
  const taxByRate = new Map<number, number>();

  for (const summary of summaries) {
    if (!summary) {
      return null;
    }

    subtotalNet += summary.subtotalNet;

    for (const row of summary.taxRows) {
      taxByRate.set(row.taxRate, (taxByRate.get(row.taxRate) ?? 0) + row.taxAmount);
    }
  }

  const taxRows = [...taxByRate.entries()]
    .map(([taxRate, taxAmount]) => ({
      taxRate,
      taxAmount: roundMoney(taxAmount),
    }))
    .sort((a, b) => a.taxRate - b.taxRate);

  const taxTotal = taxRows.reduce((sum, row) => sum + row.taxAmount, 0);

  return {
    subtotalNet: roundMoney(subtotalNet),
    taxRows,
    totalGross: roundMoney(subtotalNet + taxTotal),
  };
}
