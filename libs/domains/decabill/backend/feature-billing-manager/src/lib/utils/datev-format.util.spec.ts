import {
  encodeDatevCsv,
  escapeDatevField,
  formatDatevAmount,
  joinDatevLines,
  parseBooleanEnv,
  parseCsvTenantIds,
  resolvePreviousCalendarMonth,
  sanitizeDatevText,
} from './datev-format.util';

describe('datev-format.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('formats amounts with comma decimal', () => {
    expect(formatDatevAmount(119)).toBe('119,00');
    expect(formatDatevAmount(-42.5)).toBe('42,50');
  });

  it('escapes semicolons and quotes in CSV fields', () => {
    expect(escapeDatevField('plain')).toBe('plain');
    expect(escapeDatevField('a;b')).toBe('"a;b"');
    expect(escapeDatevField('say "hi"')).toBe('"say ""hi"""');
  });

  it('transliterates umlauts in CSV fields to ASCII', () => {
    expect(escapeDatevField('Müller GmbH')).toBe('Mueller GmbH');
    expect(escapeDatevField('BU-Schlüssel')).toBe('BU-Schluessel');
  });

  it('sanitizes text to printable ASCII', () => {
    expect(sanitizeDatevText('Café ☕')).toBe('Caf');
  });

  it('joins lines with CRLF', () => {
    expect(joinDatevLines(['a', 'b'])).toBe('a\r\nb\r\n');
  });

  it('encodes ASCII content to CP1252 bytes', () => {
    const encoded = encodeDatevCsv('Mueller');

    expect(encoded.equals(Buffer.from('Mueller', 'ascii'))).toBe(true);
  });

  it('parses boolean env values', () => {
    process.env.TEST_BOOL = 'false';

    expect(parseBooleanEnv('TEST_BOOL', true)).toBe(false);
    expect(parseBooleanEnv('MISSING_BOOL', true)).toBe(true);
  });

  it('parses CSV tenant ids with default fallback', () => {
    expect(parseCsvTenantIds('MISSING', ['default'])).toEqual(['default']);
    process.env.TEST_TENANTS = 'default,acme';
    expect(parseCsvTenantIds('TEST_TENANTS', ['default'])).toEqual(['default', 'acme']);
  });

  it('resolves previous calendar month in timezone', () => {
    const period = resolvePreviousCalendarMonth('Europe/Berlin', new Date('2026-02-01T00:00:00Z'));

    expect(period.year).toBe(2026);
    expect(period.month).toBe(1);
  });
});
