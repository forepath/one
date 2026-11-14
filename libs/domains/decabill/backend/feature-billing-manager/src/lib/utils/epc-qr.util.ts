import { create as createQrCode } from 'qrcode';

/**
 * SEPA credit transfer QR code ("GiroCode") per EPC069-12 (Quick Response Code — Guidelines to Enable Data Capture
 * for the Initiation of a SEPA Credit Transfer), version 002, UTF-8, error correction level M, QR version ≤ 13.
 */
export interface EpcQrInput {
  beneficiaryName: string;
  iban: string | null | undefined;
  bic?: string | null;
  currency: string;
  amount: number | string;
  /** Unstructured remittance information (e.g. the invoice number), max 140 characters. */
  remittanceText: string;
}

const MAX_PAYLOAD_BYTES = 331;
const MAX_QR_VERSION = 13;
const MIN_AMOUNT_CENTS = 1;
const MAX_AMOUNT_CENTS = 99_999_999_999;
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const BIC_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
// eslint-disable-next-line no-control-regex
const FIELD_BREAKING_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Single-line field: line breaks / control characters would shift the fixed EPC line positions. */
function cleanField(value: string | null | undefined, maxLength: number): string {
  return (value ?? '').replace(FIELD_BREAKING_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** IBAN mod-97 check (ISO 13616). */
function isValidIban(iban: string): boolean {
  if (!IBAN_PATTERN.test(iban)) {
    return false;
  }

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;

  for (const digit of rearranged) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return remainder === 1;
}

/**
 * Builds the EPC payload, or `null` when a SEPA QR does not apply (non-EUR, no / invalid IBAN, amount outside
 * 0.01–999,999,999.99 EUR, missing beneficiary name, payload too long).
 */
export function buildEpcQrPayload(input: EpcQrInput): string | null {
  if (input.currency?.trim().toUpperCase() !== 'EUR') {
    return null;
  }

  const iban = (input.iban ?? '').replace(/\s+/g, '').toUpperCase();
  const name = cleanField(input.beneficiaryName, 70);
  const amount = Number(input.amount);
  const cents = Number.isFinite(amount) ? Math.round(amount * 100) : NaN;

  if (!name || !isValidIban(iban) || !(cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS)) {
    return null;
  }

  const bic = (input.bic ?? '').replace(/\s+/g, '').toUpperCase();
  const lines = [
    'BCD',
    '002',
    '1',
    'SCT',
    BIC_PATTERN.test(bic) ? bic : '',
    name,
    iban,
    `EUR${(cents / 100).toFixed(2)}`,
    '', // purpose
    '', // structured creditor reference (RF) — unstructured text is used instead
    cleanField(input.remittanceText, 140),
  ];
  const payload = lines.join('\n');

  return Buffer.byteLength(payload, 'utf8') <= MAX_PAYLOAD_BYTES ? payload : null;
}

/** Renders the payload as an SVG data URI (vector, so it stays sharp and PDF/A-safe); null when it does not fit. */
export function renderEpcQrSvgDataUri(payload: string): string | null {
  const qr = createQrCode(payload, { errorCorrectionLevel: 'M' });

  if (qr.version > MAX_QR_VERSION) {
    return null;
  }

  const size = qr.modules.size;
  const quietZone = 4;
  const total = size + quietZone * 2;
  let path = '';

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (qr.modules.get(row, column)) {
        path += `M${column + quietZone} ${row + quietZone}h1v1h-1z`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** EPC QR data URI for an invoice, or undefined when not applicable. */
export function buildEpcQrDataUri(input: EpcQrInput): string | undefined {
  const payload = buildEpcQrPayload(input);

  return payload ? (renderEpcQrSvgDataUri(payload) ?? undefined) : undefined;
}
