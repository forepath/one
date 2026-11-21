import { parseSepaPurpose } from './sepa-purpose';

describe('parseSepaPurpose', () => {
  it('splits concatenated DK purpose subfields by keyword', () => {
    expect(
      parseSepaPurpose(
        'EREF+INV-2026-77KREF+PAYRUN-11MREF+M-0001CRED+DE98ZZZ09999999999SVWZ+Strom Abschlag 11/2026ABWA+Max Mustermann',
      ),
    ).toEqual({
      endToEndId: 'INV-2026-77',
      customerReference: 'PAYRUN-11',
      mandateId: 'M-0001',
      creditorId: 'DE98ZZZ09999999999',
      remittance: 'Strom Abschlag 11/2026',
      ultimateDebtor: 'Max Mustermann',
    });
  });

  it('drops NOTPROVIDED and validates IBAN/BIC values', () => {
    expect(parseSepaPurpose('EREF+NOTPROVIDED SVWZ+Miete IBAN+DE02 1203 0000 0000 2020 51 BIC+BYLADEM1001')).toEqual({
      remittance: 'Miete',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
    });
    expect(parseSepaPurpose('SVWZ+Miete IBAN+DE00123')).toEqual({ remittance: 'Miete' });
  });

  it('uses leading text as remittance when SVWZ is missing', () => {
    expect(parseSepaPurpose('Gutschrift Rechnung 17 EREF+ABC')).toEqual({
      endToEndId: 'ABC',
      remittance: 'Gutschrift Rechnung 17',
    });
  });

  it('returns undefined without keywords', () => {
    expect(parseSepaPurpose('Rechnung 2026-0042')).toBeUndefined();
    expect(parseSepaPurpose(undefined)).toBeUndefined();
  });
});
