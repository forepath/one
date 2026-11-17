import {
  CODE128_PATTERNS,
  code128Geometry,
  code128Values,
  gtinBarcodeGeometry,
  gtinCheckDigit,
  isCode128Encodable,
  isValidGtin,
  normalizeGtin,
  renderBarcodeSvg,
} from './barcode';

describe('GTIN validation', () => {
  it.each(['4006381333931', '036000291452', '73513537', '9780201379624', '00012345600012'])('accepts %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it.each(['4006381333932', '12345', 'abcdefghijklm', '', '036000291453', '400638133393'])('rejects %s', (code) => {
    expect(isValidGtin(code)).toBe(false);
  });

  it('normalizes spaces and dashes', () => {
    expect(normalizeGtin(' 400-6381 333931 ')).toBe('4006381333931');
    expect(isValidGtin('4 006381 333931')).toBe(true);
  });

  it('computes the GS1 check digit', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(gtinCheckDigit('03600029145')).toBe(2);
    expect(() => gtinCheckDigit('12a')).toThrow();
  });
});

describe('EAN / UPC geometry', () => {
  it('encodes an EAN-13 with 95 modules plus quiet zones and 3 guard groups', () => {
    const geometry = gtinBarcodeGeometry('4006381333931');

    expect(geometry.symbology).toBe('ean13');
    expect(geometry.modules).toBe(95 + 22);
    expect(geometry.bars.filter((bar) => bar.guard)).toHaveLength(6);
    // Every EAN digit has exactly two bars: 12 encoded digits.
    expect(geometry.bars.filter((bar) => !bar.guard)).toHaveLength(24);
  });

  it('encodes an EAN-8', () => {
    const geometry = gtinBarcodeGeometry('73513537');

    expect(geometry.symbology).toBe('ean8');
    expect(geometry.modules).toBe(67 + 14);
    expect(geometry.bars.filter((bar) => !bar.guard)).toHaveLength(16);
  });

  it('encodes a UPC-A as EAN-13 with a leading zero but prints 12 digits', () => {
    const geometry = gtinBarcodeGeometry('036000291452');

    expect(geometry.symbology).toBe('upca');
    expect(geometry.text).toBe('036000291452');
    expect(geometry.modules).toBe(95 + 18);
  });

  it('draws a GTIN-14 as Code 128', () => {
    expect(gtinBarcodeGeometry('00012345600012').symbology).toBe('code128');
  });

  it('throws for invalid codes', () => {
    expect(() => gtinBarcodeGeometry('4006381333932')).toThrow('Invalid GTIN');
  });
});

describe('Code 128', () => {
  it('has 103 data/start symbols of 11 modules and a 13-module stop', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);

    CODE128_PATTERNS.forEach((pattern, value) => {
      const modules = pattern.split('').reduce((sum, width) => sum + Number(width), 0);

      expect(modules).toBe(value === 106 ? 13 : 11);
    });
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it('uses subset B with a mod-103 checksum', () => {
    const values = code128Values('ART-000123');

    expect(values[0]).toBe(104);
    expect(values[values.length - 1]).toBe(106);
    const data = values.slice(1, -2);
    const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), 104) % 103;

    expect(values[values.length - 2]).toBe(checksum);
    expect(data[0]).toBe('A'.charCodeAt(0) - 32);
  });

  it('uses subset C for even-length digit strings', () => {
    expect(code128Values('123456')).toEqual([105, 12, 34, 56, (105 + 12 + 34 * 2 + 56 * 3) % 103, 106]);
  });

  it('computes the module width including quiet zones', () => {
    const geometry = code128Geometry('ART-000123');

    // start + 10 data + checksum = 12 symbols of 11 modules, stop 13, quiet zones 2 × 10.
    expect(geometry.modules).toBe(12 * 11 + 13 + 20);
  });

  it('rejects non-printable characters', () => {
    expect(isCode128Encodable('äöü')).toBe(false);
    expect(isCode128Encodable('')).toBe(false);
    expect(() => code128Values('tab\there')).toThrow();
  });
});

describe('renderBarcodeSvg', () => {
  it('renders bars and escapes the text', () => {
    const svg = renderBarcodeSvg(code128Geometry('A<&>"'), { moduleWidth: 1, height: 20 });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('A&lt;&amp;&gt;&quot;');
    expect(svg).not.toContain('A<&>');
    expect(svg).toContain('<rect');
  });

  it('can hide the text', () => {
    expect(renderBarcodeSvg(gtinBarcodeGeometry('4006381333931'), { showText: false })).not.toContain('<text');
  });
});
