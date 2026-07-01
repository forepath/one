import { TaxCategory } from '../constants/tax-category.constants';
import type { ManualInvoiceLineItemDto } from '../dto/manual-invoice.dto';
import type { LineItemInput } from '../services/tax-calculation.service';

export function mapManualInvoiceLineItemsToInputs(items: ManualInvoiceLineItemDto[]): LineItemInput[] {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceNet: item.unitPriceNet,
    taxCategory: item.taxCategory ?? TaxCategory.STANDARD,
  }));
}
