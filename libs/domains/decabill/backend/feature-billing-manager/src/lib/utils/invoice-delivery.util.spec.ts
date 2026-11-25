import { DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';

import { invoiceDeliveryFields } from './invoice-delivery.util';

describe('invoiceDeliveryFields', () => {
  const base = { invoiceNumber: 'INV-2026-00001', sentAt: null, voidDocumentSentAt: null };

  it('offers send for numbered, non-void invoices that were not emailed', () => {
    for (const status of [
      InvoiceStatus.ISSUED,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.PAID,
      InvoiceStatus.PARTIALLY_PAID,
    ]) {
      expect(invoiceDeliveryFields({ ...base, status })).toEqual({
        sentAt: null,
        sentVia: null,
        voidDocumentSentAt: null,
        voidDocumentSentVia: null,
        canSend: true,
        canSendCreditNote: false,
      });
    }
  });

  it('never offers send for drafts, unnumbered or already sent invoices', () => {
    expect(invoiceDeliveryFields({ ...base, status: InvoiceStatus.DRAFT, invoiceNumber: undefined }).canSend).toBe(
      false,
    );
    expect(invoiceDeliveryFields({ ...base, status: InvoiceStatus.ISSUED, invoiceNumber: undefined }).canSend).toBe(
      false,
    );

    const sent = invoiceDeliveryFields({
      ...base,
      status: InvoiceStatus.ISSUED,
      sentAt: new Date('2026-11-21T10:00:00Z'),
    });

    expect(sent).toEqual(
      expect.objectContaining({ canSend: false, sentAt: '2026-11-21T10:00:00.000Z', sentVia: 'email' }),
    );
  });

  it('reports the channel a document was sent on (legacy sends without a channel count as email)', () => {
    const at = new Date('2026-11-21T10:00:00Z');

    expect(
      invoiceDeliveryFields({
        ...base,
        status: InvoiceStatus.ISSUED,
        sentAt: at,
        sentVia: DocumentDeliveryChannel.LETTER,
      }).sentVia,
    ).toBe('letter');
    expect(
      invoiceDeliveryFields({
        ...base,
        status: InvoiceStatus.VOID,
        voidDocumentSentAt: at,
        voidDocumentSentVia: DocumentDeliveryChannel.MANUAL,
      }).voidDocumentSentVia,
    ).toBe('manual');
  });

  it('offers the credit note send only for voided invoices whose credit note was not emailed', () => {
    expect(invoiceDeliveryFields({ ...base, status: InvoiceStatus.VOID })).toEqual(
      expect.objectContaining({ canSend: false, canSendCreditNote: true }),
    );
    expect(
      invoiceDeliveryFields({ ...base, status: InvoiceStatus.VOID, voidDocumentSentAt: new Date('2026-11-21') })
        .canSendCreditNote,
    ).toBe(false);
  });
});
