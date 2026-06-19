import type { InvoiceEntity } from '../entities/invoice.entity';

import { buildInvoicePdfStorageKey } from './invoice-pdf-storage.util';

describe('buildInvoicePdfStorageKey', () => {
  const baseInvoice = {
    id: 'inv-1',
    userId: 'user-1',
  } as Pick<InvoiceEntity, 'id' | 'subscriptionId' | 'userId'>;

  it('stores subscription invoices under the subscription folder', () => {
    expect(buildInvoicePdfStorageKey({ ...baseInvoice, subscriptionId: 'sub-1' }, '.pdf')).toBe('sub-1/inv-1.pdf');
  });

  it('stores manual invoices without subscription under manual/user folder', () => {
    expect(buildInvoicePdfStorageKey({ ...baseInvoice, subscriptionId: undefined }, '.pdf')).toBe(
      'manual/user-1/inv-1.pdf',
    );
    expect(buildInvoicePdfStorageKey({ ...baseInvoice, subscriptionId: null as never }, '-void.pdf')).toBe(
      'manual/user-1/inv-1-void.pdf',
    );
  });
});
