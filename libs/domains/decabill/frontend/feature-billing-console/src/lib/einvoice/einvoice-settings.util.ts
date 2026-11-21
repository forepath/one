import type { BillingEinvoiceFormatOption } from '@forepath/decabill/frontend/data-access-billing-console';

/** E-invoice fields of a customer profile form (empty strings = not set). */
export interface EinvoiceSettingsFormFields {
  einvoiceFormat?: string | null;
  buyerReference?: string | null;
  einvoiceEndpoint?: string | null;
}

export const EINVOICE_BUYER_REFERENCE_MAX_LENGTH = 64;

/** Electronic address `scheme:id` (Peppol EAS code), e.g. `0088:4012345000009`; mirrors the API validation. */
export const EINVOICE_ENDPOINT_PATTERN = /^[0-9A-Z]{2,4}:[^\s]{1,128}$/;

/** XRechnung formats need a buyer reference (BT-10, Leitweg-ID for German public buyers). */
export function einvoiceFormatRequiresBuyerReference(format: string | null | undefined): boolean {
  return !!format && format.startsWith('xrechnung');
}

/** XRechnung and Peppol formats need electronic addresses (BT-34 / BT-49). */
export function einvoiceFormatRequiresEndpoint(format: string | null | undefined): boolean {
  return !!format && (format.startsWith('xrechnung') || format.startsWith('peppol'));
}

export function isEinvoiceEndpointValid(endpoint: string | null | undefined): boolean {
  const value = endpoint?.trim();

  return !value || EINVOICE_ENDPOINT_PATTERN.test(value);
}

/** Label of a format from the capabilities list (falls back to the raw value). */
export function getEinvoiceFormatLabel(
  format: string | null | undefined,
  formats: readonly BillingEinvoiceFormatOption[],
): string {
  if (!format) return '';

  return formats.find((option) => option.format === format)?.label ?? format;
}

/**
 * Normalized payload of the e-invoice fields: trimmed, empty values sent as `null` (issuer default / cleared).
 * Only keys present on the form are included, so forms without a field leave it untouched on the server.
 */
export function einvoiceSettingsPayload(form: EinvoiceSettingsFormFields): EinvoiceSettingsFormFields {
  const payload: EinvoiceSettingsFormFields = {};
  const normalize = (value: string | null | undefined): string | null => value?.trim() || null;

  if ('einvoiceFormat' in form) payload.einvoiceFormat = normalize(form.einvoiceFormat);

  if ('buyerReference' in form) payload.buyerReference = normalize(form.buyerReference);

  if ('einvoiceEndpoint' in form) payload.einvoiceEndpoint = normalize(form.einvoiceEndpoint);

  return payload;
}
