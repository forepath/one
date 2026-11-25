/**
 * How a finalized customer document (invoice, credit note, offer) reached the customer. Stored next to its `sent_at`
 * timestamp: `email` (emailed with the PDF attached), `letter` (handed to the postal provider as a physical letter) or
 * `manual` (sent outside Decabill and marked as sent by an admin).
 */
export enum DocumentDeliveryChannel {
  EMAIL = 'email',
  LETTER = 'letter',
  MANUAL = 'manual',
}

export const DOCUMENT_DELIVERY_CHANNELS = Object.values(DocumentDeliveryChannel);

/** Customer documents that can be delivered (and are tracked per delivery). */
export enum DeliverableDocumentType {
  INVOICE = 'invoice',
  CREDIT_NOTE = 'credit_note',
  OFFER = 'offer',
}

export const DELIVERABLE_DOCUMENT_TYPES = Object.values(DeliverableDocumentType);

/**
 * How a customer prefers to receive documents (customer profile). `email` (default): documents are emailed.
 * `letter`: documents are emailed and additionally posted as a letter, while the tenant has a postal provider.
 */
export const CUSTOMER_DELIVERY_PREFERENCES = [DocumentDeliveryChannel.EMAIL, DocumentDeliveryChannel.LETTER] as const;

export type CustomerDeliveryPreference = (typeof CUSTOMER_DELIVERY_PREFERENCES)[number];
