import { create } from 'qrcode';

import { buildEpcQrDataUri, buildEpcQrPayload, renderEpcQrSvgDataUri, type EpcQrInput } from './epc-qr.util';

describe('epc-qr.util', () => {
  const input: EpcQrInput = {
    beneficiaryName: 'Sample Issuer GmbH',
    iban: 'DE89 3704 0044 0532 0130 00',
    bic: 'cobadeffxxx',
    currency: 'EUR',
    amount: '119.0000',
    remittanceText: 'INV-2026-00042',
  };

  it('builds an EPC069-12 v002 SCT payload', () => {
    expect(buildEpcQrPayload(input)).toBe(
      [
        'BCD',
        '002',
        '1',
        'SCT',
        'COBADEFFXXX',
        'Sample Issuer GmbH',
        'DE89370400440532013000',
        'EUR119.00',
        '',
        '',
        'INV-2026-00042',
      ].join('\n'),
    );
  });

  it('omits an invalid BIC (optional in version 002)', () => {
    expect(buildEpcQrPayload({ ...input, bic: 'nope' })?.split('\n')[4]).toBe('');
  });

  it.each([
    ['non-EUR currency', { currency: 'USD' }],
    ['missing IBAN', { iban: undefined }],
    ['IBAN with a wrong checksum', { iban: 'DE89370400440532013001' }],
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['amount above the EPC maximum', { amount: 1_000_000_000 }],
    ['missing beneficiary name', { beneficiaryName: '  ' }],
  ])('returns null for %s', (_label, override) => {
    expect(buildEpcQrPayload({ ...input, ...override } as EpcQrInput)).toBeNull();
  });

  it('cannot be shifted by line breaks or control characters in the fields', () => {
    const payload = buildEpcQrPayload({
      ...input,
      beneficiaryName: 'Evil\nGmbH\r\nDE00000000000000000000',
      remittanceText: 'INV-1\u2028EUR999999999.99\u0000',
    })!;
    const lines = payload.split('\n');

    expect(lines).toHaveLength(11);
    expect(lines[5]).toBe('Evil GmbH DE00000000000000000000');
    expect(lines[6]).toBe('DE89370400440532013000');
    expect(lines[7]).toBe('EUR119.00');
    expect(lines[10]).toBe('INV-1 EUR999999999.99');
  });

  it('truncates fields to the EPC maximum lengths and stays within 331 bytes', () => {
    const payload = buildEpcQrPayload({ ...input, beneficiaryName: 'N'.repeat(200), remittanceText: 'R'.repeat(300) })!;
    const lines = payload.split('\n');

    expect(lines[5]).toHaveLength(70);
    expect(lines[10]).toHaveLength(140);
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(331);
  });

  it('renders the QR matrix (error correction M, version ≤ 13) as an SVG data URI', () => {
    const payload = buildEpcQrPayload(input)!;
    const qr = create(payload, { errorCorrectionLevel: 'M' });
    const uri = renderEpcQrSvgDataUri(payload)!;
    const svg = Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
    let dark = 0;

    for (let row = 0; row < qr.modules.size; row++) {
      for (let column = 0; column < qr.modules.size; column++) {
        dark += qr.modules.get(row, column) ? 1 : 0;
      }
    }

    expect(qr.version).toBeLessThanOrEqual(13);
    expect(svg).toContain(`viewBox="0 0 ${qr.modules.size + 8} ${qr.modules.size + 8}"`);
    expect(svg.match(/h1v1h-1z/g)).toHaveLength(dark);
    expect(svg).not.toContain('<script');
  });

  it('returns undefined when not applicable', () => {
    expect(buildEpcQrDataUri({ ...input, iban: '' })).toBeUndefined();
    expect(buildEpcQrDataUri(input)).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
