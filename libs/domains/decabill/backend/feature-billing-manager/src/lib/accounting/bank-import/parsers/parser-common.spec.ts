import { BankStatementParseError, type ParsedStatement } from '../bank-import.types';

import {
  ParseBudget,
  checkBalanceContinuity,
  finalizeDetail,
  parseLooseAmount,
  splitFixedWidthRecords,
} from './parser-common';

describe('splitFixedWidthRecords', () => {
  it('pads trimmed lines and splits records without line breaks', () => {
    expect(splitFixedWidthRecords('﻿AB\r\n\r\nCDEF  \n', 4)).toEqual([
      { text: 'AB  ', index: 1 },
      { text: 'CDEF', index: 2 },
    ]);
    expect(splitFixedWidthRecords('AAAABBBBCC\u001a', 4).map((r) => r.text)).toEqual(['AAAA', 'BBBB', 'CC  ']);
  });
});

describe('parseLooseAmount', () => {
  it('detects decimal and thousands separators', () => {
    expect(parseLooseAmount('1,234.56')).toBe('1234.56');
    expect(parseLooseAmount('-1.234,56')).toBe('-1234.56');
    expect(parseLooseAmount('12,5')).toBe('12.5');
    expect(parseLooseAmount('1,234')).toBe('1234');
    expect(parseLooseAmount('1.234.567')).toBe('1234567');
    expect(parseLooseAmount('-0.99')).toBe('-0.99');
    expect(() => parseLooseAmount('x', 'line 3')).toThrow('line 3');
  });
});

describe('finalizeDetail', () => {
  it('cleans texts, merges structured references and drops empty fields', () => {
    expect(
      finalizeDetail({
        remittance: '  RF18 5390 0754 7034\n paid ',
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
        counterparty: { name: '  ', iban: undefined },
        endToEndId: '',
      }),
    ).toEqual({
      remittance: 'RF18 5390 0754 7034 paid',
      structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
    });
  });
});

describe('checkBalanceContinuity', () => {
  const statement = (closing: string): ParsedStatement => ({
    kind: 'statement',
    account: {},
    openingBalance: { amount: '10.00', currency: 'EUR', date: '2024-11-01' },
    closingBalance: { amount: closing, currency: 'EUR', date: '2024-11-30' },
    transactions: [
      {
        status: 'booked',
        bookingDate: '2024-11-02',
        amount: '-2.50',
        currency: 'EUR',
        isReversal: false,
        isBatch: false,
        details: [],
        locator: 'x',
      },
      {
        status: 'pending',
        bookingDate: '2024-11-03',
        amount: '100',
        currency: 'EUR',
        isReversal: false,
        isBatch: false,
        details: [],
        locator: 'y',
      },
    ],
  });

  it('ignores pending entries and warns on gaps', () => {
    const warnings: string[] = [];

    checkBalanceContinuity(statement('7.50'), 'S1', warnings);
    expect(warnings).toEqual([]);

    checkBalanceContinuity(statement('7.49'), 'S2', warnings);
    expect(warnings).toEqual([
      'S2: opening balance 10.00 + movements -2.50 = 7.50 does not match closing balance 7.49',
    ]);
  });
});

describe('ParseBudget', () => {
  it('throws once a limit is exceeded', () => {
    const budget = new ParseBudget({ maxTransactions: 1, maxStatements: 1, maxLineLength: 10 });

    budget.addStatement();
    budget.addTransaction();
    expect(() => budget.addTransaction('record 9')).toThrow(BankStatementParseError);
    expect(() => budget.addStatement()).toThrow('statements');
  });
});
