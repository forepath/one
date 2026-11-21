import { neutralizeCsvCell } from './csv-injection.util';

describe('neutralizeCsvCell', () => {
  it('prefixes cells that spreadsheets would evaluate', () => {
    expect(neutralizeCsvCell('=HYPERLINK("http://x","y")')).toBe('\'=HYPERLINK("http://x","y")');
    expect(neutralizeCsvCell('+1+cmd|calc')).toBe("'+1+cmd|calc");
    expect(neutralizeCsvCell('-2+3')).toBe("'-2+3");
    expect(neutralizeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeCsvCell('\t=1')).toBe("'\t=1");
    expect(neutralizeCsvCell('\r=1')).toBe("'\r=1");
  });

  it('leaves plain text and negative numbers untouched', () => {
    expect(neutralizeCsvCell('')).toBe('');
    expect(neutralizeCsvCell('ACME GmbH')).toBe('ACME GmbH');
    expect(neutralizeCsvCell('a=b')).toBe('a=b');
    expect(neutralizeCsvCell('-12.50')).toBe('-12.50');
    expect(neutralizeCsvCell('-1.234,56')).toBe('-1.234,56');
    expect(neutralizeCsvCell('12.50')).toBe('12.50');
  });
});
