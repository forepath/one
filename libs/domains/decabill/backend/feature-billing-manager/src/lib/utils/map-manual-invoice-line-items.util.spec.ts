import { TaxCategory } from '../constants/tax-category.constants';

import { mapManualInvoiceLineItemsToInputs } from './map-manual-invoice-line-items.util';

describe('mapManualInvoiceLineItemsToInputs', () => {
  it('maps line items with default tax category', () => {
    expect(mapManualInvoiceLineItemsToInputs([{ description: 'Setup fee', quantity: 1, unitPriceNet: 50 }])).toEqual([
      {
        description: 'Setup fee',
        quantity: 1,
        unitPriceNet: 50,
        taxCategory: TaxCategory.STANDARD,
      },
    ]);
  });

  it('preserves explicit tax category', () => {
    expect(
      mapManualInvoiceLineItemsToInputs([
        { description: 'Books', quantity: 2, unitPriceNet: 10, taxCategory: TaxCategory.REDUCED },
      ]),
    ).toEqual([
      {
        description: 'Books',
        quantity: 2,
        unitPriceNet: 10,
        taxCategory: TaxCategory.REDUCED,
      },
    ]);
  });
});
