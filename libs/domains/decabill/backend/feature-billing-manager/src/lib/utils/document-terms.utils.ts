import { BadRequestException } from '@nestjs/common';

import {
  DELIVERY_TERMS_PLACE_MAX_LENGTH,
  DELIVERY_TERMS_TEXT_MAX_LENGTH,
  DeliveryTermsCode,
  INCOTERMS_2020_NAMES,
  PAYMENT_DUE_DAYS_MAX,
} from '../constants/document-terms.constants';

/** Persisted document-terms columns (service plans, offers, invoices). `null` means "inherit". */
export interface DocumentTermsFields {
  paymentDueDays?: number | null;
  deliveryTermsCode?: DeliveryTermsCode | string | null;
  deliveryTermsPlace?: string | null;
  deliveryTermsText?: string | null;
}

/** Columns written by the API (normalized; code is always a known value or null). */
export interface DocumentTermsColumns {
  paymentDueDays: number | null;
  deliveryTermsCode: DeliveryTermsCode | null;
  deliveryTermsPlace: string | null;
  deliveryTermsText: string | null;
}

export interface DeliveryTerms {
  code: DeliveryTermsCode;
  /** Named place for Incoterms rules; always null for `CUSTOM`. */
  place: string | null;
  /** Free text for `CUSTOM`; always null for Incoterms rules. */
  text: string | null;
}

/** One layer of the terms cascade (document → service plan → global default). `null`/`undefined` inherit. */
export interface DocumentTermsLayer {
  paymentDueDays?: number | null;
  deliveryTerms?: DeliveryTerms | null;
}

export interface ResolvedDocumentTerms {
  paymentDueDays: number;
  deliveryTerms: DeliveryTerms | null;
}

const DELIVERY_TERMS_CODES = new Set<string>(Object.values(DeliveryTermsCode));

/** C0/C1 control characters except tab and line feed — they are invalid in XML 1.0 or break the PDF layout. */
// eslint-disable-next-line no-control-regex
const MULTILINE_CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const SINGLE_LINE_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function isDeliveryTermsCode(value: unknown): value is DeliveryTermsCode {
  return typeof value === 'string' && DELIVERY_TERMS_CODES.has(value);
}

/** Single-line value (named place): control characters become spaces, whitespace is collapsed. */
export function sanitizeSingleLineTermsValue(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) {
    return null;
  }

  const cleaned = value.replace(SINGLE_LINE_CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();

  return cleaned ? cleaned.slice(0, maxLength) : null;
}

/** Multi-line value (custom delivery terms): keeps line breaks, drops other control characters. */
export function sanitizeMultiLineTermsValue(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) {
    return null;
  }

  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .replace(MULTILINE_CONTROL_CHARS, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned ? cleaned.slice(0, maxLength) : null;
}

/**
 * Validates and normalizes delivery-terms input from an API DTO.
 * - `code` null/undefined/empty → null (inherit)
 * - Incoterms rule → optional named place, text dropped
 * - `CUSTOM` → text required, place dropped
 */
export function normalizeDeliveryTermsInput(input: {
  deliveryTermsCode?: DeliveryTermsCode | string | null;
  deliveryTermsPlace?: string | null;
  deliveryTermsText?: string | null;
}): DeliveryTerms | null {
  const code = input.deliveryTermsCode;

  if (code == null || code === '') {
    return null;
  }

  if (!isDeliveryTermsCode(code)) {
    throw new BadRequestException(`deliveryTermsCode must be one of ${[...DELIVERY_TERMS_CODES].join(', ')}`);
  }

  if (code === DeliveryTermsCode.CUSTOM) {
    const text = sanitizeMultiLineTermsValue(input.deliveryTermsText, DELIVERY_TERMS_TEXT_MAX_LENGTH);

    if (!text) {
      throw new BadRequestException('deliveryTermsText is required when deliveryTermsCode is CUSTOM');
    }

    return { code, place: null, text };
  }

  return {
    code,
    place: sanitizeSingleLineTermsValue(input.deliveryTermsPlace, DELIVERY_TERMS_PLACE_MAX_LENGTH),
    text: null,
  };
}

/** True when a partial update touches any delivery-terms field. */
export function hasDeliveryTermsInput(input: {
  deliveryTermsCode?: unknown;
  deliveryTermsPlace?: unknown;
  deliveryTermsText?: unknown;
}): boolean {
  return (
    input.deliveryTermsCode !== undefined ||
    input.deliveryTermsPlace !== undefined ||
    input.deliveryTermsText !== undefined
  );
}

/** Validates payment due days from an API DTO (class-validator already bounds them; this guards internal callers). */
export function normalizePaymentDueDaysInput(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0 || value > PAYMENT_DUE_DAYS_MAX) {
    throw new BadRequestException(`paymentDueDays must be an integer between 0 and ${PAYMENT_DUE_DAYS_MAX}`);
  }

  return value;
}

/** Maps normalized delivery terms to the persisted columns (null clears all three). */
export function toDeliveryTermsColumns(
  terms: DeliveryTerms | null,
): Pick<DocumentTermsColumns, 'deliveryTermsCode' | 'deliveryTermsPlace' | 'deliveryTermsText'> {
  return {
    deliveryTermsCode: terms?.code ?? null,
    deliveryTermsPlace: terms?.place ?? null,
    deliveryTermsText: terms?.text ?? null,
  };
}

/** Reads delivery terms from persisted columns; unknown codes or an empty custom text are treated as unset. */
export function deliveryTermsFromColumns(fields: DocumentTermsFields | null | undefined): DeliveryTerms | null {
  if (!fields || !isDeliveryTermsCode(fields.deliveryTermsCode)) {
    return null;
  }

  if (fields.deliveryTermsCode === DeliveryTermsCode.CUSTOM) {
    const text = sanitizeMultiLineTermsValue(fields.deliveryTermsText, DELIVERY_TERMS_TEXT_MAX_LENGTH);

    return text ? { code: DeliveryTermsCode.CUSTOM, place: null, text } : null;
  }

  return {
    code: fields.deliveryTermsCode,
    place: sanitizeSingleLineTermsValue(fields.deliveryTermsPlace, DELIVERY_TERMS_PLACE_MAX_LENGTH),
    text: null,
  };
}

/** Builds a cascade layer from persisted columns (plan / offer / invoice). */
export function documentTermsLayerFromFields(fields: DocumentTermsFields | null | undefined): DocumentTermsLayer {
  const paymentDueDays = fields?.paymentDueDays;

  return {
    paymentDueDays: paymentDueDays != null && Number.isInteger(Number(paymentDueDays)) ? Number(paymentDueDays) : null,
    deliveryTerms: deliveryTermsFromColumns(fields),
  };
}

/**
 * Resolves payment and delivery terms independently: the first layer that sets a value wins, otherwise the fallback
 * (global default) applies.
 */
export function resolveDocumentTerms(
  layers: ReadonlyArray<DocumentTermsLayer | null | undefined>,
  fallback: ResolvedDocumentTerms,
): ResolvedDocumentTerms {
  const paymentDueDays = layers.find((layer) => layer?.paymentDueDays != null)?.paymentDueDays;
  const deliveryTerms = layers.find((layer) => layer?.deliveryTerms != null)?.deliveryTerms;

  return {
    paymentDueDays: paymentDueDays ?? fallback.paymentDueDays,
    deliveryTerms: deliveryTerms ?? fallback.deliveryTerms,
  };
}

/** Columns frozen onto an issued invoice / archived offer. */
export function toDocumentTermsColumns(terms: ResolvedDocumentTerms): DocumentTermsColumns {
  return {
    paymentDueDays: terms.paymentDueDays,
    ...toDeliveryTermsColumns(terms.deliveryTerms),
  };
}

/** Printed delivery terms, e.g. `DAP – Delivered at Place, Berlin (Incoterms® 2020)` or the custom text. */
export function formatDeliveryTerms(terms: DeliveryTerms | null | undefined): string | undefined {
  if (!terms) {
    return undefined;
  }

  if (terms.code === DeliveryTermsCode.CUSTOM) {
    return terms.text ?? undefined;
  }

  const place = terms.place ? `, ${terms.place}` : '';

  return `${terms.code} – ${INCOTERMS_2020_NAMES[terms.code]}${place} (Incoterms® 2020)`;
}

/** Printed payment terms; the period runs from the invoice date (as the due date is computed on issue). */
export function formatPaymentTerms(paymentDueDays: number | null | undefined): string | undefined {
  if (paymentDueDays == null) {
    return undefined;
  }

  if (paymentDueDays === 0) {
    return 'Payable immediately without deduction.';
  }

  const unit = paymentDueDays === 1 ? 'day' : 'days';

  return `Payable within ${paymentDueDays} ${unit} of the invoice date without deduction.`;
}
