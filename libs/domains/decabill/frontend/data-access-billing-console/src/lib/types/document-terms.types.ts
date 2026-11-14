/** Incoterms® 2020 rules plus `CUSTOM` (free-text delivery terms for digital goods and services). */
export type DeliveryTermsCode =
  | 'EXW'
  | 'FCA'
  | 'CPT'
  | 'CIP'
  | 'DAP'
  | 'DPU'
  | 'DDP'
  | 'FAS'
  | 'FOB'
  | 'CFR'
  | 'CIF'
  | 'CUSTOM';

/** Incoterms® 2020 rules in the order of the ICC publication (any mode of transport first, then sea and inland waterway). */
export const INCOTERMS_2020_CODES: readonly Exclude<DeliveryTermsCode, 'CUSTOM'>[] = [
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
];

export const DELIVERY_TERMS_PLACE_MAX_LENGTH = 255;
export const DELIVERY_TERMS_TEXT_MAX_LENGTH = 1000;
export const PAYMENT_DUE_DAYS_MAX = 365;

/** Payment / delivery terms as stored on plans, offers and invoices (`null` = inherit, or none on legacy documents). */
export interface DocumentTerms {
  paymentDueDays: number | null;
  deliveryTermsCode: DeliveryTermsCode | null;
  deliveryTermsPlace: string | null;
  deliveryTermsText: string | null;
}

/** Terms after the cascade (document / plan → global default); payment terms are always set. */
export interface EffectiveDocumentTerms extends DocumentTerms {
  paymentDueDays: number;
}

/** Request fields; `null` inherits (plan → global default), omitted leaves partial updates unchanged. */
export interface DocumentTermsInput {
  paymentDueDays?: number | null;
  deliveryTermsCode?: DeliveryTermsCode | null;
  deliveryTermsPlace?: string | null;
  deliveryTermsText?: string | null;
}
