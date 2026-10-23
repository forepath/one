import { csvCell, toCsv } from './csv.utils';

describe('csv', () => {
  it('quotes and escapes', () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(1.5)).toBe('1.5');
  });

  it('neutralizes formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell(-1)).toBe('-1');
  });

  it('builds documents', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\n1,"x"\n');
  });
});
