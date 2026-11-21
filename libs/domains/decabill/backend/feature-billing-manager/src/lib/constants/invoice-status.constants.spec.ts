import {
  CUSTOMER_VISIBLE_INVOICE_STATUSES,
  HISTORY_INVOICE_STATUSES,
  InvoiceStatus,
  OPEN_OVERDUE_INVOICE_STATUSES,
} from './invoice-status.constants';

describe('invoice-status.constants', () => {
  it('keeps open/overdue and history disjoint and excludes draft from customer lists', () => {
    expect(new Set(CUSTOMER_VISIBLE_INVOICE_STATUSES).size).toBe(CUSTOMER_VISIBLE_INVOICE_STATUSES.length);
    expect(CUSTOMER_VISIBLE_INVOICE_STATUSES).not.toContain(InvoiceStatus.DRAFT);
    expect(CUSTOMER_VISIBLE_INVOICE_STATUSES).toEqual([...OPEN_OVERDUE_INVOICE_STATUSES, ...HISTORY_INVOICE_STATUSES]);
    expect(
      Object.values(InvoiceStatus).filter((status) => !CUSTOMER_VISIBLE_INVOICE_STATUSES.includes(status)),
    ).toEqual([InvoiceStatus.DRAFT]);
  });

  it('defines history as settled (paid, credited, written off) and void', () => {
    expect(HISTORY_INVOICE_STATUSES).toEqual([
      InvoiceStatus.PAID,
      InvoiceStatus.CREDITED,
      InvoiceStatus.WRITTEN_OFF,
      InvoiceStatus.VOID,
    ]);
  });
});
