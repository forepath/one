/**
 * One CSV cell (RFC 4180 quoting). Text starting like a formula (`=`, `+`, `-`, `@`, tab, CR) gets a leading `'`
 * so spreadsheets don't evaluate exported log lines or names (CSV injection); numbers stay as they are.
 */
export function csvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return `"${safe.replace(/"/g, '""')}"`;
}

/** A CSV document: a header and one line per row, newline-terminated. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n';
}
