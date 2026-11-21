import { BankStatementParseError } from '../bank-import.types';

import { bai2Decimals, parseBai2 } from './bai2.parser';

const SAMPLE = [
  '01,BANKOFAM,DECABILL,241105,0200,1,,,2/',
  '02,DECABILL,BANKOFAM,1,241104,2359,USD,2/',
  '03,123456789,USD,010,100000,,,015,117450,,,045,117450,,/',
  '16,195,25000,0,BR0001,CR0001,ACH CREDIT ACME CORP, INVOICE 2024-0042/',
  '16,475,7550,V,241105,0800,BR0002,,CHECK PAID',
  '88,NO 1042',
  '16,399,0,S,0,0,0,BR0003,,ZERO/',
  '49,442450,5/',
  '98,442450,1,7/',
  '99,442450,1,9/',
].join('\r\n');

describe('bai2Decimals', () => {
  it('knows zero and three decimal currencies', () => {
    expect(bai2Decimals('USD')).toBe(2);
    expect(bai2Decimals('JPY')).toBe(0);
    expect(bai2Decimals('KWD')).toBe(3);
  });
});

describe('parseBai2', () => {
  it('parses account balances and transactions with continuation records', () => {
    const result = parseBai2(SAMPLE);

    expect(result.format).toBe('bai2');
    expect(result.formatVersion).toBe('2');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.account).toEqual({ accountNumber: '123456789' });
    expect(statement.currency).toBe('USD');
    expect(statement.openingBalance).toEqual({ amount: '1000.00', currency: 'USD', date: '2024-11-04' });
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'USD', date: '2024-11-04' });
    expect(statement.availableBalance?.amount).toBe('1174.50');

    const [credit, check, zero] = statement.transactions;

    expect(credit).toMatchObject({
      status: 'booked',
      bookingDate: '2024-11-04',
      amount: '250.00',
      bankTransactionCode: { national: '195' },
      bankReference: 'BR0001',
      entryReference: 'CR0001',
      locator: 'line 4',
    });
    expect(credit.details).toEqual([{ remittance: 'ACH CREDIT ACME CORP, INVOICE 2024-0042' }]);
    expect(check).toMatchObject({ amount: '-75.50', valueDate: '2024-11-05', bankReference: 'BR0002' });
    expect(check.entryReference).toBeUndefined();
    expect(check.details[0].remittance).toBe('CHECK PAID NO 1042');
    expect(check.raw).toBe('16,475,7550,V,241105,0800,BR0002,,CHECK PAID\n88,NO 1042');
    expect(zero).toMatchObject({ amount: '0.00', bankReference: 'BR0003' });
    expect(zero.details[0].remittance).toBe('ZERO');
  });

  it('handles 88 continuations inside account and transaction fields, distributions and several accounts', () => {
    const result = parseBai2(
      [
        '01,BANK,DECABILL,241105,0200,1,,,2/',
        '02,DECABILL,BANK,1,241104,,USD,2/',
        '03,123456789,USD,010,100000,,/',
        '88,015,110000,,/',
        '16,195,10000,D,2,0,5000',
        '88,1,5000,BR5,CR5,SPLIT FUNDS/',
        '49,210000,4/',
        '03,987654,JPY,010,5000,,/',
        '16,409,1200,0,BR9,,FEE/',
        '16,750,300,0,BR10,,LOAN/',
        '49,5000,4/',
        '98,0,2,8/',
        '99,0,1,10/',
      ].join('\n'),
    );

    expect(result.statements).toHaveLength(2);

    const [usd, jpy] = result.statements;

    expect(usd.closingBalance?.amount).toBe('1100.00');
    expect(usd.transactions[0]).toMatchObject({ amount: '100.00', bankReference: 'BR5', entryReference: 'CR5' });
    expect(usd.transactions[0].details[0].remittance).toBe('SPLIT FUNDS');
    expect(jpy.currency).toBe('JPY');
    expect(jpy.openingBalance?.amount).toBe('5000');
    expect(jpy.transactions[0].amount).toBe('-1200');
    expect(jpy.transactions[1].status).toBe('info');
    expect(result.warnings).toEqual(['Type code "750" has no credit/debit direction; kept as info entry (line 10)']);
  });

  it('warns when balances do not reconcile', () => {
    const result = parseBai2(SAMPLE.replace('015,117450', '015,117451'));

    expect(result.warnings).toEqual([
      'BAI2 account at line 3: opening balance 1000.00 + movements 174.50 = 1174.50 does not match closing balance 1174.51',
    ]);
  });

  it('rejects other input and enforces limits', () => {
    expect(() => parseBai2('16,195,100,0,,,x/')).toThrow(BankStatementParseError);
    expect(() => parseBai2(SAMPLE, { maxTransactions: 2, maxStatements: 10, maxLineLength: 1000 })).toThrow(
      'transactions',
    );
  });
});
