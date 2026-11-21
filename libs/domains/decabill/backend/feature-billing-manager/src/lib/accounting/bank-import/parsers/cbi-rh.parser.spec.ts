import { BankStatementParseError } from '../bank-import.types';

import { cbiAmount, parseCbiRh } from './cbi-rh.parser';

/** Builds a 120-char record by placing values at 1-based positions. */
function rec(fields: Array<[number, string]>): string {
  const chars = Array.from({ length: 120 }, () => ' ');

  for (const [start, value] of fields) {
    for (let i = 0; i < value.length; i += 1) {
      chars[start - 1 + i] = value[i];
    }
  }

  return chars.join('');
}

function info(movement: string, fields: Array<[number, string]>): string {
  return rec([[2, '63'], [4, '0000001'], [11, movement], ...fields]);
}

const HEADER = rec([
  [2, 'RH'],
  [4, '03069'],
  [9, '12345'],
  [14, '051124'],
  [20, 'RH20241105'],
]);
const OPENING = rec([
  [2, '61'],
  [4, '0000001'],
  [29, '93001'],
  [34, 'CONTO OPERATIVO'],
  [50, '01'],
  [52, 'X'],
  [53, '05428'],
  [58, '11101'],
  [63, '000000123456'],
  [75, 'EUR'],
  [78, '011124'],
  [84, 'C'],
  [85, '000000001000,00'],
  [100, 'IT'],
  [102, '60'],
]);
const CREDIT = [
  rec([
    [2, '62'],
    [4, '0000001'],
    [11, '001'],
    [14, '051124'],
    [20, '051124'],
    [26, 'C'],
    [27, '000000000250,00'],
    [42, '48'],
    [62, 'BANKREF0001'],
    [87, 'BONIFICO A VOSTRO FAVORE'],
  ]),
  info('001', [
    [14, 'YYY'],
    [17, '04112024'],
    [25, 'RSSMRA80A01H501U'],
    [41, 'ACME SRL'],
    [81, 'MILANO'],
  ]),
  info('001', [
    [14, 'YY2'],
    [17, 'VIA ROMA 1 MILANO'],
    [67, 'DE89370400440532013000'],
  ]),
  info('001', [
    [14, 'RI1'],
    [17, 'FATTURA 2024-0042 RF18539007547034 CRO 12345678901'],
  ]),
  info('001', [
    [14, 'ID1'],
    [17, 'MSG-0001'],
    [52, 'E2E-INV-2024-0042'],
  ]),
];
const DEBIT = rec([
  [2, '62'],
  [4, '0000001'],
  [11, '002'],
  [14, '061124'],
  [20, '061124'],
  [26, 'D'],
  [27, '000000000007550'],
  [42, '50'],
  [87, 'ADDEBITO SDD'],
]);
const CLOSING = rec([
  [2, '64'],
  [4, '0000001'],
  [11, 'EUR'],
  [14, '301124'],
  [20, 'C'],
  [21, '000000001174,50'],
  [36, 'C'],
  [37, '000000001174,50'],
]);
const AVAILABLE = rec([
  [2, '65'],
  [4, '0000001'],
  [11, '011224'],
  [17, 'C'],
  [18, '000000001174,50'],
]);
const TRAILER = rec([
  [2, 'EF'],
  [4, '03069'],
  [9, '12345'],
  [14, '051124'],
]);
const SAMPLE = [HEADER, OPENING, ...CREDIT, DEBIT, CLOSING, AVAILABLE, TRAILER];

describe('cbiAmount', () => {
  it('accepts decimal comma and implied decimals', () => {
    expect(cbiAmount('000000001234,56')).toBe('1234.56');
    expect(cbiAmount('000000000123456')).toBe('1234.56');
    expect(() => cbiAmount('00000000x234,56')).toThrow(BankStatementParseError);
  });
});

describe('parseCbiRh', () => {
  it('parses balances, movements and joins 63 records by movement number', () => {
    const result = parseCbiRh(SAMPLE.join('\r\n'));

    expect(result.format).toBe('cbi-rh');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.account).toEqual({ iban: 'IT60X0542811101000000123456', bankCode: '05428' });
    expect(statement.openingBalance).toEqual({ amount: '1000.00', currency: 'EUR', date: '2024-11-01' });
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-11-30' });
    expect(statement.availableBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-12-01' });

    const [credit, debit] = statement.transactions;

    expect(credit).toMatchObject({
      bookingDate: '2024-11-05',
      valueDate: '2024-11-05',
      amount: '250.00',
      bankTransactionCode: { national: '48' },
      bookingText: 'BONIFICO A VOSTRO FAVORE',
      bankReference: 'BANKREF0001',
      entryReference: '001',
      locator: 'record 3',
    });
    expect(credit.details).toEqual([
      {
        messageId: 'MSG-0001',
        endToEndId: 'E2E-INV-2024-0042',
        instructionId: '12345678901',
        remittance: 'FATTURA 2024-0042 RF18539007547034 CRO 12345678901',
        counterparty: { name: 'ACME SRL', iban: 'DE89370400440532013000' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
    expect(credit.raw?.split('\n')).toHaveLength(5);
    expect(debit).toMatchObject({ amount: '-75.50', locator: 'record 8' });
    expect(debit.details).toEqual([{ remittance: 'ADDEBITO SDD' }]);
  });

  it('falls back to ABI/CAB/account without IBAN and warns on unknown records and gaps', () => {
    const opening = rec([
      [2, '61'],
      [4, '0000002'],
      [29, '93001'],
      [53, '05428'],
      [58, '11101'],
      [63, '000000123456'],
      [75, 'EUR'],
      [78, '011124'],
      [84, 'D'],
      [85, '000000000010000'],
    ]);
    const result = parseCbiRh([HEADER, opening, rec([[2, '99']]), CLOSING, TRAILER].join(''));
    const [statement] = result.statements;

    expect(statement.account).toEqual({ accountNumber: '05428/11101/000000123456', bankCode: '05428' });
    expect(statement.openingBalance?.amount).toBe('-100.00');
    expect(result.warnings[0]).toBe('Unknown CBI record type "99" ignored (record 3)');
    expect(result.warnings[1]).toContain('does not match closing balance 1174.50');
  });

  it('maps foreign-transfer records: beneficiary and reason of outgoing payments, ignores amount blocks', () => {
    const transfer = rec([
      [2, '62'],
      [4, '0000001'],
      [11, '001'],
      [14, '071124'],
      [20, '071124'],
      [26, 'D'],
      [27, '000000000100,00'],
      [42, '26'],
      [87, 'BONIFICO ESTERO'],
    ]);
    const closing = rec([
      [2, '64'],
      [4, '0000001'],
      [11, 'EUR'],
      [14, '301124'],
      [20, 'C'],
      [21, '000000000900,00'],
      [36, 'C'],
      [37, '000000000900,00'],
    ]);
    const result = parseCbiRh(
      [
        HEADER,
        OPENING,
        transfer,
        info('001', [
          [14, 'ZZ1'],
          [17, '000000000000100,00EUR'],
        ]),
        info('001', [
          [14, 'ZZ3'],
          [17, 'FORNITORE SPA'],
          [67, 'SALDO FATTURA 7'],
        ]),
        closing,
        TRAILER,
      ].join('\n'),
    );
    const [statement] = result.statements;

    expect(result.warnings).toEqual([]);
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0]).toMatchObject({ amount: '-100.00', bankTransactionCode: { national: '26' } });
    expect(statement.transactions[0].details).toEqual([
      { remittance: 'SALDO FATTURA 7', counterparty: { name: 'FORNITORE SPA' } },
    ]);
  });

  it('parses several account reports and warns about a missing closing balance', () => {
    const result = parseCbiRh([HEADER, OPENING, CLOSING, OPENING, TRAILER].join('\n'));

    expect(result.statements).toHaveLength(2);
    expect(result.warnings).toContain('Account report at record 4 has no closing balance record 64');
  });

  it('rejects other input', () => {
    expect(() => parseCbiRh('not a cbi file')).toThrow(BankStatementParseError);
  });
});
