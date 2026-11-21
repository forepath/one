/** Plain negative numbers (`-12.50`, `-1.234,56`) are data, not formulas. */
const PLAIN_NUMBER = /^-\d+(?:[.,]\d+)*$/;
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) in a CSV cell for re-exports: cells starting with
 * `=`, `+`, `-`, `@`, TAB or CR are prefixed with `'`, except plain negative numbers such as `-12.50`.
 */
export function neutralizeCsvCell(value: string): string {
  if (value.length === 0 || !FORMULA_TRIGGERS.includes(value[0])) {
    return value;
  }

  if (PLAIN_NUMBER.test(value)) {
    return value;
  }

  return `'${value}`;
}
