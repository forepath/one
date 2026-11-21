import { BankStatementParseError } from '../bank-import.types';

import { ofxDate, parseOfx, parseOfxTree } from './ofx.parser';

const OFX_SGML = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
  '<OFX>',
  '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20241105120000[-5:EST]<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>',
  '<BANKMSGSRSV1>',
  '<STMTTRNRS>',
  '<TRNUID>1',
  '<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
  '<STMTRS>',
  '<CURDEF>EUR',
  '<BANKACCTFROM>',
  '<BANKID>37040044',
  '<ACCTID>DE89370400440532013000',
  '<ACCTTYPE>CHECKING',
  '</BANKACCTFROM>',
  '<BANKTRANLIST>',
  '<DTSTART>20241101',
  '<DTEND>20241130120000.000[-5:EST]',
  '<STMTTRN>',
  '<TRNTYPE>CREDIT',
  '<DTPOSTED>20241105120000[-5:EST]',
  '<DTUSER>20241104',
  '<TRNAMT>250,00',
  '<FITID>FIT-0001',
  '<NAME>ACME GmbH',
  '<MEMO>Invoice 2024-0042 RF18539007547034 &amp; thanks',
  '</STMTTRN>',
  '<STMTTRN>',
  '<TRNTYPE>CHECK',
  '<DTPOSTED>20241106',
  '<TRNAMT>-75.50',
  '<FITID>FIT-0002',
  '<CHECKNUM>1042',
  '<MEMO>',
  '<PAYEE><NAME>Office Supplies Inc<ADDR1>Main St 1<CITY>Springfield<STATE>IL<POSTALCODE>62701<PHONE>555</PAYEE>',
  '</STMTTRN>',
  '</BANKTRANLIST>',
  '<LEDGERBAL><BALAMT>1174.50<DTASOF>20241130</LEDGERBAL>',
  '<AVAILBAL><BALAMT>1100.00<DTASOF>20241130</AVAILBAL>',
  '</STMTRS>',
  '</STMTTRNRS>',
  '</BANKMSGSRSV1>',
  '</OFX>',
].join('\r\n');
const OFX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <STMTRS>
        <CURDEF>USD</CURDEF>
        <BANKACCTFROM><BANKID>121000248</BANKID><ACCTID>9876543210</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20241101</DTSTART><DTEND>20241130</DTEND>
          <STMTTRN>
            <TRNTYPE>DEP</TRNTYPE><DTPOSTED>20241110</DTPOSTED><TRNAMT>1,234.56</TRNAMT><FITID>X1</FITID>
            <NAME>Big Client &amp; Co</NAME><MEMO/>
          </STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL><BALAMT>1234.56</BALAMT><DTASOF>20241130</DTASOF></LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>2</TRNUID>
      <STATUS><CODE>2000</CODE><SEVERITY>ERROR</SEVERITY><MESSAGE>Partial</MESSAGE></STATUS>
      <CCSTMTRS>
        <CURDEF>EUR</CURDEF>
        <CCACCTFROM><ACCTID>4111111111111111</ACCTID></CCACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20241112</DTPOSTED><TRNAMT>-19.99</TRNAMT><FITID>CC1</FITID>
            <NAME>SaaS</NAME><ORIGCURRENCY><CURRATE>0.92</CURRATE><CURSYM>USD</CURSYM></ORIGCURRENCY>
          </STMTTRN>
          <STMTTRN>
            <CORRECTFITID>CC0</CORRECTFITID><CORRECTACTION>DELETE</CORRECTACTION>
            <TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20241112</DTPOSTED><TRNAMT>-1</TRNAMT><FITID>CC2</FITID>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

describe('ofxDate', () => {
  it('keeps the date part of OFX timestamps', () => {
    expect(ofxDate('20241105')).toBe('2024-11-05');
    expect(ofxDate('20241105235959.123[-5:EST]')).toBe('2024-11-05');
    expect(ofxDate(undefined)).toBeUndefined();
    expect(() => ofxDate('2024-11-05')).toThrow(BankStatementParseError);
  });
});

describe('parseOfxTree', () => {
  it('hoists children of unclosed SGML leaves', () => {
    const tree = parseOfxTree('<A><B><C>1</A>');
    const a = tree.children[0];

    expect(a.children.map((c) => [c.name, c.value])).toEqual([
      ['B', undefined],
      ['C', '1'],
    ]);
  });

  it('rejects DTD declarations', () => {
    expect(() => parseOfxTree('<!DOCTYPE x [<!ENTITY a "b">]><OFX/>')).toThrow(BankStatementParseError);
  });
});

describe('parseOfx', () => {
  it('parses OFX 1.x SGML statements', () => {
    const result = parseOfx(OFX_SGML);

    expect(result.format).toBe('ofx');
    expect(result.formatVersion).toBe('102');
    expect(result.warnings).toEqual([]);

    const [statement] = result.statements;

    expect(statement.account).toEqual({ iban: 'DE89370400440532013000', bankCode: '37040044' });
    expect(statement.currency).toBe('EUR');
    expect(statement.periodFrom).toBe('2024-11-01');
    expect(statement.periodTo).toBe('2024-11-30');
    expect(statement.closingBalance).toEqual({ amount: '1174.50', currency: 'EUR', date: '2024-11-30' });
    expect(statement.availableBalance).toEqual({ amount: '1100.00', currency: 'EUR', date: '2024-11-30' });

    const [credit, check] = statement.transactions;

    expect(credit).toMatchObject({
      status: 'booked',
      bookingDate: '2024-11-05',
      valueDate: '2024-11-04',
      amount: '250.00',
      currency: 'EUR',
      bookingText: 'CREDIT',
      bankTransactionCode: { national: 'CREDIT' },
      bankReference: 'FIT-0001',
      locator: 'statement 1 transaction 1',
    });
    expect(credit.details).toEqual([
      {
        remittance: 'Invoice 2024-0042 RF18539007547034 & thanks',
        counterparty: { name: 'ACME GmbH' },
        structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
      },
    ]);
    expect(credit.raw).toContain('<FITID>FIT-0001');
    expect(check).toMatchObject({ amount: '-75.50', entryReference: '1042', bankReference: 'FIT-0002' });
    expect(check.details).toEqual([{ counterparty: { name: 'Office Supplies Inc' } }]);
  });

  it('parses OFX 2.x XML with bank and credit card statements', () => {
    const result = parseOfx(OFX_XML);

    expect(result.formatVersion).toBe('220');
    expect(result.warnings).toEqual([
      'OFX statement response status 2000 Partial',
      'OFX correction (DELETE) of CC0 ignored (statement 2 transaction 2)',
    ]);
    expect(result.statements).toHaveLength(2);

    const [bank, card] = result.statements;

    expect(bank.account).toEqual({ accountNumber: '9876543210', bankCode: '121000248' });
    expect(bank.transactions[0]).toMatchObject({ amount: '1234.56', bookingDate: '2024-11-10', bankReference: 'X1' });
    expect(bank.transactions[0].details).toEqual([{ counterparty: { name: 'Big Client & Co' } }]);
    expect(card.account).toEqual({ accountNumber: '4111111111111111' });
    expect(card.currency).toBe('EUR');
    expect(card.transactions).toHaveLength(1);
    expect(card.transactions[0].details).toEqual([
      { originalCurrency: 'USD', exchangeRate: '0.92', counterparty: { name: 'SaaS' } },
    ]);
    expect(card.periodFrom).toBe('2024-11-12');
  });

  it('rejects non-OFX input and enforces limits', () => {
    expect(() => parseOfx('Date;Amount\n2024-01-01;1')).toThrow(BankStatementParseError);
    expect(() => parseOfx(OFX_XML, { maxTransactions: 100, maxStatements: 1, maxLineLength: 1000 })).toThrow(
      'statements',
    );
  });
});
