import { isValidRfReference } from '../accounting/bank-import/bank-parse.utils';

import { buildInvoicePaymentReference, formatPaymentReference } from './payment-reference.util';

describe('payment reference (ISO 11649)', () => {
  it('builds a check-digit-valid RF reference from the invoice number and id', () => {
    const ref = buildInvoicePaymentReference('INV-2026-00042', '3f2a9c10-aaaa-bbbb-cccc-000000000000');

    // 12 characters of number leave 9 of the id (all 21 body characters used).
    expect(ref).toMatch(/^RF\d{2}INV2026000423F2A9C10A$/);
    expect(isValidRfReference(ref)).toBe(true);
    expect(ref.length).toBeLessThanOrEqual(25);
  });

  it('differs for equal invoice numbers of different tenants', () => {
    expect(buildInvoicePaymentReference('INV-2026-00001', 'aaaa1111-0000-0000-0000-000000000000')).not.toBe(
      buildInvoicePaymentReference('INV-2026-00001', 'bbbb2222-0000-0000-0000-000000000000'),
    );
  });

  it('uses at least 4 id characters for long numbers and offers alternative id windows', () => {
    const id = '3f2a9c10-aaaa-bbbb-cccc-000000000001';
    const long = buildInvoicePaymentReference('ACME-TENANT-INVOICE-2026-000042', id);

    expect(long).toHaveLength(25);
    expect(long.endsWith('3F2A')).toBe(true);
    expect(isValidRfReference(long)).toBe(true);

    const first = buildInvoicePaymentReference('INV-2026-00042', id, 0);
    const second = buildInvoicePaymentReference('INV-2026-00042', id, 1);

    expect(second).not.toBe(first);
    expect(isValidRfReference(second)).toBe(true);
  });

  it('groups for printing', () => {
    expect(formatPaymentReference('RF18539007547034')).toBe('RF18 5390 0754 7034');
  });
});
