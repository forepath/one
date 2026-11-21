import { BankStatementParseError } from '../bank-import.types';

import { cccControlDigits, parseNorma43 } from './norma43.parser';

/** Concatenates fixed-width parts and pads the record to 80 characters. */
function rec(...parts: string[]): string {
  const value = parts.join('');

  if (value.length > 80) {
    throw new Error(`Record too long: ${value.length}`);
  }

  return value.padEnd(80, ' ');
}

const pad = (value: string, length: number): string => value.padEnd(length, ' ');
const HEADER = rec(
  '11',
  '2100',
  '0418',
  '0200051332',
  '241101',
  '241130',
  '2',
  '00000000100000',
  '978',
  '3',
  pad('DECABILL SL', 26),
);
const MOVEMENT_CREDIT = [
  rec(
    '22',
    '    ',
    '0418',
    '241105',
    '241105',
    '02',
    '099',
    '2',
    '00000000025000',
    '0000012345',
    'REF000000001',
    pad('INV-2024-0042', 16),
  ),
  rec('23', '01', pad('ACME SL', 38), pad('FACTURA 2024-0042', 38)),
  rec('23', '02', pad('RF18539007547034', 38)),
];
const MOVEMENT_DEBIT = [
  rec(
    '22',
    '    ',
    '0418',
    '241110',
    '241111',
    '12',
    '001',
    '1',
    '00000000007550',
    '0000000000',
    '000000000000',
    pad('', 16),
  ),
  rec('24', '01', '840', '00000000008200'),
];
const TRAILER = rec(
  '33',
  '2100',
  '0418',
  '0200051332',
  '00001',
  '00000000007550',
  '00001',
  '00000000025000',
  '2',
  '00000000117450',
  '978',
);
const END = rec('88', '9'.repeat(18), '000007');
const SAMPLE = [HEADER, ...MOVEMENT_CREDIT, ...MOVEMENT_DEBIT, TRAILER, END];

describe('parseNorma43', () => {
  it('computes CCC control digits', () => {
    expect(cccControlDigits('2100', '0418', '0200051332')).toBe('45');
  });

  it('parses the account, balances and movements', () => {
    const result = parseNorma43(SAMPLE.join('\r\n'));

    expect(result.format).toBe('norma43');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.account).toEqual({
      iban: 'ES9121000418450200051332',
      accountNumber: '21000418450200051332',
      bankCode: '2100',
    });
    expect(statement.periodFrom).toBe('2024-11-01');
    expect(statement.periodTo).toBe('2024-11-30');
    expect(statement.openingBalance).toEqual({ amount: '1000.00', currency: 'EUR', date: '2024-11-01' });
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-11-30' });

    const [credit, debit] = statement.transactions;

    expect(credit).toMatchObject({
      bookingDate: '2024-11-05',
      valueDate: '2024-11-05',
      amount: '250.00',
      currency: 'EUR',
      bankTransactionCode: { national: '02', proprietary: '099' },
      entryReference: '0000012345',
      bankReference: 'REF000000001',
      locator: 'record 2',
    });
    expect(credit.details).toEqual([
      {
        remittance: 'ACME SL FACTURA 2024-0042 RF18539007547034',
        counterparty: { name: 'ACME SL' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
    expect(credit.raw?.split('\n')).toHaveLength(3);

    expect(debit).toMatchObject({ amount: '-75.50', valueDate: '2024-11-11', locator: 'record 5' });
    expect(debit.entryReference).toBeUndefined();
    expect(debit.details).toEqual([{ originalAmount: '-82.00', originalCurrency: 'USD' }]);
  });

  it('uses reference 2 as remittance without complementary concepts and tolerates joined records', () => {
    const withoutConcepts = [HEADER, MOVEMENT_CREDIT[0], TRAILER].join('');
    const result = parseNorma43(withoutConcepts);

    expect(result.statements[0].transactions[0].details[0].remittance).toBe('INV-2024-0042');
    expect(result.warnings.some((w) => w.includes('do not match'))).toBe(true);
  });

  it('parses several accounts and warns on balance gaps', () => {
    const second = rec(
      '11',
      '2100',
      '0418',
      '0200051332',
      '241201',
      '241231',
      '1',
      '00000000001000',
      '978',
      '3',
      pad('DECABILL SL', 26),
    );
    const secondTrailer = rec(
      '33',
      '2100',
      '0418',
      '0200051332',
      '00000',
      '00000000000000',
      '00000',
      '00000000000000',
      '2',
      '00000000005000',
      '978',
    );
    const result = parseNorma43([...SAMPLE.slice(0, -1), second, secondTrailer, END].join('\n'));

    expect(result.statements).toHaveLength(2);
    expect(result.statements[1].openingBalance?.amount).toBe('-10.00');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('does not match closing balance 50.00');
  });

  it('rejects files that do not start with an account header', () => {
    expect(() => parseNorma43(MOVEMENT_CREDIT.join('\n'))).toThrow(BankStatementParseError);
  });

  it('enforces the statement limit', () => {
    expect(() =>
      parseNorma43(SAMPLE.join('\n'), { maxTransactions: 10, maxStatements: 0, maxLineLength: 1000 }),
    ).toThrow('statements');
  });
});
