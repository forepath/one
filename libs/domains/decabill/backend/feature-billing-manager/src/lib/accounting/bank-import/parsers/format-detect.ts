import type { BankStatementFormat } from '../bank-import.types';

/**
 * Content-based bank statement format detection. Only the beginning of the text is inspected; the file name
 * extension relaxes fixed-width record length checks (editors often strip trailing spaces).
 */

const SNIFF_LENGTH = 64 * 1024;
const SAMPLE_LINES = 20;
const CSV_DELIMITERS = [';', ',', '\t', '|'] as const;

/** Returns the detected format, or `null` when the content matches no supported format. */
export function detectBankFormat(text: string, fileName?: string): BankStatementFormat | null {
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).slice(0, SNIFF_LENGTH);
  const trimmed = head.trimStart();
  const extension = (fileName ?? '').toLowerCase().split('.').pop() ?? '';

  if (trimmed.length === 0) {
    return null;
  }

  // XML family
  if (trimmed.startsWith('<')) {
    const camt = /urn:iso:std:iso:20022:tech:xsd:camt\.(052|053|054)\./.exec(head);

    if (camt) {
      return `camt.${camt[1]}` as BankStatementFormat;
    }

    if (/<OFX[\s>]/i.test(head) || /<\?OFX\s/i.test(head)) {
      return 'ofx';
    }
  }

  if (/^OFXHEADER\s*:/i.test(trimmed) || /<OFX>/i.test(head)) {
    return 'ofx';
  }

  if (/^!(Type|Account|Option)/i.test(trimmed)) {
    return 'qif';
  }

  if (trimmed.startsWith('01,')) {
    return 'bai2';
  }

  // SWIFT MT94x (optionally in an envelope or with `@@` line separators)
  if (/(?:^|\n|@@|\{4:):20:/.test(head)) {
    if (/(?:^|\n|@@):(?:13D|34F):/.test(head)) {
      return 'mt942';
    }

    if (/(?:^|\n|@@):(?:61|25):/.test(head)) {
      return 'mt940';
    }
  }

  const lines = head
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0)
    .slice(0, SAMPLE_LINES);
  // Do not judge the possibly truncated last sampled line when the sniff window cut the text.
  const complete = text.length > SNIFF_LENGTH && lines.length > 1 ? lines.slice(0, -1) : lines;
  const first = complete[0] ?? '';
  const fixed = detectFixedWidth(first, complete, extension);

  if (fixed) {
    return fixed;
  }

  return looksLikeCsv(complete) ? 'csv' : null;
}

function detectFixedWidth(first: string, lines: string[], extension: string): BankStatementFormat | null {
  const lenient = (formatExtensions: string[]): boolean => formatExtensions.includes(extension);

  if (first.startsWith('0000') && recordsOfLength(lines, 128, lenient(['cod', 'coda']))) {
    return 'coda';
  }

  if (first.startsWith('11') && recordsOfLength(lines, 80, lenient(['n43', 'aeb43', 'csb43', 'aeb', 'c43']))) {
    return 'norma43';
  }

  if (first.startsWith(' RH') && recordsOfLength(lines, 120, lenient(['cbi', 'rh']))) {
    return 'cbi-rh';
  }

  if (first.startsWith('01')) {
    if (
      recordsOfLength(lines, 120, lenient(['cfonb', 'cfo', 'rib', 'b120'])) &&
      lines.every((line) => /^(01|04|05|07)/.test(line))
    ) {
      return 'cfonb120';
    }

    // Some CFONB exports drop line breaks: one long line made of 120-character records.
    if (lines.length === 1 && first.length > 120 && first.length % 120 === 0 && first.slice(120).startsWith('04')) {
      return 'cfonb120';
    }
  }

  return null;
}

/** Every sampled record has exactly `length` characters (lenient: at most `length`, first one exact or close). */
function recordsOfLength(lines: string[], length: number, lenient: boolean): boolean {
  if (lines.length === 0) {
    return false;
  }

  if (lenient) {
    return lines.every((line) => line.length <= length && line.length >= Math.min(length, 10));
  }

  return lines.every((line) => line.length === length);
}

function looksLikeCsv(lines: string[]): boolean {
  if (lines.length < 2) {
    return false;
  }

  for (const delimiter of CSV_DELIMITERS) {
    const counts = lines.map((line) => countDelimiters(line, delimiter));
    const header = counts[0];

    if (header < 1) {
      continue;
    }

    const consistent = counts.filter((count) => count === header).length;

    if (consistent / counts.length >= 0.8) {
      return true;
    }
  }

  return false;
}

/** Counts delimiters outside double-quoted sections. */
function countDelimiters(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      count += 1;
    }
  }

  return count;
}
