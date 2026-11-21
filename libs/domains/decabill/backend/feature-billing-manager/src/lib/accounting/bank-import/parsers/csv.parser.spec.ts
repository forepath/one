import { BankStatementParseError, type CsvColumnMapping } from '../bank-import.types';

import { CSV_PRESETS } from './csv-presets';
import { parseCsv, parseCsvAmount, sniffDelimiter, tokenizeCsv } from './csv.parser';

function mapping(overrides: Partial<CsvColumnMapping> & Pick<CsvColumnMapping, 'columns'>): CsvColumnMapping {
  return {
    delimiter: 'auto',
    decimalSeparator: '.',
    dateFormat: 'YYYY-MM-DD',
    encoding: 'utf-8',
    hasHeader: true,
    ...overrides,
  };
}

describe('tokenizeCsv', () => {
  it('handles quotes, doubled quotes, embedded newlines and CRLF', () => {
    const rows = tokenizeCsv('a,"b ""x""",c\r\n"multi\nline",,\r\nlast', ',');

    expect(rows).toEqual([
      { fields: ['a', 'b "x"', 'c'], line: 1 },
      { fields: ['multi\nline', '', ''], line: 2 },
      { fields: ['last'], line: 4 },
    ]);
  });

  it('rejects unterminated quotes and oversized fields', () => {
    expect(() => tokenizeCsv('"open', ',')).toThrow(BankStatementParseError);
    expect(() => tokenizeCsv('abcdef', ',', 3)).toThrow(BankStatementParseError);
  });
});

describe('sniffDelimiter', () => {
  it('prefers the consistent delimiter outside quotes', () => {
    expect(sniffDelimiter('a;b;c\n"1,5";2;3\n')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(sniffDelimiter('a,b\n1,2')).toBe(',');
  });
});

describe('parseCsvAmount', () => {
  it('strips currency symbols and applies separators', () => {
    expect(parseCsvAmount('€ 1.234,50', { decimalSeparator: ',', thousandsSeparator: '.' })).toBe('1234.50');
    expect(parseCsvAmount('-12.30 EUR', { decimalSeparator: '.' })).toBe('-12.30');
    expect(parseCsvAmount('(5.00)', { decimalSeparator: '.' })).toBe('-5.00');
    expect(() => parseCsvAmount('abc', { decimalSeparator: '.' }, 'line 2')).toThrow('line 2');
  });
});

describe('parseCsv', () => {
  it('maps a custom export with debit/credit columns, sign-free amounts and skipped lines', () => {
    const text = [
      'Account export',
      'generated 2024-11-30',
      '﻿"Datum";"Soll";"Haben";"Text 1";"Text 2";"Name";"Saldo"',
      '05.11.2024;;250,00;RE 2024-0042;RF18539007547034;ACME GmbH;1.250,00',
      ';;;;;;',
      '06.11.2024;75,50;;Miete;;Vermieter;1.174,50',
    ].join('\n');
    const result = parseCsv(
      text,
      mapping({
        skipLines: 2,
        decimalSeparator: ',',
        thousandsSeparator: '.',
        dateFormat: 'DD.MM.YYYY',
        defaultCurrency: 'eur',
        columns: {
          bookingDate: 'datum',
          debit: 'Soll',
          credit: 'Haben',
          remittance: ['Text 1', 'Text 2'],
          counterpartyName: 'Name',
          balance: 'Saldo',
        },
      }),
    );

    expect(result.format).toBe('csv');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.kind).toBe('csv');
    expect(statement.account).toEqual({});
    expect(statement.currency).toBe('EUR');
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-11-06' });
    expect(statement.periodFrom).toBe('2024-11-05');
    expect(statement.transactions.map((t) => [t.bookingDate, t.amount, t.locator])).toEqual([
      ['2024-11-05', '250.00', 'line 4'],
      ['2024-11-06', '-75.50', 'line 6'],
    ]);
    expect(statement.transactions[0].details).toEqual([
      {
        remittance: 'RE 2024-0042 RF18539007547034',
        counterparty: { name: 'ACME GmbH' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
  });

  it('supports index columns, sign columns, inverted signs and pending rows', () => {
    const result = parseCsv(
      '2024-11-05|10.00|D|booked\n2024-11-06|5.00|C|PENDING\n',
      mapping({
        hasHeader: false,
        defaultCurrency: 'USD',
        invertSign: true,
        columns: {
          bookingDate: 0,
          amount: 1,
          sign: '2',
          debitIndicators: ['d'],
          status: 3,
          pendingIndicators: ['pending'],
        },
      }),
    );
    const [first, second] = result.statements[0].transactions;

    expect(first).toMatchObject({ amount: '10.00', status: 'booked', currency: 'USD' });
    expect(second).toMatchObject({ amount: '-5.00', status: 'pending' });
  });

  it('reports unparsable values with a line locator and missing columns', () => {
    const columns = { bookingDate: 'Date', amount: 'Amount' };

    expect(() => parseCsv('Date,Amount\n2024-11-05,abc', mapping({ columns }))).toThrow('(line 2)');
    expect(() => parseCsv('Date,Amount\n05.11.2024,1', mapping({ columns }))).toThrow(BankStatementParseError);
    expect(() => parseCsv('Datum,Amount\n2024-11-05,1', mapping({ columns }))).toThrow('not found');
    expect(parseCsv('Date,Amount\n2024-11-05,1', mapping({ columns: { ...columns, fee: 'Fee' } })).warnings).toEqual([
      'Optional CSV columns not found: Fee',
    ]);
  });

  it('enforces the transaction limit', () => {
    expect(() =>
      parseCsv(
        'Date,Amount\n2024-11-05,1\n2024-11-06,2',
        mapping({ columns: { bookingDate: 'Date', amount: 'Amount' } }),
        {
          maxTransactions: 1,
          maxStatements: 1,
          maxLineLength: 1000,
        },
      ),
    ).toThrow('transactions');
  });
});

const PRESET_SAMPLES: Record<string, string> = {
  'sparkasse-camt': [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    '"DE89370400440532013000";"05.11.24";"05.11.24";"GUTSCHR. UEBERWEISUNG";"RE 2024-0042";"";"";"E2E-0042";"";"";"";"ACME GmbH";"DE02120300000000202051";"BYLADEM1001";"1.250,00";"EUR";"Umsatz gebucht"',
    '"DE89370400440532013000";"06.11.24";"06.11.24";"FOLGELASTSCHRIFT";"Strom 11/2024";"DE98ZZZ09999999999";"M-123";"NOTPROVIDED";"";"";"";"Stadtwerke";"DE12500105170648489890";"INGDDEFFXXX";"-75,50";"EUR";"Umsatz vorgemerkt"',
  ].join('\r\n'),
  'sparkasse-mt940-csv': [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer";"BLZ";"Betrag";"Waehrung";"Info"',
    '"0532013000";"05.11.24";"05.11.24";"GUTSCHRIFT";"RE 2024-0042";"ACME GmbH";"0000202051";"12030000";"1.250,00";"EUR";"Umsatz gebucht"',
    '"0532013000";"06.11.24";"06.11.24";"LASTSCHRIFT";"Strom";"Stadtwerke";"0648489890";"50010517";"-75,50";"EUR";"Umsatz vorgemerkt"',
  ].join('\r\n'),
  n26: [
    '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
    '2024-11-05,2024-11-05,"ACME GmbH",DE02120300000000202051,Income,"RE 2024-0042","Main Account",1250.00,,,',
    '2024-11-06,2024-11-06,"Coffee Shop",,Presentment,"","Main Account",-75.50,-82.00,USD,1.0861',
  ].join('\n'),
  'revolut-business': [
    'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance,Account,Beneficiary account number,Beneficiary IBAN,Beneficiary BIC',
    '2024-11-05 09:12:00,2024-11-05 09:12:05,6729a1b2-0000-4000-8000-000000000001,TRANSFER,COMPLETED,Payment from ACME,RE 2024-0042,ACME GmbH,,EUR,1250.00,EUR,1250.00,0.00,2250.00,Main,,,',
    '2024-11-06 10:00:00,,6729a1b2-0000-4000-8000-000000000002,CARD_PAYMENT,PENDING,Coffee,,,"411111******1111",EUR,-75.50,EUR,-75.50,0.00,,Main,,,',
  ].join('\n'),
  wise: [
    '"TransferWise ID",Date,Amount,Currency,Description,"Payment Reference","Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees"',
    'CARD-98765,06-11-2024,-75.50,EUR,"Card transaction of 75.50 EUR issued by Cloud Inc",,2174.50,,,,,,,"Cloud Inc",1111,"Jane Doe",,,0.00',
    'TRANSFER-123456,05-11-2024,1250.00,EUR,"Received money from ACME GmbH","RE 2024-0042",2250.00,,,,"ACME GmbH",,,,,,,,0.00',
  ].join('\n'),
  qonto: [
    'Transaction ID;Status;Settlement date;Operation date;Counterparty name;Payment method;Amount (incl. VAT);Currency;Reference;IBAN',
    'txn_001;completed;05-11-2024 10:00:00;05-11-2024 09:58:00;ACME GmbH;transfer;1250.00;EUR;RE 2024-0042;FR1420041010050500013M02606',
    'txn_002;pending;06-11-2024;06-11-2024;Cloud Inc;card;-75.50;EUR;;',
  ].join('\n'),
  paypal: [
    '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Reference Txn ID","Invoice Number","Subject","Note"',
    '"05/11/2024","10:22:11","CET","ACME GmbH","Express Checkout Payment","Completed","EUR","1,286.60","-36.60","1,250.00","buyer@example.com","shop@example.com","1AB23456CD789012E","","RE 2024-0042","Invoice RE 2024-0042",""',
    '"06/11/2024","08:00:00","CET","Cloud Inc","eCheck Sent","Pending","EUR","-75.50","0.00","-75.50","shop@example.com","billing@example.com","9ZZ00000000000000","","","",""',
  ].join('\n'),
  'stripe-payout-reconciliation': [
    'automatic_payout_id,automatic_payout_effective_at,balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,source_id,description,customer_facing_amount,customer_facing_currency,customer_name,payment_metadata[invoice_id]',
    'po_1QAbc,2024-11-05 00:00:00,txn_1QAbc1,2024-11-03 10:22:11,2024-11-05 00:00:00,eur,1286.60,-36.60,1250.00,charge,ch_3QAbc,Invoice RE 2024-0042,1286.60,eur,ACME GmbH,in_1QAbc',
    'po_1QAbc,2024-11-06 00:00:00,txn_1QAbc2,2024-11-04 08:00:00,2024-11-06 00:00:00,eur,-75.50,0.00,-75.50,refund,re_3QAbc,Refund,-75.50,eur,Cloud Inc,',
  ].join('\n'),
  'mollie-settlement': [
    'ID,Date,Payment method,Currency,Amount,Status,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded',
    'tr_WDqYK6vllg,2024-11-05 10:22:11,ideal,EUR,1250.00,paid,RE 2024-0042,ACME GmbH,NL91ABNA0417164300,ABNANL2A,EUR,1250.00,1234567.2411.01,0.00',
    'tr_7UhSN1zuXS,2024-11-06 08:00:00,creditcard,EUR,-75.50,open,Refund,,,,EUR,,,0.00',
  ].join('\n'),
  'adyen-settlement-details': [
    'Company Account,Merchant Account,Psp Reference,Merchant Reference,Payment Method,Creation Date,TimeZone,Type,Modification Reference,Gross Currency,Gross Debit (GC),Gross Credit (GC),Exchange Rate,Net Currency,Net Debit (NC),Net Credit (NC),Commission (NC),Markup (NC),Scheme Fees (NC),Interchange (NC),Payment Method Variant,Modification Merchant Reference,Batch Number',
    'DecabillCOM,DecabillEUR,8815302345678901,RE 2024-0042,visa,2024-11-05 10:22:11,CET,Settled,8815302345678901,EUR,,1286.60,1,EUR,,1250.00,0.50,,0.40,35.70,visacredit,,42',
    'DecabillCOM,DecabillEUR,8815302345678902,RE 2024-0040,mc,2024-11-06 11:00:00,CET,Refunded,8825302345678902,EUR,75.50,,1,EUR,75.50,,,,,,mccredit,,42',
  ].join('\n'),
};

describe('CSV_PRESETS', () => {
  it('has a sample for every preset', () => {
    expect(Object.keys(PRESET_SAMPLES).sort()).toEqual(Object.keys(CSV_PRESETS).sort());
  });

  it.each(Object.keys(PRESET_SAMPLES))('parses a %s sample', (key) => {
    const result = parseCsv(PRESET_SAMPLES[key], CSV_PRESETS[key].mapping);
    const transactions = result.statements[0].transactions;

    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.amount).sort()).toEqual(['-75.50', '1250.00']);
    expect(transactions.every((t) => t.currency === 'EUR')).toBe(true);

    const incoming = transactions.find((t) => t.amount === '1250.00');

    expect(incoming?.bookingDate).toBe('2024-11-05');
    expect(incoming?.status).toBe('booked');
    expect(incoming?.details[0].remittance ?? incoming?.details[0].processor?.merchantReference).toContain(
      key === 'stripe-payout-reconciliation' ? 'Invoice RE 2024-0042' : 'RE 2024-0042',
    );
  });

  it('maps bank-specific fields', () => {
    const sparkasse = parseCsv(PRESET_SAMPLES['sparkasse-camt'], CSV_PRESETS['sparkasse-camt'].mapping);
    const [credit, debit] = sparkasse.statements[0].transactions;

    expect(credit.details[0]).toMatchObject({
      endToEndId: 'E2E-0042',
      counterparty: { name: 'ACME GmbH', iban: 'DE02120300000000202051', bic: 'BYLADEM1001' },
    });
    expect(credit.valueDate).toBe('2024-11-05');
    expect(debit).toMatchObject({ status: 'pending', bookingText: 'FOLGELASTSCHRIFT' });
    expect(debit.details[0]).toMatchObject({ mandateId: 'M-123', creditorId: 'DE98ZZZ09999999999' });
    expect(debit.details[0].endToEndId).toBeUndefined();

    const mt940 = parseCsv(PRESET_SAMPLES['sparkasse-mt940-csv'], CSV_PRESETS['sparkasse-mt940-csv'].mapping);

    expect(mt940.statements[0].transactions[0].details[0].counterparty).toEqual({
      name: 'ACME GmbH',
      accountNumber: '0000202051',
    });

    const revolut = parseCsv(PRESET_SAMPLES['revolut-business'], CSV_PRESETS['revolut-business'].mapping);

    expect(revolut.statements[0].transactions[1]).toMatchObject({ status: 'pending', valueDate: undefined });
    expect(revolut.statements[0].closingBalance).toEqual({ amount: '2250.00', currency: 'EUR', date: '2024-11-05' });

    const wise = parseCsv(PRESET_SAMPLES.wise, CSV_PRESETS.wise.mapping);

    expect(wise.statements[0].closingBalance).toEqual({ amount: '2174.50', currency: 'EUR', date: '2024-11-06' });

    const qonto = parseCsv(PRESET_SAMPLES.qonto, CSV_PRESETS.qonto.mapping);

    expect(qonto.statements[0].transactions[0].details[0].counterparty?.iban).toBe('FR1420041010050500013M02606');
    expect(qonto.statements[0].transactions[1].status).toBe('pending');
  });

  it('maps processor fields', () => {
    const paypal = parseCsv(PRESET_SAMPLES.paypal, CSV_PRESETS.paypal.mapping);

    expect(paypal.statements[0].transactions[0].details[0].processor).toEqual({
      provider: 'paypal',
      gross: '1286.60',
      fee: '-36.60',
      net: '1250.00',
      merchantReference: 'RE 2024-0042',
    });
    expect(paypal.statements[0].transactions[1].status).toBe('pending');

    const stripe = parseCsv(
      PRESET_SAMPLES['stripe-payout-reconciliation'],
      CSV_PRESETS['stripe-payout-reconciliation'].mapping,
    );

    expect(stripe.warnings).toEqual([]);
    expect(stripe.statements[0].transactions[0]).toMatchObject({
      bankReference: 'txn_1QAbc1',
      valueDate: '2024-11-05',
    });
    expect(stripe.statements[0].transactions[0].details[0].processor).toEqual({
      provider: 'stripe',
      payoutId: 'po_1QAbc',
      gross: '1286.60',
      fee: '-36.60',
      net: '1250.00',
      merchantReference: 'in_1QAbc',
      category: 'charge',
    });

    const mollie = parseCsv(PRESET_SAMPLES['mollie-settlement'], CSV_PRESETS['mollie-settlement'].mapping);

    expect(mollie.statements[0].transactions[0].details[0]).toMatchObject({
      counterparty: { name: 'ACME GmbH', iban: 'NL91ABNA0417164300', bic: 'ABNANL2A' },
      processor: { provider: 'mollie', payoutId: '1234567.2411.01' },
    });
    expect(mollie.statements[0].transactions[1].status).toBe('pending');

    const adyen = parseCsv(PRESET_SAMPLES['adyen-settlement-details'], CSV_PRESETS['adyen-settlement-details'].mapping);

    expect(adyen.statements[0].transactions[0].details[0].processor).toEqual({
      provider: 'adyen',
      fee: '0.50',
      net: '1250.00',
      payoutId: '42',
      merchantReference: 'RE 2024-0042',
      category: 'visa',
    });
  });
});
