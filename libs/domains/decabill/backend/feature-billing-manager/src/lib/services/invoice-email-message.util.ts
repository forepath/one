export interface InvoiceEmailRecipient {
  firstName?: string | null;
}

export interface IssuedInvoiceEmailContentInput {
  recipient: InvoiceEmailRecipient;
  invoiceNumber: string;
  totalGross: number;
  currency: string;
  dueDate?: Date | string | null;
}

export interface VoidDocumentEmailContentInput {
  recipient: InvoiceEmailRecipient;
  invoiceNumber: string;
  creditNoteNumber: string;
}

export interface InvoiceEmailContent {
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
}

function greeting(recipient: InvoiceEmailRecipient): string {
  return recipient.firstName?.trim() || 'Customer';
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatDueDate(dueDate?: Date | string | null): string | undefined {
  if (dueDate == null || dueDate === '') {
    return undefined;
  }

  const parsed = dueDate instanceof Date ? dueDate : new Date(dueDate);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleDateString();
}

export function buildIssuedInvoiceEmailContent(input: IssuedInvoiceEmailContentInput): InvoiceEmailContent {
  const name = greeting(input.recipient);
  const dueDateLabel = formatDueDate(input.dueDate);
  const amountLabel = formatAmount(Number(input.totalGross), input.currency);
  const dueDateText = dueDateLabel ? `\nDue date: ${dueDateLabel}` : '';
  const dueDateHtml = dueDateLabel ? `<p>Due date: <strong>${dueDateLabel}</strong></p>` : '';

  return {
    subject: `Your invoice ${input.invoiceNumber} is ready`,
    text: `Dear ${name},\n\nYour invoice ${input.invoiceNumber} is now available.\n\nTotal amount: ${amountLabel}${dueDateText}\n\nThe invoice PDF is attached to this email. You can also view and download it from your billing account.\n\nBest regards,\nThe Billing Team`,
    html: `<p>Dear ${name},</p><p>Your invoice <strong>${input.invoiceNumber}</strong> is now available.</p><p>Total amount: <strong>${amountLabel}</strong></p>${dueDateHtml}<p>The invoice PDF is attached to this email. You can also view and download it from your billing account.</p><p>Best regards,<br>The Billing Team</p>`,
    attachmentFilename: `${input.invoiceNumber}.pdf`,
  };
}

export function buildVoidDocumentEmailContent(input: VoidDocumentEmailContentInput): InvoiceEmailContent {
  const name = greeting(input.recipient);

  return {
    subject: `Credit note ${input.creditNoteNumber} for invoice ${input.invoiceNumber}`,
    text: `Dear ${name},\n\nWe have voided invoice ${input.invoiceNumber}. The attached credit note ${input.creditNoteNumber} confirms the cancellation.\n\nThe original invoice PDF remains available in your billing account for your records.\n\nBest regards,\nThe Billing Team`,
    html: `<p>Dear ${name},</p><p>We have voided invoice <strong>${input.invoiceNumber}</strong>. The attached credit note <strong>${input.creditNoteNumber}</strong> confirms the cancellation.</p><p>The original invoice PDF remains available in your billing account for your records.</p><p>Best regards,<br>The Billing Team</p>`,
    attachmentFilename: `${input.creditNoteNumber}.pdf`,
  };
}

export interface PartialCreditDocumentEmailContentInput {
  recipient: InvoiceEmailRecipient;
  invoiceNumber: string;
  creditNoteNumber: string;
  creditGross: number;
  currency: string;
}

export function buildPartialCreditDocumentEmailContent(
  input: PartialCreditDocumentEmailContentInput,
): InvoiceEmailContent {
  const name = greeting(input.recipient);
  const amountLabel = formatAmount(input.creditGross, input.currency);

  return {
    subject: `Credit note ${input.creditNoteNumber} for invoice ${input.invoiceNumber}`,
    text: `Dear ${name},\n\nFollowing your statutory withdrawal, we issued credit note ${input.creditNoteNumber} for ${amountLabel} regarding invoice ${input.invoiceNumber}.\n\nThe credit note is attached for your records.\n\nBest regards,\nThe Billing Team`,
    html: `<p>Dear ${name},</p><p>Following your statutory withdrawal, we issued credit note <strong>${input.creditNoteNumber}</strong> for <strong>${amountLabel}</strong> regarding invoice <strong>${input.invoiceNumber}</strong>.</p><p>The credit note is attached for your records.</p><p>Best regards,<br>The Billing Team</p>`,
    attachmentFilename: `${input.creditNoteNumber}.pdf`,
  };
}
