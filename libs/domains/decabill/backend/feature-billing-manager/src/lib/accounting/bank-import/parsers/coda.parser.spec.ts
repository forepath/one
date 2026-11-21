import { BankStatementParseError } from '../bank-import.types';

import { parseCoda } from './coda.parser';

/** Builds a 128-char record by placing values at 1-based positions. */
function rec(fields: Array<[number, string]>): string {
  const chars = Array.from({ length: 128 }, () => ' ');

  for (const [start, value] of fields) {
    for (let i = 0; i < value.length; i += 1) {
      chars[start - 1 + i] = value[i];
    }
  }

  return chars.join('');
}

const HEADER = rec([
  [1, '0'],
  [2, '0000'],
  [6, '051124'],
  [12, '725'],
  [15, '05'],
  [35, 'DECABILL BV'],
  [61, 'KREDBEBB'],
  [128, '2'],
]);

function oldBalance(seq: string, amount: string, sign = '0'): string {
  return rec([
    [1, '1'],
    [2, '2'],
    [3, seq],
    [6, 'BE68539007547034'],
    [40, 'EUR'],
    [43, sign],
    [44, amount],
    [59, '041124'],
    [65, 'DECABILL BV'],
    [126, seq],
  ]);
}

function newBalance(seq: string, amount: string): string {
  return rec([
    [1, '8'],
    [2, seq],
    [5, 'BE68539007547034'],
    [39, 'EUR'],
    [42, '0'],
    [43, amount],
    [58, '051124'],
  ]);
}

const MOVEMENT_OGM = [
  rec([
    [1, '21'],
    [3, '0001'],
    [7, '0000'],
    [11, 'OL9425KR0000001'],
    [32, '0'],
    [33, '000000000250000'],
    [48, '051124'],
    [54, '00150000'],
    [62, '1'],
    [63, '101000001234526'],
    [116, '051124'],
    [122, '312'],
    [126, '1'],
    [128, '1'],
  ]),
  rec([
    [1, '22'],
    [3, '0001'],
    [7, '0000'],
    [64, 'E2E-INV-2024-0042'],
    [99, 'GEBABEBB'],
    [126, '1'],
  ]),
  rec([
    [1, '23'],
    [3, '0001'],
    [7, '0000'],
    [11, 'BE71096123456769'],
    [45, 'EUR'],
    [48, 'ACME SPRL'],
    [128, '1'],
  ]),
  rec([
    [1, '31'],
    [3, '0001'],
    [7, '0000'],
    [11, 'OL9425KR0000001'],
    [32, '00150000'],
    [40, '0'],
    [41, 'Invoice 2024-0042 thanks'],
  ]),
];
const MOVEMENT_BATCH = [
  rec([
    [1, '21'],
    [3, '0002'],
    [7, '0000'],
    [11, 'OL9425KR0000002'],
    [32, '1'],
    [33, '000000000075500'],
    [54, '10150000'],
    [62, '0'],
    [63, 'Supplier batch'],
    [116, '051124'],
  ]),
  rec([
    [1, '21'],
    [3, '0002'],
    [7, '0001'],
    [11, 'OL9425KR0000002'],
    [32, '1'],
    [33, '000000000050000'],
    [54, '50150000'],
    [62, '0'],
    [63, 'Supplier A'],
    [116, '051124'],
  ]),
  rec([
    [1, '21'],
    [3, '0002'],
    [7, '0002'],
    [11, 'OL9425KR0000002'],
    [32, '1'],
    [33, '000000000025500'],
    [54, '50150000'],
    [62, '0'],
    [63, 'Supplier B'],
    [116, '051124'],
  ]),
];
const TRAILER = rec([
  [1, '9'],
  [17, '000010'],
  [128, '2'],
]);

function file(records: string[], separator = '\r\n'): string {
  return records.join(separator);
}

const SAMPLE = [
  HEADER,
  oldBalance('312', '000000001000000'),
  ...MOVEMENT_OGM,
  ...MOVEMENT_BATCH,
  newBalance('312', '000000001174500'),
  TRAILER,
];

describe('parseCoda', () => {
  it('parses balances, account and a structured movement with continuation records', () => {
    const result = parseCoda(file(SAMPLE));

    expect(result.format).toBe('coda');
    expect(result.formatVersion).toBe('2');
    expect(result.warnings).toEqual([]);
    expect(result.statements).toHaveLength(1);

    const [statement] = result.statements;

    expect(statement.account).toEqual({ iban: 'BE68539007547034', bic: 'KREDBEBB', bankCode: '725' });
    expect(statement.currency).toBe('EUR');
    expect(statement.openingBalance).toEqual({ amount: '1000.000', currency: 'EUR', date: '2024-11-04' });
    expect(statement.closingBalance).toEqual({ amount: '1174.500', currency: 'EUR', date: '2024-11-05' });
    expect(statement.sequenceNumber).toBe('312');

    const [credit] = statement.transactions;

    expect(credit).toMatchObject({
      status: 'booked',
      bookingDate: '2024-11-05',
      valueDate: '2024-11-05',
      amount: '250.000',
      currency: 'EUR',
      isReversal: false,
      bankTransactionCode: { national: '00150000' },
      bankReference: 'OL9425KR0000001',
      isBatch: false,
      locator: 'record 3',
    });
    expect(credit.details).toEqual([
      {
        remittance: '+++000/0012/34526+++ Invoice 2024-0042 thanks',
        structuredReferences: [{ type: 'BBA', reference: '000001234526' }],
        endToEndId: 'E2E-INV-2024-0042',
        counterparty: { name: 'ACME SPRL', iban: 'BE71096123456769', bic: 'GEBABEBB' },
      },
    ]);
    expect(credit.raw?.split('\n')).toHaveLength(4);
  });

  it('maps globalised movements to a batch with detail amounts', () => {
    const batch = parseCoda(file(SAMPLE)).statements[0].transactions[1];

    expect(batch.amount).toBe('-75.500');
    expect(batch.isBatch).toBe(true);
    expect(batch.batchCount).toBe(2);
    expect(batch.bookingText).toBe('Supplier batch');
    expect(batch.valueDate).toBeUndefined();
    expect(batch.details.map((d) => [d.amount, d.remittance])).toEqual([
      ['-50.000', 'Supplier A'],
      ['-25.500', 'Supplier B'],
    ]);
  });

  it('accepts records without line breaks and with trimmed trailing spaces', () => {
    const joined = parseCoda(file(SAMPLE, ''));
    const trimmed = parseCoda(SAMPLE.map((r) => r.trimEnd()).join('\n'));

    expect(joined.statements[0].transactions).toHaveLength(2);
    expect(joined.statements[0].closingBalance?.amount).toBe('1174.500');
    expect(trimmed.statements[0].transactions[0].details[0].counterparty?.name).toBe('ACME SPRL');
  });

  it('warns when balances do not reconcile', () => {
    const result = parseCoda(
      file([HEADER, oldBalance('312', '000000001000000'), ...MOVEMENT_OGM, newBalance('312', '000000001000000')]),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('does not match closing balance 1000.000');
  });

  it('parses several statements and negative balances', () => {
    const result = parseCoda(
      file([
        HEADER,
        oldBalance('001', '000000000010000', '1'),
        newBalance('001', '000000000000000'),
        oldBalance('002', '000000001000000'),
        ...MOVEMENT_OGM,
        newBalance('002', '000000001250000'),
        TRAILER,
      ]),
    );

    expect(result.statements).toHaveLength(2);
    expect(result.statements[0].openingBalance?.amount).toBe('-10.000');
    expect(result.statements[1].transactions).toHaveLength(1);
    expect(result.warnings).toEqual([
      'CODA statement at record 2: opening balance -10.000 + movements 0 = -10.000 does not match closing balance 0.000',
    ]);
  });

  it('enforces the transaction limit', () => {
    expect(() => parseCoda(file(SAMPLE), { maxTransactions: 2, maxStatements: 10, maxLineLength: 1000 })).toThrow(
      BankStatementParseError,
    );
  });

  it('rejects non-CODA input', () => {
    expect(() => parseCoda('hello world')).toThrow(BankStatementParseError);
  });
});
