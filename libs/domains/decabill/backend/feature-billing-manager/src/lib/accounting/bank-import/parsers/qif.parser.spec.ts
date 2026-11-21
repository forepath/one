import { BankStatementParseError } from '../bank-import.types';

import { parseQif } from './qif.parser';

const US_SAMPLE = [
  '!Option:AutoSwitch',
  '!Account',
  'NChecking',
  'TBank',
  '^',
  '!Clear:AutoSwitch',
  '!Type:Bank',
  "D11/05'24",
  'T250.00',
  'PACME Corp',
  'MInvoice 2024-0042 RF18539007547034',
  'N1001',
  'LSales',
  'CX',
  '^',
  "D11/ 6'24",
  'T-1,075.50',
  'POffice Supplies',
  '^',
  '!Type:Cat',
  'NSales',
  'I',
  '^',
].join('\r\n');

describe('parseQif', () => {
  it('parses a US Quicken export', () => {
    const result = parseQif(US_SAMPLE, { currency: 'USD' });

    expect(result.format).toBe('qif');
    expect(result.warnings).toEqual([]);
    expect(result.statements).toHaveLength(1);

    const [statement] = result.statements;

    expect(statement.account).toEqual({});
    expect(statement.statementId).toBe('Checking');
    expect(statement.currency).toBe('USD');
    expect(statement.periodFrom).toBe('2024-11-05');
    expect(statement.periodTo).toBe('2024-11-06');

    const [credit, debit] = statement.transactions;

    expect(credit).toMatchObject({
      status: 'booked',
      bookingDate: '2024-11-05',
      amount: '250.00',
      currency: 'USD',
      bookingText: 'Sales',
      bankReference: '1001',
      locator: 'line 8',
    });
    expect(credit.details).toEqual([
      {
        remittance: 'Invoice 2024-0042 RF18539007547034',
        counterparty: { name: 'ACME Corp' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
    expect(credit.raw?.split('\n')).toHaveLength(7);
    expect(debit).toMatchObject({ bookingDate: '2024-11-06', amount: '-1075.50' });
  });

  it('detects day-first dates and decimal commas', () => {
    const result = parseQif(
      ['!Type:CCard', 'D25.12.2024', 'T-12,50', 'PCoffee', '^', 'D03.01.2025', 'U-1.234,56', '^'].join('\n'),
    );
    const [first, second] = result.statements[0].transactions;

    expect(first).toMatchObject({ bookingDate: '2024-12-25', amount: '-12.50', currency: '' });
    expect(second).toMatchObject({ bookingDate: '2025-01-03', amount: '-1234.56' });
    expect(result.statements[0].currency).toBeUndefined();
  });

  it('warns on ambiguous dates and honours an explicit order', () => {
    const text = ['!Type:Bank', 'D01/02/2024', 'T10', '^', 'D2024-03-04', 'T5', '^'].join('\n');
    const auto = parseQif(text);
    const mdy = parseQif(text, { dateFormat: 'MDY' });

    expect(auto.warnings).toEqual(['QIF date order is ambiguous; assuming day/month/year']);
    expect(auto.statements[0].transactions.map((t) => t.bookingDate)).toEqual(['2024-02-01', '2024-03-04']);
    expect(mdy.warnings).toEqual([]);
    expect(mdy.statements[0].transactions[0].bookingDate).toBe('2024-01-02');
  });

  it('turns the opening balance pseudo transaction into a balance and keeps one statement per section', () => {
    const result = parseQif(
      [
        '!Type:Bank',
        'D01/31/2024',
        'T100.00',
        'POpening Balance',
        'L[Checking]',
        '^',
        'D02/01/2024',
        'T-5.00',
        '^',
        '!Type:Cash',
        'D02/02/2024',
        'T-1.00',
        '^',
      ].join('\n'),
    );

    expect(result.statements).toHaveLength(2);
    expect(result.statements[0].openingBalance).toEqual({ amount: '100.00', currency: '', date: '2024-01-31' });
    expect(result.statements[0].transactions).toHaveLength(1);
    expect(result.statements[1].transactions[0].amount).toBe('-1.00');
  });

  it('rejects incomplete records and non-QIF input', () => {
    expect(() => parseQif(['!Type:Bank', 'T10', '^'].join('\n'))).toThrow(BankStatementParseError);
    expect(() => parseQif(['!Type:Bank', 'D13/13/2024', 'T10', '^'].join('\n'))).toThrow(BankStatementParseError);
    expect(() => parseQif('Date,Amount\n2024-01-01,1')).toThrow(BankStatementParseError);
  });
});
