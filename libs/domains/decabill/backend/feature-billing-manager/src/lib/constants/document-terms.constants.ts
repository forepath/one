/**
 * Delivery terms printed on invoices / offers and embedded in the e-invoice XML.
 * The eleven Incoterms® 2020 rules plus `CUSTOM` for free-text terms (digital goods and services, where Incoterms do
 * not apply).
 */
export enum DeliveryTermsCode {
  EXW = 'EXW',
  FCA = 'FCA',
  CPT = 'CPT',
  CIP = 'CIP',
  DAP = 'DAP',
  DPU = 'DPU',
  DDP = 'DDP',
  FAS = 'FAS',
  FOB = 'FOB',
  CFR = 'CFR',
  CIF = 'CIF',
  CUSTOM = 'CUSTOM',
}

/** Incoterms® 2020 rule names, used for the printed label (`DAP – Delivered at Place, Berlin (Incoterms® 2020)`). */
export const INCOTERMS_2020_NAMES: Readonly<Record<Exclude<DeliveryTermsCode, DeliveryTermsCode.CUSTOM>, string>> = {
  [DeliveryTermsCode.EXW]: 'Ex Works',
  [DeliveryTermsCode.FCA]: 'Free Carrier',
  [DeliveryTermsCode.CPT]: 'Carriage Paid To',
  [DeliveryTermsCode.CIP]: 'Carriage and Insurance Paid To',
  [DeliveryTermsCode.DAP]: 'Delivered at Place',
  [DeliveryTermsCode.DPU]: 'Delivered at Place Unloaded',
  [DeliveryTermsCode.DDP]: 'Delivered Duty Paid',
  [DeliveryTermsCode.FAS]: 'Free Alongside Ship',
  [DeliveryTermsCode.FOB]: 'Free on Board',
  [DeliveryTermsCode.CFR]: 'Cost and Freight',
  [DeliveryTermsCode.CIF]: 'Cost, Insurance and Freight',
};

/** Named place for an Incoterms rule (e.g. "Berlin, Germany"). */
export const DELIVERY_TERMS_PLACE_MAX_LENGTH = 255;

/** Free-text delivery terms (`CUSTOM`). */
export const DELIVERY_TERMS_TEXT_MAX_LENGTH = 1000;

/** Upper bound for "payable within N days" (payment terms). */
export const PAYMENT_DUE_DAYS_MAX = 365;

/** Fallback when neither document, service plan nor `BILLING_DEFAULT_PAYMENT_DUE_DAYS` set payment terms. */
export const PAYMENT_DUE_DAYS_FALLBACK = 14;
