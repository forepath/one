import { BankStatementParseError } from '../bank-import.types';

import { parseMt940 } from './mt940.parser';

/** German Sparkasse export: two statements, DK `:86:` with SEPA keywords, year rollover and reversals. */
const SPARKASSE_MT940 = [
  ':20:STARTUMSE',
  ':25:37040044/0532013000',
  ':28C:00223/001',
  ':60F:C261118EUR1000,00',
  ':61:2611191119CR1190,00NTRFNONREF//2026111900001',
  ':86:166?00GUTSCHR. UEBERWEISUNG?100931?20EREF+E2E-RE-2026-0042?21SV',
  'WZ+Rechnung RE-2026-0042 ?22Danke?30BYLADEM1001?31DE021203000000',
  '00202051?32Muster Handel GmbH',
  ':61:2611191119DR50,00NDDTKREF-PAY-1//2026111900002',
  ':86:105?00FOLGELASTSCHRIFT?100992?20EREF+INV-2026-77?21MREF+M-0001',
  '?22CRED+DE98ZZZ09999999999?23SVWZ+Strom Abschlag 11/20?2426 Vertrag 4711',
  '?30COBADEFFXXX?31DE12500105170648489890?32Stadtwerke Musterstadt?34992',
  ':62F:C261119EUR2140,00',
  '-',
  ':20:STARTUMSE',
  ':25:DE44500105175407324931',
  ':28C:00001/001',
  ':60F:C251231EUR500,00',
  ':61:2512310102DR100,00NMSCNONREF',
  ':86:Kontofuehrungsentgelt Dezember 2025',
  ':61:2601021231CR20,00NTRFNONREF',
  ':86:166?00GUTSCHRIFT?20SVWZ+Rechnung RF18539007547034?32Kunde X GmbH',
  ':61:260102RC15,00NTRFNONREF//REV-1',
  ':86:Rueckbuchung Gutschrift',
  ':61:260102RD7,50NDDTNONREF//REV-2',
  ':86:Rueckgabe Lastschrift',
  ':62F:C260102EUR412,50',
  '-',
].join('\r\n');
/** ING (NL) export in a SWIFT envelope with slash-tagged `:86:`. */
const ING_MT940 = [
  '{1:F01INGBNL2ABXXX0000000000}{2:I940INGBNL2AXXXN}{4:',
  ':20:P261119000000001',
  ':25:NL20INGB0001234567EUR',
  ':28C:00000',
  ':60F:C261118EUR2500,00',
  ':61:261119C150,00NTRFEREF-ING-1//PREF-ING-1',
  '/TRCD/00100/',
  ':86:/EREF/EREF-ING-1//CNTP/NL91ABNA0417164300/ABNANL2A/J. Jansen/AMSTERDAM/',
  '/REMI/USTD//Factuur 2026-0815/',
  ':61:261119D49,95NDDTMANDATE-1//PREF-ING-2',
  ':86:/EREF/NOTPROVIDED//MARF/MANDATE-1//CSID/NL98ZZZ999999990000//CNTP/NL02ABNA0123456789/ABNANL2A/Energie BV//',
  '/REMI/STRD/CUR/RF712348231/',
  ':62F:C261119EUR2600,05',
  ':64:C261119EUR2600,05',
  '-}',
].join('\n');
const ABN_MT940 = [
  'ABNANL2A',
  '940',
  'ABNANL2A',
  ':20:ABN AMRO BANK NV',
  ':25:417164300',
  ':28:31901/1',
  ':60F:C261118EUR100,00',
  ':61:261119D25,00N658NONREF',
  ':86:/TRTP/SEPA OVERBOEKING/IBAN/NL02ABNA0123456789/BIC/ABNANL2A/NAME/J',
  'ANSEN/REMI/Huur november/EREF/HUUR-11',
  ':62F:C261119EUR75,00',
  '-',
].join('\n');
const MT942 = [
  ':20:MT942-0001',
  ':25:DE89370400440532013000',
  ':28C:1/1',
  ':34F:EURD0,',
  ':34F:EURC0,',
  ':13D:2611201215+0100',
  ':61:2611201120CR250,00NTRFNONREF//INTRA-1',
  ':86:166?00GUTSCHRIFT?20EREF+SHOP-99?21SVWZ+Order 99?32Kunde Y',
  ':90D:0EUR0,',
  ':90C:1EUR250,00',
  '-',
].join('\n');

describe('parseMt940', () => {
  describe('German Sparkasse MT940', () => {
    const result = parseMt940(SPARKASSE_MT940);
    const [first, second] = result.statements;

    it('splits statements and maps headers and balances', () => {
      expect(result.format).toBe('mt940');
      expect(result.warnings).toEqual([]);
      expect(result.statements).toHaveLength(2);

      const { transactions, ...header } = first;

      expect(transactions).toHaveLength(2);
      expect(header).toEqual({
        kind: 'statement',
        account: { bankCode: '37040044', accountNumber: '0532013000' },
        currency: 'EUR',
        statementId: 'STARTUMSE',
        sequenceNumber: '00223/001',
        periodFrom: '2026-11-18',
        periodTo: '2026-11-19',
        openingBalance: { amount: '1000.00', currency: 'EUR', date: '2026-11-18' },
        closingBalance: { amount: '2140.00', currency: 'EUR', date: '2026-11-19' },
      });
      expect(second.account).toEqual({ iban: 'DE44500105175407324931' });
    });

    it('parses a DK :86: credit transfer with SEPA keywords across wrapped lines', () => {
      expect(first.transactions[0]).toEqual({
        status: 'booked',
        bookingDate: '2026-11-19',
        valueDate: '2026-11-19',
        amount: '1190.00',
        currency: 'EUR',
        isReversal: false,
        bankTransactionCode: { proprietary: 'NTRF', national: '166' },
        bookingText: 'GUTSCHR. UEBERWEISUNG',
        bankReference: '2026111900001',
        isBatch: false,
        details: [
          {
            endToEndId: 'E2E-RE-2026-0042',
            remittance: 'Rechnung RE-2026-0042 Danke',
            counterparty: {
              name: 'Muster Handel GmbH',
              iban: 'DE02120300000000202051',
              bic: 'BYLADEM1001',
            },
          },
        ],
        locator: 'statement 1 :61: #1 (line 5)',
        raw: expect.stringMatching(/^:61:2611191119CR1190,00NTRFNONREF\/\/2026111900001\n:86:166\?00GUTSCHR/),
      });
    });

    it('parses a direct debit with mandate and creditor id', () => {
      const debit = first.transactions[1];

      expect(debit.amount).toBe('-50.00');
      expect(debit.entryReference).toBe('KREF-PAY-1');
      expect(debit.bankTransactionCode).toEqual({ proprietary: 'NDDT', national: '105' });
      expect(debit.details).toEqual([
        {
          endToEndId: 'INV-2026-77',
          mandateId: 'M-0001',
          creditorId: 'DE98ZZZ09999999999',
          remittance: 'Strom Abschlag 11/2026 Vertrag 4711',
          counterparty: {
            name: 'Stadtwerke Musterstadt',
            iban: 'DE12500105170648489890',
            bic: 'COBADEFFXXX',
          },
        },
      ]);
    });

    it('infers entry date years across the Dec/Jan boundary', () => {
      expect(second.transactions[0]).toMatchObject({ valueDate: '2025-12-31', bookingDate: '2026-01-02' });
      expect(second.transactions[1]).toMatchObject({ valueDate: '2026-01-02', bookingDate: '2025-12-31' });
      expect(second.periodFrom).toBe('2025-12-31');
      expect(second.periodTo).toBe('2026-01-02');
    });

    it('keeps unstructured :86: text as remittance and finds RF references', () => {
      expect(second.transactions[0].details).toEqual([{ remittance: 'Kontofuehrungsentgelt Dezember 2025' }]);
      expect(second.transactions[0].bankTransactionCode).toEqual({ proprietary: 'NMSC' });
      expect(second.transactions[1].details).toEqual([
        {
          remittance: 'Rechnung RF18539007547034',
          structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
          counterparty: { name: 'Kunde X GmbH' },
        },
      ]);
    });

    it('handles RC/RD reversals', () => {
      const [, , reversedCredit, reversedDebit] = second.transactions;

      expect(reversedCredit).toMatchObject({
        amount: '-15.00',
        isReversal: true,
        bankReference: 'REV-1',
        locator: 'statement 2 :61: #3 (line 23)',
      });
      expect(reversedDebit).toMatchObject({ amount: '7.50', isReversal: true, bankReference: 'REV-2' });
    });

    it('warns when opening balance plus entries does not match the closing balance', () => {
      const parsed = parseMt940(SPARKASSE_MT940.replace(':62F:C260102EUR412,50', ':62F:C260102EUR412,00'));

      expect(parsed.warnings).toEqual([
        'statement 2: opening balance 500.00 plus entries gives 412.50, but closing balance is 412.00',
      ]);
    });
  });

  it('parses the Dutch ING structured :86: inside a SWIFT envelope', () => {
    const result = parseMt940(ING_MT940);
    const statement = result.statements[0];

    expect(result.warnings).toEqual([]);
    expect(statement.account).toEqual({ iban: 'NL20INGB0001234567' });
    expect(statement.availableBalance).toEqual({ amount: '2600.05', currency: 'EUR', date: '2026-11-19' });
    expect(statement.transactions[0]).toMatchObject({
      amount: '150.00',
      bookingDate: '2026-11-19',
      bankReference: 'PREF-ING-1',
      entryReference: 'EREF-ING-1',
      bookingText: '/TRCD/00100/',
      details: [
        {
          endToEndId: 'EREF-ING-1',
          remittance: 'Factuur 2026-0815',
          counterparty: { iban: 'NL91ABNA0417164300', bic: 'ABNANL2A', name: 'J. Jansen' },
        },
      ],
    });
    expect(statement.transactions[1].amount).toBe('-49.95');
    expect(statement.transactions[1].details).toEqual([
      {
        mandateId: 'MANDATE-1',
        creditorId: 'NL98ZZZ999999990000',
        counterparty: { iban: 'NL02ABNA0123456789', bic: 'ABNANL2A', name: 'Energie BV' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF712348231', issuer: 'CUR' }],
      },
    ]);
  });

  it('parses ABN AMRO tags spanning continuation lines and ignores bank header lines', () => {
    const result = parseMt940(ABN_MT940);
    const statement = result.statements[0];

    expect(result.statements).toHaveLength(1);
    expect(statement.statementId).toBe('ABN AMRO BANK NV');
    expect(statement.account).toEqual({ accountNumber: '417164300' });
    expect(statement.transactions[0]).toMatchObject({
      amount: '-25.00',
      bookingText: 'SEPA OVERBOEKING',
      bankTransactionCode: { proprietary: 'N658' },
      details: [
        {
          endToEndId: 'HUUR-11',
          remittance: 'Huur november',
          counterparty: { iban: 'NL02ABNA0123456789', bic: 'ABNANL2A', name: 'JANSEN' },
        },
      ],
    });
  });

  it('parses MT942 interim reports as pending intraday entries', () => {
    const result = parseMt940(MT942);
    const statement = result.statements[0];

    expect(result.format).toBe('mt942');
    expect(statement.kind).toBe('intraday');
    expect(statement.currency).toBe('EUR');
    expect(statement.periodTo).toBe('2026-11-20');
    expect(statement.account).toEqual({ iban: 'DE89370400440532013000' });
    expect(statement.transactions[0]).toMatchObject({
      status: 'pending',
      amount: '250.00',
      bookingDate: '2026-11-20',
      bankReference: 'INTRA-1',
      details: [{ endToEndId: 'SHOP-99', remittance: 'Order 99', counterparty: { name: 'Kunde Y' } }],
    });
  });

  it('honours an explicit format option', () => {
    expect(parseMt940(MT942, { format: 'mt940' }).statements[0].transactions[0].status).toBe('booked');
  });

  it('accepts @@ line separators and statements separated only by :20:', () => {
    const text =
      ':20:A@@:25:37040044/0532013000@@:28C:1@@:60F:C261118EUR0,00@@:61:261119CR5,00NTRFNONREF@@:86:Testbuchung@@:62F:C261119EUR5,00@@' +
      ':20:B@@:25:37040044/0532013000@@:28C:2@@:60F:C261119EUR5,00@@:62F:C261120EUR5,00';
    const result = parseMt940(text);

    expect(result.statements.map((s) => s.statementId)).toEqual(['A', 'B']);
    expect(result.statements[0].transactions[0].details).toEqual([{ remittance: 'Testbuchung' }]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects malformed statement lines with a locator', () => {
    const broken = SPARKASSE_MT940.replace(':61:2611191119DR50,00', ':61:26111X1119DR50,00');

    expect(() => parseMt940(broken)).toThrow(BankStatementParseError);
    expect(() => parseMt940(broken)).toThrow(/statement 1 :61: #2 \(line 9\)/);
  });

  it('rejects input without statements', () => {
    expect(() => parseMt940('hello world')).toThrow(/No MT940/);
  });

  it('enforces the transaction limit', () => {
    expect(() =>
      parseMt940(SPARKASSE_MT940, { limits: { maxTransactions: 3, maxStatements: 10, maxLineLength: 1000 } }),
    ).toThrow(/Too many transactions/);
  });
});
