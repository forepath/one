/**
 * Serial number input shared by backends and frontends: single serial numbers and ranges (`SN-0001..SN-0050`)
 * separated by line breaks, commas or semicolons. A range counts up the last digit group; prefix and suffix must be
 * equal on both ends and the zero padding of the first end is kept (`A-007..A-010` → `A-007`, `A-008`, …, `A-010`).
 */

export const SERIAL_NUMBER_MAX_LENGTH = 128;

/** Letters, digits and `. _ - / : + #`; starts with a letter or digit; never contains the range separator. */
export const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_\-/:+#]|\.(?!\.))*$/;

export const SERIAL_RANGE_SEPARATOR = '..';

/** Default upper bound of serial numbers one input may expand to. */
export const SERIAL_NUMBER_INPUT_MAX = 1000;

export type SerialNumberInputErrorCode = 'invalid' | 'range-mismatch' | 'range-order' | 'too-many' | 'duplicate';

export interface SerialNumberInputError {
  /** The offending input token (single serial number or range). */
  token: string;
  code: SerialNumberInputErrorCode;
}

export interface ParsedSerialNumbers {
  /** Expanded, de-duplicated serial numbers in input order. */
  serialNumbers: string[];
  errors: SerialNumberInputError[];
}

const RANGE_TOKEN = /^(.+?)\s*\.\.\s*(.+)$/;
const NUMBERED = /^(.*?)(\d+)(\D*)$/;
/** Ranges count with plain numbers; longer digit groups are not ranges anyone types. */
const MAX_RANGE_DIGITS = 15;

export function isValidSerialNumber(value: string): boolean {
  return value.length > 0 && value.length <= SERIAL_NUMBER_MAX_LENGTH && SERIAL_NUMBER_PATTERN.test(value);
}

/** Input tokens: one per line, comma or semicolon (arrays may hold several tokens per entry, too). */
export function splitSerialNumberInput(input: string | readonly string[]): string[] {
  const parts = typeof input === 'string' ? [input] : input;

  return parts
    .flatMap((part) => String(part ?? '').split(/[\r\n,;]+/))
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/** Parses and expands serial number input (see the file comment). Errors never stop the other tokens. */
export function parseSerialNumberInput(
  input: string | readonly string[],
  options: { max?: number } = {},
): ParsedSerialNumbers {
  const max = options.max ?? SERIAL_NUMBER_INPUT_MAX;
  const seen = new Set<string>();
  const serialNumbers: string[] = [];
  const errors: SerialNumberInputError[] = [];
  const add = (token: string, values: string[]): void => {
    for (const value of values) {
      if (seen.has(value)) {
        errors.push({ token: value === token ? token : `${value} (${token})`, code: 'duplicate' });
        continue;
      }

      if (serialNumbers.length >= max) {
        errors.push({ token, code: 'too-many' });

        return;
      }

      seen.add(value);
      serialNumbers.push(value);
    }
  };

  for (const token of splitSerialNumberInput(input)) {
    const range = RANGE_TOKEN.exec(token);

    if (!range) {
      if (isValidSerialNumber(token)) {
        add(token, [token]);
      } else {
        errors.push({ token, code: 'invalid' });
      }

      continue;
    }

    const expanded = expandSerialRange(range[1]!.trim(), range[2]!.trim(), max - serialNumbers.length);

    if ('code' in expanded) {
      errors.push({ token, code: expanded.code });
    } else {
      add(token, expanded.values);
    }
  }

  return { serialNumbers, errors };
}

/** Serial numbers from `from` to `to` (inclusive), or why the range is not usable. */
export function expandSerialRange(
  from: string,
  to: string,
  max: number = SERIAL_NUMBER_INPUT_MAX,
): { values: string[] } | { code: SerialNumberInputErrorCode } {
  if (!isValidSerialNumber(from) || !isValidSerialNumber(to)) {
    return { code: 'invalid' };
  }

  const start = NUMBERED.exec(from);
  const end = NUMBERED.exec(to);

  if (
    !start ||
    !end ||
    start[1] !== end[1] ||
    start[3] !== end[3] ||
    start[2]!.length > MAX_RANGE_DIGITS ||
    end[2]!.length > MAX_RANGE_DIGITS
  ) {
    return { code: 'range-mismatch' };
  }

  const first = Number(start[2]);
  const last = Number(end[2]);

  if (last < first) {
    return { code: 'range-order' };
  }

  if (last - first + 1 > max) {
    return { code: 'too-many' };
  }

  const width = start[2]!.length;
  const values: string[] = [];

  for (let value = first; value <= last; value++) {
    const serial = `${start[1]}${String(value).padStart(width, '0')}${start[3]}`;

    if (serial.length > SERIAL_NUMBER_MAX_LENGTH) {
      return { code: 'invalid' };
    }

    values.push(serial);
  }

  return { values };
}

interface SerialKey {
  serial: string;
  prefix: string;
  suffix: string;
  digits: string;
  value: number;
}

function serialKey(serial: string): SerialKey | null {
  const match = NUMBERED.exec(serial);

  if (!match || match[2]!.length > MAX_RANGE_DIGITS) {
    return null;
  }

  return { serial, prefix: match[1]!, suffix: match[3]!, digits: match[2]!, value: Number(match[2]) };
}

/**
 * Compact display of serial numbers: runs of three or more consecutive numbers become `first..last` ranges (the
 * inverse of {@link parseSerialNumberInput}); everything is sorted naturally.
 */
export function compressSerialNumbers(serials: readonly string[]): string[] {
  const keyed: SerialKey[] = [];
  const plain: string[] = [];

  for (const serial of new Set(serials)) {
    const key = serialKey(serial);

    if (key) {
      keyed.push(key);
    } else {
      plain.push(serial);
    }
  }

  keyed.sort(
    (a, b) =>
      a.prefix.localeCompare(b.prefix) ||
      a.suffix.localeCompare(b.suffix) ||
      a.value - b.value ||
      a.digits.length - b.digits.length,
  );

  const tokens: string[] = [];
  let run: SerialKey[] = [];
  const flush = () => {
    if (run.length >= 3) {
      tokens.push(`${run[0]!.serial}${SERIAL_RANGE_SEPARATOR}${run[run.length - 1]!.serial}`);
    } else {
      tokens.push(...run.map((entry) => entry.serial));
    }

    run = [];
  };

  for (const key of keyed) {
    const previous = run[run.length - 1];
    const continues =
      previous &&
      previous.prefix === key.prefix &&
      previous.suffix === key.suffix &&
      key.value === previous.value + 1 &&
      // Same notation as a range would expand to (padding of the first end).
      key.digits === String(key.value).padStart(run[0]!.digits.length, '0');

    if (!continues) {
      flush();
    }

    run.push(key);
  }

  flush();

  return [...tokens, ...plain.sort((a, b) => a.localeCompare(b))];
}
