import { BankStatementParseError } from '../bank-import.types';

import { decodeOverpunch, parseCfonb120, ribKey } from './cfonb120.parser';

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

const ACCOUNT: Array<[number, string]> = [
  [3, '20041'],
  [12, '01005'],
  [17, 'EUR'],
  [20, '2'],
  [22, '0500013M026'],
];

function balance(code: string, date: string, amount: string): string {
  return rec([[1, code], ...ACCOUNT, [35, date], [91, amount]]);
}

function complement(qualifier: string, value: string): string {
  return rec([[1, '05'], ...ACCOUNT, [35, '051124'], [46, qualifier], [49, value]]);
}

const OPENING = balance('01', '011124', '0000000010000{');
const CREDIT = [
  rec([
    [1, '04'],
    ...ACCOUNT,
    [8, '0001'],
    [33, '05'],
    [35, '051124'],
    [43, '051124'],
    [49, 'VIR SEPA ACME SAS'],
    [82, '0000123'],
    [91, '0000000002500{'],
    [105, 'VIRREF001'],
  ]),
  complement('NPY', 'ACME SAS'),
  complement('IPY', 'DE89370400440532013000'),
  complement('RCN', 'E2E-INV-2024-0042'),
  complement('LCC', 'FACTURE 2024-0042 RF18539007547034'),
];
const DEBIT = [
  rec([
    [1, '04'],
    ...ACCOUNT,
    [33, '01'],
    [35, '061124'],
    [43, '071124'],
    [49, 'PRLV SEPA EDF'],
    [82, '0000124'],
    [91, '0000000000755}'],
  ]),
  complement('MMO', 'USD200000000008200'),
  complement('NBE', 'EDF SA'),
];
const CLOSING = balance('07', '301124', '0000000011745{');
const SAMPLE = [OPENING, ...CREDIT, ...DEBIT, CLOSING];

describe('cfonb120 helpers', () => {
  it('computes the RIB key', () => {
    expect(ribKey('20041', '01005', '0500013M026')).toBe('06');
  });

  it('decodes overpunched amounts', () => {
    expect(decodeOverpunch('0000000000123D', 2)).toBe('12.34');
    expect(decodeOverpunch('0000000000123M', 2)).toBe('-12.34');
    expect(decodeOverpunch('0000000000000}', 2)).toBe('0.00');
    expect(decodeOverpunch('0000000000001{', 0)).toBe('10');
    expect(() => decodeOverpunch('00000000000X1?', 2)).toThrow(BankStatementParseError);
  });
});

describe('parseCfonb120', () => {
  it('parses balances, movements and complements', () => {
    const result = parseCfonb120(SAMPLE.join('\r\n'));

    expect(result.format).toBe('cfonb120');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.account).toEqual({
      iban: 'FR1420041010050500013M02606',
      accountNumber: '20041010050500013M02606',
      bankCode: '20041',
    });
    expect(statement.openingBalance).toEqual({ amount: '1000.00', currency: 'EUR', date: '2024-11-01' });
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-11-30' });
    expect(statement.periodFrom).toBe('2024-11-01');
    expect(statement.periodTo).toBe('2024-11-30');

    const [credit, debit] = statement.transactions;

    expect(credit).toMatchObject({
      bookingDate: '2024-11-05',
      valueDate: '2024-11-05',
      amount: '250.00',
      bankTransactionCode: { national: '05', proprietary: '0001' },
      bookingText: 'VIR SEPA ACME SAS',
      entryReference: '0000123',
      locator: 'record 2',
    });
    expect(credit.details).toEqual([
      {
        instructionId: 'VIRREF001',
        endToEndId: 'E2E-INV-2024-0042',
        remittance: 'VIR SEPA ACME SAS FACTURE 2024-0042 RF18539007547034',
        counterparty: { name: 'ACME SAS', iban: 'DE89370400440532013000' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
    expect(credit.raw?.split('\n')).toHaveLength(5);

    expect(debit).toMatchObject({ amount: '-75.50', bookingDate: '2024-11-06', valueDate: '2024-11-07' });
    expect(debit.details).toEqual([
      {
        originalCurrency: 'USD',
        originalAmount: '-82.00',
        remittance: 'PRLV SEPA EDF',
        counterparty: { name: 'EDF SA' },
      },
    ]);
  });

  it('handles joined records and multiple statements with a balance warning', () => {
    const second = [balance('01', '011224', '0000000001000}'), balance('07', '311224', '0000000000000{')];
    const result = parseCfonb120([...SAMPLE, ...second].join(''));

    expect(result.statements).toHaveLength(2);
    expect(result.statements[1].openingBalance?.amount).toBe('-100.00');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('CFONB statement at record 11');
  });

  it('warns about unknown record types', () => {
    const result = parseCfonb120([OPENING, rec([[1, '99']]), CLOSING].join('\n'));

    expect(result.warnings).toEqual([
      'Unknown CFONB record type "99" ignored (record 2)',
      'CFONB statement at record 1: opening balance 1000.00 + movements 0 = 1000.00 does not match closing balance 1174.50',
    ]);
  });

  it('rejects other input', () => {
    expect(() => parseCfonb120('04 movement first')).toThrow(BankStatementParseError);
  });
});
