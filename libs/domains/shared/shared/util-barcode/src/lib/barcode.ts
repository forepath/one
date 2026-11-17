/**
 * Dependency-free barcode helpers: GTIN (EAN-8 / UPC-A / EAN-13 / GTIN-14) validation and module encoding for
 * EAN-8, EAN-13 (UPC-A as EAN-13 with a leading zero) and Code 128. The same geometry renders as an SVG string
 * (server-side documents) or as bars a template draws (frontend; no `innerHTML`, so nothing to sanitize).
 */

/** Supported symbologies. */
export type BarcodeSymbology = 'ean13' | 'ean8' | 'upca' | 'code128';

export interface BarcodeBar {
  /** Left edge in modules (quiet zone included). */
  x: number;
  /** Width in modules. */
  width: number;
  /** Guard bars of EAN / UPC extend below the digits. */
  guard: boolean;
}

export interface BarcodeGeometry {
  symbology: BarcodeSymbology;
  /** Total width in modules (quiet zones included). */
  modules: number;
  bars: BarcodeBar[];
  /** Human-readable text printed below the bars. */
  text: string;
}

const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** Strips spaces and dashes a person typically enters into a GTIN / EAN. */
export function normalizeGtin(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\s-]/g, '');
}

/** GS1 mod-10 check digit for the digits before the check digit. */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) {
    throw new Error('GTIN body must consist of digits');
  }

  let sum = 0;

  // Rightmost body digit weighs 3, then alternating 1 / 3 to the left.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;

    sum += digit * (i % 2 === 0 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10;
}

/** True for a GTIN-8 / GTIN-12 (UPC-A) / GTIN-13 (EAN) / GTIN-14 with a valid check digit. */
export function isValidGtin(raw: string | null | undefined): boolean {
  const code = normalizeGtin(raw);

  if (!/^\d+$/.test(code) || !(GTIN_LENGTHS as readonly number[]).includes(code.length)) {
    return false;
  }

  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
/** Parity of the six left digits of an EAN-13, selected by the first (implicit) digit. */
const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

interface ModuleRun {
  bits: string;
  guard: boolean;
}

function digitsOf(code: string): number[] {
  return code.split('').map((char) => char.charCodeAt(0) - 48);
}

function encodeEan13Runs(code: string): ModuleRun[] {
  const digits = digitsOf(code);
  const parity = EAN13_PARITY[digits[0]!]!;
  const left = digits
    .slice(1, 7)
    .map((digit, index) => (parity[index] === 'L' ? EAN_L[digit] : EAN_G[digit]))
    .join('');
  const right = digits
    .slice(7)
    .map((digit) => EAN_R[digit])
    .join('');

  return [
    { bits: '101', guard: true },
    { bits: left, guard: false },
    { bits: '01010', guard: true },
    { bits: right, guard: false },
    { bits: '101', guard: true },
  ];
}

function encodeEan8Runs(code: string): ModuleRun[] {
  const digits = digitsOf(code);

  return [
    { bits: '101', guard: true },
    {
      bits: digits
        .slice(0, 4)
        .map((digit) => EAN_L[digit])
        .join(''),
      guard: false,
    },
    { bits: '01010', guard: true },
    {
      bits: digits
        .slice(4)
        .map((digit) => EAN_R[digit])
        .join(''),
      guard: false,
    },
    { bits: '101', guard: true },
  ];
}

/** Code 128 bar / space widths per symbol value (0–105: 6 elements of 11 modules; 106: stop, 13 modules). */
export const CODE128_PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = 106;

/** True when every character is printable ASCII (Code 128 subset B). */
export function isCode128Encodable(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

/** Symbol values (start, data, checksum, stop) for `text`: subset C for even-length digit strings, else B. */
export function code128Values(text: string): number[] {
  if (!isCode128Encodable(text)) {
    throw new Error('Code 128 supports printable ASCII only');
  }

  const useC = /^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4;
  const data: number[] = [];

  if (useC) {
    for (let i = 0; i < text.length; i += 2) {
      data.push(Number(text.slice(i, i + 2)));
    }
  } else {
    for (const char of text) {
      data.push(char.charCodeAt(0) - 32);
    }
  }

  const start = useC ? CODE128_START_C : CODE128_START_B;
  const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), start) % 103;

  return [start, ...data, checksum, CODE128_STOP];
}

function widthsToBits(widths: string): string {
  let bits = '';

  for (let i = 0; i < widths.length; i++) {
    bits += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  }

  return bits;
}

function runsToGeometry(symbology: BarcodeSymbology, runs: ModuleRun[], quiet: number, text: string): BarcodeGeometry {
  const bars: BarcodeBar[] = [];
  let x = quiet;

  for (const run of runs) {
    let index = 0;

    while (index < run.bits.length) {
      if (run.bits[index] !== '1') {
        index++;
        continue;
      }

      let end = index;

      while (end < run.bits.length && run.bits[end] === '1') {
        end++;
      }

      bars.push({ x: x + index, width: end - index, guard: run.guard });
      index = end;
    }

    x += run.bits.length;
  }

  return { symbology, modules: x + quiet, bars, text };
}

/**
 * Geometry of a GTIN: EAN-13, UPC-A (rendered as EAN-13 with a leading zero, printed as 12 digits), EAN-8. A GTIN-14
 * has no EAN form and is drawn as Code 128. Throws for an invalid GTIN.
 */
export function gtinBarcodeGeometry(raw: string): BarcodeGeometry {
  const code = normalizeGtin(raw);

  if (!isValidGtin(code)) {
    throw new Error('Invalid GTIN');
  }

  switch (code.length) {
    case 8:
      return runsToGeometry('ean8', encodeEan8Runs(code), 7, code);
    case 12:
      return runsToGeometry('upca', encodeEan13Runs(`0${code}`), 9, code);
    case 13:
      return runsToGeometry('ean13', encodeEan13Runs(code), 11, code);
    default:
      return code128Geometry(code);
  }
}

/** Geometry of a Code 128 symbol (internal identifiers such as article numbers). */
export function code128Geometry(text: string): BarcodeGeometry {
  const bits = code128Values(text)
    .map((value) => widthsToBits(CODE128_PATTERNS[value]!))
    .join('');

  return runsToGeometry('code128', [{ bits, guard: false }], 10, text);
}

export interface BarcodeSvgOptions {
  /** Width of one module in px (default 2). */
  moduleWidth?: number;
  /** Bar height in px, text excluded (default 60). */
  height?: number;
  /** Print the human-readable text below the bars (default true). */
  showText?: boolean;
  /** Accessible label (default: symbology + text). */
  label?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Renders barcode geometry as a standalone SVG string (black bars on white). */
export function renderBarcodeSvg(geometry: BarcodeGeometry, options: BarcodeSvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 60;
  const showText = options.showText ?? true;
  const textSize = Math.max(10, Math.round(moduleWidth * 7));
  const guardExtra = geometry.symbology === 'code128' ? 0 : Math.round(textSize / 2);
  const totalHeight = height + (showText ? textSize + 4 : guardExtra);
  const width = geometry.modules * moduleWidth;
  const label = options.label ?? `${geometry.symbology.toUpperCase()} ${geometry.text}`;
  const rects = geometry.bars
    .map(
      (bar) =>
        `<rect x="${bar.x * moduleWidth}" y="0" width="${bar.width * moduleWidth}" height="${bar.guard ? height + guardExtra : height}"/>`,
    )
    .join('');
  const text = showText
    ? `<text x="${width / 2}" y="${totalHeight - 2}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${textSize}" letter-spacing="1">${escapeXml(geometry.text)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(label)}" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">` +
    `<rect width="${width}" height="${totalHeight}" fill="#ffffff"/><g fill="#000000">${rects}</g>${text}</svg>`
  );
}
