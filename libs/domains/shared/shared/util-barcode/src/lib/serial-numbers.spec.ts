import {
  compressSerialNumbers,
  expandSerialRange,
  isValidSerialNumber,
  parseSerialNumberInput,
  splitSerialNumberInput,
} from './serial-numbers';

describe('serial numbers', () => {
  it('validates single serial numbers', () => {
    expect(isValidSerialNumber('SN-0001')).toBe(true);
    expect(isValidSerialNumber('C02X1.2/A:B+#_')).toBe(true);
    expect(isValidSerialNumber('')).toBe(false);
    expect(isValidSerialNumber('-leading')).toBe(false);
    expect(isValidSerialNumber('has space')).toBe(false);
    expect(isValidSerialNumber('A..B')).toBe(false);
    expect(isValidSerialNumber('<script>')).toBe(false);
    expect(isValidSerialNumber('A'.repeat(129))).toBe(false);
  });

  it('splits on lines, commas and semicolons', () => {
    expect(splitSerialNumberInput(' A1 ,A2;\r\nA3\n\n')).toEqual(['A1', 'A2', 'A3']);
    expect(splitSerialNumberInput(['A1, A2', 'A3'])).toEqual(['A1', 'A2', 'A3']);
  });

  it('expands ranges keeping the padding of the first end', () => {
    expect(expandSerialRange('A-007', 'A-010')).toEqual({ values: ['A-007', 'A-008', 'A-009', 'A-010'] });
    expect(expandSerialRange('X9', 'X11')).toEqual({ values: ['X9', 'X10', 'X11'] });
    expect(expandSerialRange('SN1-A', 'SN3-A')).toEqual({ values: ['SN1-A', 'SN2-A', 'SN3-A'] });
    expect(expandSerialRange('A5', 'A5')).toEqual({ values: ['A5'] });
  });

  it('rejects unusable ranges', () => {
    expect(expandSerialRange('A-1', 'B-3')).toEqual({ code: 'range-mismatch' });
    expect(expandSerialRange('A-1-x', 'A-3-y')).toEqual({ code: 'range-mismatch' });
    expect(expandSerialRange('ABC', 'ABD')).toEqual({ code: 'range-mismatch' });
    expect(expandSerialRange('A-9', 'A-1')).toEqual({ code: 'range-order' });
    expect(expandSerialRange('A-1', 'A-2000', 1000)).toEqual({ code: 'too-many' });
    expect(expandSerialRange('A-1', 'A-1234567890123456')).toEqual({ code: 'range-mismatch' });
  });

  it('parses mixed input, reporting errors per token', () => {
    const parsed = parseSerialNumberInput('LAP-01..LAP-03\nMOUSE-7, bad token, LAP-02, Z9 .. Z1');

    expect(parsed.serialNumbers).toEqual(['LAP-01', 'LAP-02', 'LAP-03', 'MOUSE-7']);
    expect(parsed.errors).toEqual([
      { token: 'bad token', code: 'invalid' },
      { token: 'LAP-02', code: 'duplicate' },
      { token: 'Z9 .. Z1', code: 'range-order' },
    ]);
  });

  it('caps the expanded count', () => {
    const parsed = parseSerialNumberInput('A1..A5, B1', { max: 5 });

    expect(parsed.serialNumbers).toHaveLength(5);
    expect(parsed.errors).toEqual([{ token: 'B1', code: 'too-many' }]);
    expect(parseSerialNumberInput('A1..A9', { max: 5 }).errors).toEqual([{ token: 'A1..A9', code: 'too-many' }]);
  });

  it('compresses consecutive runs into ranges (inverse of parsing)', () => {
    const serials = ['LAP-03', 'LAP-01', 'LAP-02', 'LAP-07', 'X', 'LAP-08', 'M-9', 'M-10', 'M-11'];
    const compressed = compressSerialNumbers(serials);

    expect(compressed).toEqual(['LAP-01..LAP-03', 'LAP-07', 'LAP-08', 'M-9..M-11', 'X']);
    expect(new Set(parseSerialNumberInput(compressed).serialNumbers)).toEqual(new Set(serials));
  });

  it('does not merge different paddings', () => {
    expect(compressSerialNumbers(['A01', 'A02', 'A3', 'A4'])).toEqual(['A01', 'A02', 'A3', 'A4']);
  });
});
