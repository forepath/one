import { detectBankFormat } from './format-detect';

function records(length: number, prefixes: string[]): string[] {
  return prefixes.map((prefix) => prefix.padEnd(length, ' '));
}

describe('detectBankFormat', () => {
  it('detects camt messages by namespace', () => {
    const camt = (type: string): string =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.${type}.001.08"><x/></Document>`;

    expect(detectBankFormat(camt('052'))).toBe('camt.052');
    expect(detectBankFormat(camt('053'))).toBe('camt.053');
    expect(detectBankFormat(`\uFEFF${camt('054')}`)).toBe('camt.054');
    expect(detectBankFormat('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>')).toBeNull();
  });

  it('detects OFX (SGML and XML) and QIF', () => {
    expect(detectBankFormat('OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX>\n<SIGNONMSGSRSV1>')).toBe('ofx');
    expect(
      detectBankFormat('<?xml version="1.0"?>\n<?OFX OFXHEADER="200" VERSION="220"?>\n<OFX><SIGNONMSGSRSV1/></OFX>'),
    ).toBe('ofx');
    expect(detectBankFormat('!Type:Bank\nD11/19/2026\nT-50.00\nPStadtwerke\n^\n')).toBe('qif');
  });

  it('detects BAI2', () => {
    expect(detectBankFormat('01,121000248,DECABILL,261120,0600,1,80,,2/\n02,DECABILL,121000248,1,261119,,USD,2/')).toBe(
      'bai2',
    );
  });

  it('detects MT940 and MT942, with and without SWIFT envelope', () => {
    const mt940 =
      ':20:STARTUMSE\r\n:25:37040044/0532013000\r\n:28C:1\r\n:60F:C261118EUR0,00\r\n:61:261119CR5,00NTRFNONREF\r\n';

    expect(detectBankFormat(mt940)).toBe('mt940');
    expect(detectBankFormat(`{1:F01INGBNL2ABXXX0000000000}{2:I940INGBNL2AXXXN}{4:\n${mt940}-}`)).toBe('mt940');
    expect(detectBankFormat(':20:STARTUMSE@@:25:37040044/0532013000@@:28C:1')).toBe('mt940');
    expect(
      detectBankFormat(':20:MT942\n:25:DE89370400440532013000\n:28C:1/1\n:34F:EURD0,\n:13D:2611201215+0100\n'),
    ).toBe('mt942');
  });

  it('detects CODA by its 128-character records', () => {
    const coda = records(128, [
      '0000019112620005        00000000  DECABILL DEMO              BBRUBEBB   00123456789 00000',
      '12001BE68539007547034                  EUR0000000001000000181126DECABILL DEMO',
      '21000100000001500000103  0000000000050000191126001500000',
      '8001BE68539007547034                  EUR0000000000950000191126',
      '9               000004000000000050000000000000000000',
    ]).join('\n');

    expect(detectBankFormat(coda)).toBe('coda');
    expect(detectBankFormat(coda.replace(/ +\n/g, '\n'))).toBeNull();
    expect(detectBankFormat(coda.replace(/ +\n/g, '\n'), 'statement.cod')).toBe('coda');
  });

  it('detects Norma 43 by its 80-character records', () => {
    const n43 = records(80, [
      '1121000418450200051332261119261119200000000100000978DECABILL DEMO',
      '2221000418450200051332261119261119029902000000000005000000000000000000000000',
      '3321000418450200051332000000000000000000000001000000000000500002000000000950000978',
      '88999999999999999999000004',
    ]);
    // Record 33 is longer than 80 characters in this sample → trim it to keep fixed width honest.
    const fixed = n43.map((line) => line.slice(0, 80)).join('\r\n');

    expect(detectBankFormat(fixed)).toBe('norma43');
  });

  it('detects CFONB120 with and without line breaks', () => {
    const cfonb = records(120, [
      '0130004012340102EUR2 00012345678  181126DECABILL DEMO',
      '0430004012340102EUR2E00012345678  191126  191126VIR SEPA MUSTER',
      '0730004012340102EUR2 00012345678  191126',
    ]);

    expect(detectBankFormat(cfonb.join('\n'))).toBe('cfonb120');
    expect(detectBankFormat(cfonb.join(''))).toBe('cfonb120');
  });

  it('detects CBI RH by the leading " RH" record', () => {
    const cbi = records(120, [
      ' RH0306912345261120DECABILL',
      ' 610000001',
      ' 620000001001',
      ' 640000001',
      ' EF0306912345',
    ]);

    expect(detectBankFormat(cbi.join('\n'))).toBe('cbi-rh');
  });

  it('falls back to CSV when delimiter counts are consistent', () => {
    const csv = [
      'Buchungstag;Valutadatum;Empfaenger;Verwendungszweck;Betrag',
      '19.11.2026;19.11.2026;"Muster; Handel GmbH";Rechnung RE-2026-0042;1190,00',
      '19.11.2026;19.11.2026;Stadtwerke;Abschlag;-50,00',
    ].join('\n');

    expect(detectBankFormat(csv)).toBe('csv');
    expect(detectBankFormat('date,amount,payee\n2026-11-19,-50.00,Stadtwerke\n2026-11-20,10.00,Shop')).toBe('csv');
  });

  it('returns null for unknown content', () => {
    expect(detectBankFormat('')).toBeNull();
    expect(detectBankFormat('   \n  ')).toBeNull();
    expect(detectBankFormat('hello world')).toBeNull();
    expect(detectBankFormat('just;one line')).toBeNull();
    expect(detectBankFormat('a;b;c\nno delimiters here\nnone here either')).toBeNull();
  });
});
