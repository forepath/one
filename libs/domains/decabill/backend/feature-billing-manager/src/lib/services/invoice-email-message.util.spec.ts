import { buildIssuedInvoiceEmailContent, buildVoidDocumentEmailContent } from './invoice-email-message.util';

describe('invoice-email-message.util', () => {
  it('builds issued invoice email content with due date', () => {
    const content = buildIssuedInvoiceEmailContent({
      recipient: { firstName: 'Jane' },
      invoiceNumber: 'INV-2026-00001',
      totalGross: 119,
      currency: 'EUR',
      dueDate: new Date('2026-06-15T00:00:00Z'),
    });

    expect(content.subject).toBe('Your invoice INV-2026-00001 is ready');
    expect(content.attachmentFilename).toBe('INV-2026-00001.pdf');
    expect(content.text).toContain('Dear Jane,');
    expect(content.text).toContain('Total amount: 119.00 EUR');
    expect(content.text).toContain('Due date:');
    expect(content.html).toContain('<strong>INV-2026-00001</strong>');
    expect(content.text).toContain('Best regards,\nThe Billing Team');
  });

  it('formats due date when provided as an ISO string from persistence', () => {
    const content = buildIssuedInvoiceEmailContent({
      recipient: { firstName: 'Jane' },
      invoiceNumber: 'INV-2026-00003',
      totalGross: 119,
      currency: 'EUR',
      dueDate: '2026-06-15T00:00:00.000Z',
    });

    expect(content.text).toContain('Due date:');
  });

  it('uses Customer greeting when first name is missing', () => {
    const content = buildIssuedInvoiceEmailContent({
      recipient: {},
      invoiceNumber: 'INV-2026-00002',
      totalGross: 50,
      currency: 'EUR',
    });

    expect(content.text).toContain('Dear Customer,');
    expect(content.text).not.toContain('Due date:');
  });

  it('builds void document email content', () => {
    const content = buildVoidDocumentEmailContent({
      recipient: { firstName: 'Alex' },
      invoiceNumber: 'INV-2026-00001',
      creditNoteNumber: 'INV-2026-00001-CN',
    });

    expect(content.subject).toBe('Credit note INV-2026-00001-CN for invoice INV-2026-00001');
    expect(content.attachmentFilename).toBe('INV-2026-00001-CN.pdf');
    expect(content.text).toContain('Dear Alex,');
    expect(content.text).toContain('voided invoice INV-2026-00001');
    expect(content.text).toContain('credit note INV-2026-00001-CN');
    expect(content.html).toContain('Best regards,<br>The Billing Team');
  });
});
