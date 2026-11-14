import {
  DELIVERY_TERMS_PLACE_MAX_LENGTH,
  DELIVERY_TERMS_TEXT_MAX_LENGTH,
  INCOTERMS_2020_CODES,
  PAYMENT_DUE_DAYS_MAX,
  type DeliveryTermsCode,
  type DocumentTerms,
  type DocumentTermsInput,
} from '@forepath/decabill/frontend/data-access-billing-console';

/**
 * Template-driven form model for payment / delivery terms. Empty strings mean "inherit"
 * (service plan → global default); they are sent as `null`.
 */
export interface DocumentTermsFormModel {
  paymentDueDays: string | number | null;
  deliveryTermsCode: DeliveryTermsCode | '';
  deliveryTermsPlace: string;
  deliveryTermsText: string;
}

export interface DeliveryTermsOption {
  value: DeliveryTermsCode;
  label: string;
}

export function getIncotermName(code: Exclude<DeliveryTermsCode, 'CUSTOM'>): string {
  switch (code) {
    case 'EXW':
      return $localize`:@@featureDocumentTerms-incotermExw:Ex Works`;
    case 'FCA':
      return $localize`:@@featureDocumentTerms-incotermFca:Free Carrier`;
    case 'CPT':
      return $localize`:@@featureDocumentTerms-incotermCpt:Carriage Paid To`;
    case 'CIP':
      return $localize`:@@featureDocumentTerms-incotermCip:Carriage and Insurance Paid To`;
    case 'DAP':
      return $localize`:@@featureDocumentTerms-incotermDap:Delivered at Place`;
    case 'DPU':
      return $localize`:@@featureDocumentTerms-incotermDpu:Delivered at Place Unloaded`;
    case 'DDP':
      return $localize`:@@featureDocumentTerms-incotermDdp:Delivered Duty Paid`;
    case 'FAS':
      return $localize`:@@featureDocumentTerms-incotermFas:Free Alongside Ship`;
    case 'FOB':
      return $localize`:@@featureDocumentTerms-incotermFob:Free on Board`;
    case 'CFR':
      return $localize`:@@featureDocumentTerms-incotermCfr:Cost and Freight`;
    case 'CIF':
      return $localize`:@@featureDocumentTerms-incotermCif:Cost, Insurance and Freight`;
  }
}

/** Incoterms® 2020 rules followed by the manual (free-text) option. */
export function getDeliveryTermsOptions(): DeliveryTermsOption[] {
  return [
    ...INCOTERMS_2020_CODES.map((code) => ({ value: code, label: `${code} – ${getIncotermName(code)}` })),
    { value: 'CUSTOM', label: $localize`:@@featureDocumentTerms-customOption:Manual (free text)` },
  ];
}

export function isIncotermCode(
  code: DeliveryTermsCode | '' | null | undefined,
): code is Exclude<DeliveryTermsCode, 'CUSTOM'> {
  return code != null && code !== '' && code !== 'CUSTOM';
}

/** "Payable within 14 days of the invoice date" / "Payable immediately"; undefined when unset. */
export function formatPaymentTermsLabel(paymentDueDays: number | null | undefined): string | undefined {
  if (paymentDueDays == null) {
    return undefined;
  }

  if (paymentDueDays === 0) {
    return $localize`:@@featureDocumentTerms-payableImmediately:Payable immediately`;
  }

  if (paymentDueDays === 1) {
    return $localize`:@@featureDocumentTerms-payableWithinOneDay:Payable within 1 day of the invoice date`;
  }

  return $localize`:@@featureDocumentTerms-payableWithinDays:Payable within ${paymentDueDays}:days: days of the invoice date`;
}

/** "DAP – Delivered at Place, Berlin (Incoterms® 2020)" or the custom text; undefined when unset. */
export function formatDeliveryTermsLabel(
  terms: Pick<DocumentTerms, 'deliveryTermsCode' | 'deliveryTermsPlace' | 'deliveryTermsText'> | null | undefined,
): string | undefined {
  const code = terms?.deliveryTermsCode;

  if (!code) {
    return undefined;
  }

  if (code === 'CUSTOM') {
    return terms?.deliveryTermsText?.trim() || undefined;
  }

  if (!INCOTERMS_2020_CODES.includes(code)) {
    return undefined;
  }

  const place = terms?.deliveryTermsPlace?.trim();
  const rule = `${code} – ${getIncotermName(code)}${place ? `, ${place}` : ''}`;

  return $localize`:@@featureDocumentTerms-incotermsLabel:${rule}:rule: (Incoterms® 2020)`;
}

export function emptyDocumentTermsForm(): DocumentTermsFormModel {
  return { paymentDueDays: '', deliveryTermsCode: '', deliveryTermsPlace: '', deliveryTermsText: '' };
}

export function documentTermsFormFromTerms(terms: Partial<DocumentTerms> | null | undefined): DocumentTermsFormModel {
  const code = terms?.deliveryTermsCode ?? '';

  return {
    paymentDueDays: terms?.paymentDueDays ?? '',
    deliveryTermsCode: code,
    deliveryTermsPlace: isIncotermCode(code) ? (terms?.deliveryTermsPlace ?? '') : '',
    deliveryTermsText: code === 'CUSTOM' ? (terms?.deliveryTermsText ?? '') : '',
  };
}

/** Parses the payment-days field; `null` = inherit, `NaN` = invalid. */
export function parsePaymentDueDays(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') {
    return null;
  }

  const value = String(raw).trim();

  if (!/^\d+$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);

  return parsed > PAYMENT_DUE_DAYS_MAX ? Number.NaN : parsed;
}

/** Request payload: every field is sent (`null` clears an override / inherits). */
export function documentTermsFormToInput(form: DocumentTermsFormModel): Required<DocumentTermsInput> {
  const code = form.deliveryTermsCode || null;
  const paymentDueDays = parsePaymentDueDays(form.paymentDueDays);

  return {
    paymentDueDays: paymentDueDays == null || Number.isNaN(paymentDueDays) ? null : paymentDueDays,
    deliveryTermsCode: code,
    deliveryTermsPlace: isIncotermCode(code) ? form.deliveryTermsPlace.trim() || null : null,
    deliveryTermsText: code === 'CUSTOM' ? form.deliveryTermsText.trim() || null : null,
  };
}

export function getPaymentDueDaysError(form: DocumentTermsFormModel): string | null {
  return Number.isNaN(parsePaymentDueDays(form.paymentDueDays))
    ? $localize`:@@featureDocumentTerms-paymentDueDaysInvalid:Use 0–${PAYMENT_DUE_DAYS_MAX}:max: days.`
    : null;
}

export function getDeliveryTermsTextError(form: DocumentTermsFormModel): string | null {
  if (form.deliveryTermsCode !== 'CUSTOM') {
    return null;
  }

  const text = form.deliveryTermsText.trim();

  if (!text) {
    return $localize`:@@featureDocumentTerms-customTextRequired:Enter the delivery terms.`;
  }

  return text.length > DELIVERY_TERMS_TEXT_MAX_LENGTH
    ? $localize`:@@featureDocumentTerms-customTextTooLong:Use at most ${DELIVERY_TERMS_TEXT_MAX_LENGTH}:max: characters.`
    : null;
}

export function getDeliveryTermsPlaceError(form: DocumentTermsFormModel): string | null {
  return isIncotermCode(form.deliveryTermsCode) &&
    form.deliveryTermsPlace.trim().length > DELIVERY_TERMS_PLACE_MAX_LENGTH
    ? $localize`:@@featureDocumentTerms-placeTooLong:Use at most ${DELIVERY_TERMS_PLACE_MAX_LENGTH}:max: characters.`
    : null;
}

export function isDocumentTermsFormValid(form: DocumentTermsFormModel, includePaymentTerms = true): boolean {
  return (
    (!includePaymentTerms || getPaymentDueDaysError(form) == null) &&
    getDeliveryTermsTextError(form) == null &&
    getDeliveryTermsPlaceError(form) == null
  );
}
