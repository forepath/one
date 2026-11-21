import { isValidRfReference, mod97 } from '../accounting/bank-import/bank-parse.utils';

/**
 * ISO 11649 structured creditor reference for an invoice: `RF` + 2 check digits + the alphanumeric invoice number
 * plus as many characters of the invoice id as fit (at least 4; tenants that number independently share invoice
 * numbers, and all invoices share one creditor, so the reference must be unique across tenants). Max. 25 characters.
 * `variant` shifts the id window for the rare case that the first choice is already taken.
 */
export function buildInvoicePaymentReference(invoiceNumber: string, invoiceId: string, variant = 0): string {
  const number = invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const id = invoiceId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const extraChars = Math.max(4, 21 - number.length);
  const start = Math.min(variant * extraChars, Math.max(0, id.length - extraChars));
  const suffix = id.slice(start, start + extraChars);
  const body = `${number}${suffix}`.slice(-21);
  const check = 98 - mod97(`${body}RF00`);

  return `RF${String(check).padStart(2, '0')}${body}`;
}

/** Groups an RF reference in blocks of four for printing (`RF18 5390 0754 7034`). */
export function formatPaymentReference(reference: string): string {
  return reference.replace(/(.{4})(?=.)/g, '$1 ');
}

export { isValidRfReference };
