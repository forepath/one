import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { roundMoney } from './settlement-state.util';

/**
 * Prices a credit with the tax snapshot of the invoice it corrects: the percent rate of the invoice's largest
 * positive line (falling back to the invoice's resolved rate, else 0). Credits must follow the original
 * document's VAT treatment, not the customer's current tax context.
 */
export function creditFromInvoiceSnapshot(
  invoice: Pick<InvoiceEntity, 'resolvedTaxRate' | 'subtotalNet'>,
  lines: Array<Pick<InvoiceLineItemEntity, 'lineNet' | 'taxRate'>>,
  requestedNet: number,
): { net: number; tax: number; gross: number; taxRate: number } {
  const reference = [...lines]
    .filter((line) => Number(line.lineNet) > 0)
    .sort((a, b) => Number(b.lineNet) - Number(a.lineNet))[0];
  const taxRate = reference
    ? Number(reference.taxRate)
    : invoice.resolvedTaxRate != null
      ? Number(invoice.resolvedTaxRate)
      : 0;
  const subtotal = Number(invoice.subtotalNet);
  const invoicedNet = Number.isFinite(subtotal) ? Math.max(0, subtotal) : Number.POSITIVE_INFINITY;
  const net = roundMoney(Math.min(Math.max(0, requestedNet), invoicedNet));
  const tax = roundMoney((net * taxRate) / 100);

  return { net, tax, gross: roundMoney(net + tax), taxRate };
}
