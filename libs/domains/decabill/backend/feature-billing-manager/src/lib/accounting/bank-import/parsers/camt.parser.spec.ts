import { BankStatementParseError } from '../bank-import.types';

import { parseCamt } from './camt.parser';

const CAMT_053_V02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>053D2026112000001</MsgId>
      <CreDtTm>2026-11-20T06:00:00+01:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>2026-11-19-0001</Id>
      <ElctrncSeqNb>223</ElctrncSeqNb>
      <CreDtTm>2026-11-20T06:00:00+01:00</CreDtTm>
      <FrToDt>
        <FrDtTm>2026-11-19T00:00:00+01:00</FrDtTm>
        <ToDtTm>2026-11-19T23:59:59+01:00</ToDtTm>
      </FrToDt>
      <Acct>
        <Id><IBAN>DE89370400440532013000</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Svcr><FinInstnId><BIC>COBADEFFXXX</BIC></FinInstnId></Svcr>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-18</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1785.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-19</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLAV</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1785.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-19</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">1190.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-19</Dt></BookgDt>
        <ValDt><Dt>2026-11-19</Dt></ValDt>
        <AcctSvcrRef>2026111900001</AcctSvcrRef>
        <BkTxCd>
          <Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn>
          <Prtry><Cd>NTRF+166+00931</Cd><Issr>ZKA</Issr></Prtry>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>E2E-RE-2026-0042</EndToEndId>
            </Refs>
            <AmtDtls><TxAmt><Amt Ccy="EUR">1190.00</Amt></TxAmt></AmtDtls>
            <RltdPties>
              <Dbtr><Nm>Muster Handel GmbH</Nm></Dbtr>
              <DbtrAcct><Id><IBAN>DE02 1203 0000 0000 2020 51</IBAN></Id></DbtrAcct>
              <Cdtr><Nm>Decabill Demo AG</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></CdtrAcct>
            </RltdPties>
            <RltdAgts><DbtrAgt><FinInstnId><BIC>BYLADEM1001</BIC></FinInstnId></DbtrAgt></RltdAgts>
            <RmtInf><Ustrd>Rechnung RE-2026-0042</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>GUTSCHR. UEBERWEISUNG</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <NtryRef>BATCH-7781</NtryRef>
        <Amt Ccy="EUR">404.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-19</Dt></BookgDt>
        <ValDt><Dt>2026-11-19</Dt></ValDt>
        <AcctSvcrRef>2026111900002</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>NMSC+191+00931</Cd><Issr>ZKA</Issr></Prtry></BkTxCd>
        <NtryDtls>
          <Btch><NbOfTxs>2</NbOfTxs></Btch>
          <TxDtls>
            <Refs><PmtInfId>PAYRUN-2026-11</PmtInfId><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
            <AmtDtls><TxAmt><Amt Ccy="EUR">300.00</Amt></TxAmt></AmtDtls>
            <RltdPties>
              <Cdtr><Nm>Lieferant A GmbH</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>DE75512108001245126199</IBAN></Id></CdtrAcct>
            </RltdPties>
            <RmtInf>
              <Strd>
                <CdtrRefInf>
                  <Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry><Issr>ISO</Issr></Tp>
                  <Ref>RF18 5390 0754 7034</Ref>
                </CdtrRefInf>
              </Strd>
            </RmtInf>
          </TxDtls>
          <TxDtls>
            <Refs><PmtInfId>PAYRUN-2026-11</PmtInfId><EndToEndId>SUP-B-1104</EndToEndId></Refs>
            <AmtDtls><TxAmt><Amt Ccy="EUR">104.50</Amt></TxAmt></AmtDtls>
            <RltdPties>
              <Cdtr><Nm>Lieferant B</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></CdtrAcct>
              <UltmtCdtr><Nm>B Holding B.V.</Nm></UltmtCdtr>
            </RltdPties>
            <RmtInf><Ustrd>Abo November</Ustrd><Ustrd>RF712348231</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>SAMMLER-UEBERWEISUNG</AddtlNtryInf>
      </Ntry>
    </Stmt>
    <Stmt>
      <Id>2026-11-19-0002</Id>
      <LglSeqNb>12</LglSeqNb>
      <Acct>
        <Id><IBAN>DE44500105175407324931</IBAN></Id>
        <Ccy>EUR</Ccy>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">50.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-19</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">0.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-19</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-19</Dt></BookgDt>
        <ValDt><Dt>2026-11-19</Dt></ValDt>
        <BkTxCd><Prtry><Cd>NDDT+105+00992</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              <Cdtr><Nm>Stadtwerke Musterstadt</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>DE12500105170648489890</IBAN></Id></CdtrAcct>
            </RltdPties>
            <RmtInf>
              <Ustrd>EREF+INV-2026-77 MREF+M-0001 CRED+DE98ZZZ09999999999 SVWZ+Strom Abschlag 11/2026</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>FOLGELASTSCHRIFT</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
const CAMT_053_V08 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG-V08-1</MsgId><CreDtTm>2026-11-20T05:00:00Z</CreDtTm></GrpHdr>
    <Stmt>
      <Id>V08-STMT-1</Id>
      <ElctrncSeqNb>5</ElctrncSeqNb>
      <Acct>
        <Id><IBAN>DE89370400440532013000</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Svcr><FinInstnId><BICFI>COBADEFFXXX</BICFI></FinInstnId></Svcr>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">0.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-19</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">950.37</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><DtTm>2026-11-19T23:59:59Z</DtTm></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">925.37</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><DtTm>2026-11-19T10:15:00+01:00</DtTm></BookgDt>
        <ValDt><Dt>2026-11-19</Dt></ValDt>
        <AcctSvcrRef>V08-REF-1</AcctSvcrRef>
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>XBCT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>NOTPROVIDED</EndToEndId>
              <UETR>eb6305c9-1f7f-49de-aed0-16487c27b42d</UETR>
            </Refs>
            <Amt Ccy="EUR">925.37</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <AmtDtls>
              <InstdAmt>
                <Amt Ccy="USD">1000.00</Amt>
                <CcyXchg><SrcCcy>USD</SrcCcy><TrgtCcy>EUR</TrgtCcy><XchgRate>0.92537</XchgRate></CcyXchg>
              </InstdAmt>
              <TxAmt><Amt Ccy="EUR">925.37</Amt></TxAmt>
            </AmtDtls>
            <RltdPties>
              <Dbtr><Pty><Nm>ACME Corp.</Nm></Pty></Dbtr>
              <DbtrAcct><Id><Othr><Id>123456789</Id></Othr></Id></DbtrAcct>
              <UltmtDbtr><Pty><Nm>ACME Europe Ltd</Nm></Pty></UltmtDbtr>
            </RltdPties>
            <RltdAgts><DbtrAgt><FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId></DbtrAgt></RltdAgts>
            <RmtInf>
              <Strd>
                <CdtrRefInf>
                  <Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp>
                  <Ref>RF18539007547034</Ref>
                </CdtrRefInf>
              </Strd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">25.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <RvslInd>true</RvslInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-19</Dt></BookgDt>
        <ValDt><Dt>2026-11-19</Dt></ValDt>
        <AcctSvcrRef>V08-REF-2</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>DD-2026-11-0007</EndToEndId><MndtId>MAND-17</MndtId></Refs>
            <RltdPties>
              <Dbtr><Pty><Nm>Max Mustermann</Nm></Pty></Dbtr>
              <DbtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></DbtrAcct>
            </RltdPties>
            <RtrInf><Rsn><Cd>MD06</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">10.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>PDNG</Cd></Sts>
        <ValDt><Dt>2026-11-21</Dt></ValDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
const CAMT_054 = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:Document xmlns:ns2="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <ns2:BkToCstmrDbtCdtNtfctn>
    <ns2:GrpHdr><ns2:MsgId>NTF-1</ns2:MsgId><ns2:CreDtTm>2026-11-20T09:30:00</ns2:CreDtTm></ns2:GrpHdr>
    <ns2:Ntfctn>
      <ns2:Id>NTF-1-1</ns2:Id>
      <ns2:Acct><ns2:Id><ns2:IBAN>DE44500105175407324931</ns2:IBAN></ns2:Id></ns2:Acct>
      <ns2:Ntry>
        <ns2:Amt Ccy="EUR">49.99</ns2:Amt>
        <ns2:CdtDbtInd>CRDT</ns2:CdtDbtInd>
        <ns2:Sts>BOOK</ns2:Sts>
        <ns2:BookgDt><ns2:Dt>2026-11-20</ns2:Dt></ns2:BookgDt>
        <ns2:ValDt><ns2:Dt>2026-11-20</ns2:Dt></ns2:ValDt>
        <ns2:NtryDtls>
          <ns2:TxDtls>
            <ns2:Refs><ns2:EndToEndId>ORDER-1001</ns2:EndToEndId></ns2:Refs>
            <ns2:RltdPties><ns2:Dbtr><ns2:Nm>Erika Musterfrau</ns2:Nm></ns2:Dbtr></ns2:RltdPties>
            <ns2:RmtInf><ns2:Ustrd>Bestellung 1001 &amp; Versand</ns2:Ustrd></ns2:RmtInf>
          </ns2:TxDtls>
        </ns2:NtryDtls>
      </ns2:Ntry>
    </ns2:Ntfctn>
  </ns2:BkToCstmrDbtCdtNtfctn>
</ns2:Document>`;
const CAMT_052 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
  <BkToCstmrAcctRpt>
    <GrpHdr><MsgId>RPT-1</MsgId><CreDtTm>2026-11-20T12:00:00+01:00</CreDtTm></GrpHdr>
    <Rpt>
      <Id>RPT-1-1</Id>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>ITBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">100.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><DtTm>2026-11-20T08:00:00+01:00</DtTm></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>ITBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">115.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><DtTm>2026-11-20T12:00:00+01:00</DtTm></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">15.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>PDNG</Cd></Sts>
        <ValDt><Dt>2026-11-20</Dt></ValDt>
        <BkTxCd><Prtry><Cd>NMSC+201+9310</Cd></Prtry></BkTxCd>
        <AddtlNtryInf>EREF+SHOP-4711 SVWZ+Order 4711</AddtlNtryInf>
      </Ntry>
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

describe('parseCamt', () => {
  describe('camt.053.001.02 (multi-statement, batch, structured references)', () => {
    const result = parseCamt(CAMT_053_V02);

    it('detects format, version and statements', () => {
      expect(result.format).toBe('camt.053');
      expect(result.formatVersion).toBe('001.02');
      expect(result.statements).toHaveLength(2);
      expect(result.warnings).toEqual([]);
    });

    it('maps statement header, account and balances', () => {
      const { transactions, ...header } = result.statements[0];

      expect(transactions).toHaveLength(2);
      expect(header).toEqual({
        kind: 'statement',
        account: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
        currency: 'EUR',
        statementId: '2026-11-19-0001',
        sequenceNumber: '223',
        periodFrom: '2026-11-19',
        periodTo: '2026-11-19',
        openingBalance: { amount: '1000.00', currency: 'EUR', date: '2026-11-18' },
        closingBalance: { amount: '1785.50', currency: 'EUR', date: '2026-11-19' },
        availableBalance: { amount: '1785.50', currency: 'EUR', date: '2026-11-19' },
      });
    });

    it('maps a single credit transfer with counterparty and remittance', () => {
      expect(result.statements[0].transactions[0]).toEqual({
        status: 'booked',
        bookingDate: '2026-11-19',
        valueDate: '2026-11-19',
        amount: '1190.00',
        currency: 'EUR',
        isReversal: false,
        bankTransactionCode: {
          domain: 'PMNT',
          family: 'RCDT',
          subFamily: 'ESCT',
          proprietary: 'NTRF+166+00931',
          national: '166',
        },
        bookingText: 'GUTSCHR. UEBERWEISUNG',
        bankReference: '2026111900001',
        isBatch: false,
        details: [
          {
            endToEndId: 'E2E-RE-2026-0042',
            counterparty: {
              name: 'Muster Handel GmbH',
              iban: 'DE02120300000000202051',
              bic: 'BYLADEM1001',
            },
            remittance: 'Rechnung RE-2026-0042',
          },
        ],
        locator: 'Stmt[1]/Ntry[1]',
      });
    });

    it('splits a batch booking into per-transaction details', () => {
      const batch = result.statements[0].transactions[1];

      expect(batch.amount).toBe('-404.50');
      expect(batch.isBatch).toBe(true);
      expect(batch.batchCount).toBe(2);
      expect(batch.entryReference).toBe('BATCH-7781');
      expect(batch.bankTransactionCode).toEqual({ proprietary: 'NMSC+191+00931', national: '191' });
      expect(batch.locator).toBe('Stmt[1]/Ntry[2]');
      expect(batch.details).toEqual([
        {
          amount: '-300.00',
          currency: 'EUR',
          paymentInformationId: 'PAYRUN-2026-11',
          counterparty: { name: 'Lieferant A GmbH', iban: 'DE75512108001245126199' },
          structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034', issuer: 'ISO' }],
        },
        {
          amount: '-104.50',
          currency: 'EUR',
          paymentInformationId: 'PAYRUN-2026-11',
          endToEndId: 'SUP-B-1104',
          counterparty: { name: 'Lieferant B', iban: 'NL91ABNA0417164300', ultimateName: 'B Holding B.V.' },
          remittance: 'Abo November RF712348231',
          structuredReferences: [{ type: 'SCOR', reference: 'RF712348231' }],
        },
      ]);
    });

    it('parses German SEPA keywords packed into Ustrd when EndToEndId is missing', () => {
      const statement = result.statements[1];

      expect(statement.account).toEqual({ iban: 'DE44500105175407324931' });
      expect(statement.sequenceNumber).toBe('12');
      expect(statement.openingBalance).toEqual({ amount: '50.00', currency: 'EUR', date: '2026-11-19' });
      expect(statement.transactions[0].amount).toBe('-50.00');
      expect(statement.transactions[0].bankTransactionCode?.national).toBe('105');
      expect(statement.transactions[0].details).toEqual([
        {
          endToEndId: 'INV-2026-77',
          mandateId: 'M-0001',
          creditorId: 'DE98ZZZ09999999999',
          counterparty: { name: 'Stadtwerke Musterstadt', iban: 'DE12500105170648489890' },
          remittance: 'Strom Abschlag 11/2026',
        },
      ]);
    });

    it('warns when balances do not reconcile', () => {
      const broken = CAMT_053_V02.replace(
        '<Cd>CLBD</Cd></CdOrPrtry></Tp>\n        <Amt Ccy="EUR">1785.50</Amt>',
        '<Cd>CLBD</Cd></CdOrPrtry></Tp>\n        <Amt Ccy="EUR">1785.51</Amt>',
      );
      const parsed = parseCamt(broken);

      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain('Stmt[1]');
      expect(parsed.warnings[0]).toContain('1785.51');
    });
  });

  describe('camt.053.001.08', () => {
    const result = parseCamt(CAMT_053_V08);
    const [fx, reversal, pending] = result.statements[0].transactions;

    it('reads the version and v08 element variants', () => {
      expect(result.formatVersion).toBe('001.08');
      expect(result.statements[0].account).toEqual({ iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' });
      expect(result.statements[0].closingBalance).toEqual({ amount: '950.37', currency: 'EUR', date: '2026-11-19' });
      expect(result.warnings).toEqual([]);
    });

    it('maps foreign-currency details, Pty names, BICFI and structured references', () => {
      expect(fx.status).toBe('booked');
      expect(fx.bookingDate).toBe('2026-11-19');
      expect(fx.bankTransactionCode).toEqual({ domain: 'PMNT', family: 'RCDT', subFamily: 'XBCT' });
      expect(fx.details).toEqual([
        {
          originalAmount: '1000.00',
          originalCurrency: 'USD',
          exchangeRate: '0.92537',
          uetr: 'eb6305c9-1f7f-49de-aed0-16487c27b42d',
          counterparty: {
            name: 'ACME Corp.',
            accountNumber: '123456789',
            bic: 'CHASUS33XXX',
            ultimateName: 'ACME Europe Ltd',
          },
          structuredReferences: [{ type: 'SCOR', reference: 'RF18539007547034' }],
        },
      ]);
    });

    it('flags reversals and keeps the sign of the credit/debit indicator', () => {
      expect(reversal.isReversal).toBe(true);
      expect(reversal.amount).toBe('25.00');
      expect(reversal.details[0]).toMatchObject({
        endToEndId: 'DD-2026-11-0007',
        mandateId: 'MAND-17',
        returnReason: 'MD06',
        counterparty: { name: 'Max Mustermann', iban: 'DE02120300000000202051' },
      });
    });

    it('maps pending entries and falls back to the value date', () => {
      expect(pending).toMatchObject({
        status: 'pending',
        bookingDate: '2026-11-21',
        valueDate: '2026-11-21',
        amount: '-10.00',
        details: [],
        locator: 'Stmt[1]/Ntry[3]',
      });
    });
  });

  it('parses camt.054 notifications with prefixed namespaces', () => {
    const result = parseCamt(CAMT_054);

    expect(result.format).toBe('camt.054');
    expect(result.formatVersion).toBe('001.02');
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toMatchObject({
      kind: 'notification',
      statementId: 'NTF-1-1',
      account: { iban: 'DE44500105175407324931' },
      currency: 'EUR',
    });
    expect(result.statements[0].openingBalance).toBeUndefined();
    expect(result.statements[0].transactions[0]).toMatchObject({
      amount: '49.99',
      bookingDate: '2026-11-20',
      locator: 'Ntfctn[1]/Ntry[1]',
      details: [
        {
          endToEndId: 'ORDER-1001',
          counterparty: { name: 'Erika Musterfrau' },
          remittance: 'Bestellung 1001 & Versand',
        },
      ],
    });
  });

  it('parses camt.052 intraday reports with pending entries and ITBD balances', () => {
    const result = parseCamt(CAMT_052);
    const report = result.statements[0];

    expect(result.format).toBe('camt.052');
    expect(report.kind).toBe('intraday');
    expect(report.openingBalance).toEqual({ amount: '100.00', currency: 'EUR', date: '2026-11-20' });
    expect(report.closingBalance).toEqual({ amount: '115.00', currency: 'EUR', date: '2026-11-20' });
    expect(report.transactions[0]).toEqual({
      status: 'pending',
      bookingDate: '2026-11-20',
      valueDate: '2026-11-20',
      amount: '15.00',
      currency: 'EUR',
      isReversal: false,
      bankTransactionCode: { proprietary: 'NMSC+201+9310', national: '201' },
      bookingText: 'EREF+SHOP-4711 SVWZ+Order 4711',
      isBatch: false,
      details: [{ endToEndId: 'SHOP-4711', remittance: 'Order 4711' }],
      locator: 'Rpt[1]/Ntry[1]',
    });
  });

  it('rejects unknown namespaces and unsupported versions', () => {
    expect(() =>
      parseCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn/></Document>'),
    ).toThrow(/Not an ISO 20022 camt/);
    expect(() =>
      parseCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.056.001.08"><FIToFIPmtCxlReq/></Document>'),
    ).toThrow(/Unsupported camt message type/);
    expect(() =>
      parseCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.01"><BkToCstmrStmt/></Document>'),
    ).toThrow(/version 001\.01/);
    expect(() => parseCamt('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04"></Document>')).toThrow(
      /no BkToCstmrStmt/,
    );
  });

  it('rejects XXE payloads before touching entities', () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE Document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>&xxe;</Id></Stmt></BkToCstmrStmt></Document>`;

    expect(() => parseCamt(xxe)).toThrow(BankStatementParseError);
  });

  it('rejects entries with an invalid credit/debit indicator', () => {
    const invalid = CAMT_054.replace('<ns2:CdtDbtInd>CRDT</ns2:CdtDbtInd>', '<ns2:CdtDbtInd>XXXX</ns2:CdtDbtInd>');

    expect(() => parseCamt(invalid)).toThrow(/Ntfctn\[1\]\/Ntry\[1\]/);
  });

  it('enforces the transaction limit', () => {
    expect(() => parseCamt(CAMT_053_V02, { maxTransactions: 1, maxStatements: 10, maxLineLength: 1000 })).toThrow(
      /Too many/,
    );
  });
});
