jest.mock('archiver', () => ({
  ZipArchive: jest.fn().mockImplementation(() => {
    let destination: NodeJS.WritableStream | undefined;

    return {
      pipe: jest.fn((dest: NodeJS.WritableStream) => {
        destination = dest;

        return dest;
      }),
      append: jest.fn((content: Buffer, options: { name: string }) => {
        mockZipEntries.push({ name: options.name, content });
      }),
      finalize: jest.fn(async () => {
        if (destination && typeof destination.write === 'function') {
          destination.write(Buffer.from('PK'));
          destination.end();
        }
      }),
      on: jest.fn(),
    };
  }),
}));

import { BadRequestException } from '@nestjs/common';
import * as iconv from 'iconv-lite';

import { AccountingExportService } from './accounting-export.service';

const mockZipEntries: Array<{ name: string; content: Buffer }> = [];

describe('AccountingExportService', () => {
  const baseRow = {
    fiscal_year: '2026',
    posting_date: '2026-03-10',
    document_date: '2026-03-09',
    tenant_id: 'acme',
    currency: 'EUR',
    fx_rate: '1',
    original_amount: null,
    original_currency: null,
    tax_code: null,
    tax_rate: null,
    counterparty_type: null,
    counterparty_id: null,
    counterparty_name: null,
    open_item_id: null,
    locked_at: null,
    created_at: new Date('2026-03-10T08:00:00Z'),
  };
  const journalRows = [
    {
      ...baseRow,
      entry_id: 'e1',
      entry_number: 1,
      document_number: 'INV-1',
      description: 'Invoice INV-1; March',
      kind: 'automatic',
      source_type: 'invoice',
      line_no: 1,
      account_number: '1400',
      account_name: 'Receivables',
      debit: '119.00',
      credit: '0.00',
      counterparty_type: 'customer',
      counterparty_id: 'u1',
      counterparty_name: '=HYPERLINK("http://evil")',
      open_item_id: 'inv-1',
    },
    {
      ...baseRow,
      entry_id: 'e1',
      entry_number: 1,
      document_number: 'INV-1',
      description: 'Invoice INV-1; March',
      kind: 'automatic',
      source_type: 'invoice',
      line_no: 2,
      account_number: '8400',
      account_name: 'Erlöse 19%',
      debit: '0.00',
      credit: '100.00',
      tax_code: 'OUT_STD',
      tax_rate: '19.00',
    },
    {
      ...baseRow,
      entry_id: 'e1',
      entry_number: 1,
      document_number: 'INV-1',
      description: 'Invoice INV-1; March',
      kind: 'automatic',
      source_type: 'invoice',
      line_no: 3,
      account_number: '1776',
      account_name: 'VAT 19%',
      debit: '0.00',
      credit: '19.00',
      tax_code: 'OUT_STD',
      tax_rate: '19.00',
    },
    {
      ...baseRow,
      entry_id: 'e2',
      entry_number: 2,
      document_number: null,
      description: '+cmd|calc\ttab',
      kind: 'manual',
      source_type: 'manual',
      line_no: 1,
      account_number: '4900',
      account_name: '@SUM(1+1)',
      debit: '10.00',
      credit: '0.00',
      original_amount: '-10.00',
      original_currency: 'USD',
      fx_rate: '0.9',
      locked_at: new Date('2026-03-31T12:00:00Z'),
    },
    {
      ...baseRow,
      entry_id: 'e2',
      entry_number: 2,
      document_number: null,
      description: '+cmd|calc\ttab',
      kind: 'manual',
      source_type: 'manual',
      line_no: 2,
      account_number: '1200',
      account_name: 'Bank',
      debit: '0.00',
      credit: '10.00',
      locked_at: new Date('2026-03-31T12:00:00Z'),
    },
  ];
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });

      if (sql.includes('JOIN billing_accounting_fiscal_years')) return journalRows;

      if (sql.includes('JOIN billing_accounting_charts c')) {
        return [
          { chart: 'SKR03', number: '1400', name: 'Forderungen', type: 'asset', position: 'B.II.1' },
          { chart: 'SKR03', number: '8400', name: 'Erlöse', type: 'revenue', position: null },
        ];
      }

      if (sql.includes('SELECT DISTINCT a.number')) {
        return [
          {
            number: '1400',
            name: 'Receivables',
            type: 'asset',
            external_codes: { saftGroupingCategory: 'GL', saftGroupingCode: '1400-G' },
          },
          { number: '8400', name: 'Revenue', type: 'revenue', external_codes: null },
        ];
      }

      if (sql.includes('FROM billing_accounting_tax_codes tc'))
        return [{ code: 'OUT_STD', name: 'Output VAT 19%', rate: '19.00' }];

      return [];
    }),
  };
  const config = {
    isFeatureAvailable: jest.fn((_kind: string) => true),
    getFeatureAvailability: jest.fn((): Array<{ key: string; available: boolean; missing: string[] }> => []),
    getConfig: jest.fn(() => ({ functionalCurrency: 'EUR', country: 'DE', method: 'accrual' })),
  };
  const reports = { trialBalance: jest.fn() };
  const issuer = {
    getConfig: jest.fn(() => ({
      name: 'Muster <GmbH> & Co',
      vatId: 'DE123456789',
      addressLine1: 'Hauptstr. 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    })),
  };
  const service = new AccountingExportService(dataSource as never, config as never, reports as never, issuer as never);
  const journalQuery = () => queries.find((q) => q.sql.includes('JOIN billing_accounting_fiscal_years'))!;
  const previousSiren = process.env['BILLING_ISSUER_SIREN'];

  beforeEach(() => {
    jest.clearAllMocks();
    queries.length = 0;
    mockZipEntries.length = 0;
    config.isFeatureAvailable.mockImplementation(() => true);
    config.getFeatureAvailability.mockReturnValue([]);
    process.env['BILLING_ISSUER_SIREN'] = '123 456 789';
  });

  afterAll(() => {
    if (previousSiren === undefined) {
      delete process.env['BILLING_ISSUER_SIREN'];
    } else {
      process.env['BILLING_ISSUER_SIREN'] = previousSiren;
    }
  });

  describe('validation', () => {
    it('rejects malformed or inverted periods before querying', async () => {
      await expect(service.export('journal_csv', '2026-04-01', '2026-03-01', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.export('journal_csv', "2026-03-01' OR 1=1 --", '2026-03-31', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('refuses exports the profile does not make available, naming missing prerequisites', async () => {
      config.isFeatureAvailable.mockImplementation(() => false);
      config.getFeatureAvailability.mockReturnValue([
        { key: 'gdpdu', available: false, missing: ['BILLING_ISSUER_NAME'] },
      ]);

      await expect(service.export('gdpdu', '2026-03-01', '2026-03-31', null)).rejects.toThrow(
        'Export gdpdu needs: BILLING_ISSUER_NAME',
      );
      await expect(service.export('xaf', '2026-03-01', '2026-03-31', null)).rejects.toThrow(
        'Export xaf is not available for this country',
      );
      // Generic CSV exports are always available.
      await expect(service.export('journal_csv', '2026-03-01', '2026-03-31', null)).resolves.toEqual(
        expect.objectContaining({ contentType: 'text/csv; charset=utf-8' }),
      );
    });

    it('does not produce DATEV here', async () => {
      await expect(service.export('datev', '2026-03-01', '2026-03-31', null)).rejects.toThrow(/provided elsewhere/);
    });
  });

  describe('journal CSV', () => {
    it('limits rows to the period and the tenant dimension', async () => {
      await service.export('journal_csv', '2026-03-01', '2026-03-31', 'acme');

      expect(journalQuery().sql).toContain('e.posting_date >= $1 AND e.posting_date <= $2 AND e.tenant_id = $3');
      expect(journalQuery().params).toEqual(['2026-03-01', '2026-03-31', 'acme']);

      queries.length = 0;
      await service.export('journal_csv', '2026-03-01', '2026-03-31', null);

      expect(journalQuery().sql).not.toContain('e.tenant_id = $');
      expect(journalQuery().params).toEqual(['2026-03-01', '2026-03-31']);
    });

    it('writes a UTF-8 BOM, semicolon separated header and CRLF records', async () => {
      const file = await service.export('journal_csv', '2026-03-01', '2026-03-31', null);
      const text = file.content.toString('utf8');

      expect(file.fileName).toBe('journal_2026-03-01_2026-03-31.csv');
      expect(text.startsWith('﻿')).toBe(true);

      const lines = text.slice(1).split('\r\n');

      expect(lines[0].split(';')).toHaveLength(23);
      expect(
        lines[0].startsWith('fiscal_year;entry_number;posting_date;document_date;document_number;description'),
      ).toBe(true);
      expect(lines).toHaveLength(journalRows.length + 2);
      expect(lines[lines.length - 1]).toBe('');
      expect(lines[2]).toBe(
        '2026;1;2026-03-10;2026-03-09;INV-1;"Invoice INV-1; March";automatic;invoice;acme;2;8400;Erlöse 19%;0.00;100.00;EUR;;;OUT_STD;19.00;;;;',
      );
    });

    it('neutralizes spreadsheet formulas (= + - @) but keeps negative numbers', async () => {
      const file = await service.export('journal_csv', '2026-03-01', '2026-03-31', null);
      const lines = file.content.toString('utf8').slice(1).split('\r\n');

      expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
      expect(lines[1]).not.toContain(';=HYPERLINK');
      expect(lines[4]).toContain(`;'+cmd|calc\ttab;`);
      expect(lines[4]).toContain(`;'@SUM(1+1);`);
      expect(lines[4]).toContain(';-10.00;USD;');
    });
  });

  describe('trial balance CSV', () => {
    it('formats amounts with two decimals, keeps negatives and neutralizes formula names', async () => {
      reports.trialBalance.mockResolvedValue([
        {
          number: '1400',
          name: '=1+1',
          type: 'asset',
          statementPosition: null,
          opening: 0,
          debit: 119,
          credit: 0,
          closing: 119,
        },
        {
          number: '8400',
          name: 'Revenue',
          type: 'revenue',
          statementPosition: 'pl.rev',
          opening: 0,
          debit: 0,
          credit: 100.5,
          closing: -100.5,
        },
      ]);

      const file = await service.export('trial_balance_csv', '2026-03-01', '2026-03-31', 'acme');
      const lines = file.content.toString('utf8').slice(1).split('\r\n');

      expect(reports.trialBalance).toHaveBeenCalledWith('2026-03-01', '2026-03-31', 'acme');
      expect(lines.slice(0, 3)).toEqual([
        'account;name;type;statement_position;opening;debit;credit;closing',
        "1400;'=1+1;asset;;0.00;119.00;0.00;119.00",
        '8400;Revenue;revenue;pl.rev;0.00;0.00;100.50;-100.50',
      ]);
    });
  });

  describe('GDPdU', () => {
    it('zips the journal, the chart and an index.xml per the description standard', async () => {
      const file = await service.export('gdpdu', '2026-03-01', '2026-03-31', null);

      expect(file).toEqual(
        expect.objectContaining({ fileName: 'gdpdu_2026-03-01_2026-03-31.zip', contentType: 'application/zip' }),
      );
      expect(mockZipEntries.map((e) => e.name)).toEqual(['buchungsjournal.csv', 'kontenplan.csv', 'index.xml']);

      const index = mockZipEntries[2].content.toString('utf8');

      expect(index).toMatch(/<!DOCTYPE DataSet[^>]*gdpdu-01-09-2004\.dtd/);
      expect(index).toMatch(/<DataSet>\s*<Version>1\.0<\/Version>\s*<DataSupplier>/);
      expect(index).toMatch(/<Name>Muster &lt;GmbH(&gt;|>) &amp; Co<\/Name>/);
      expect(index).toMatch(/<Location>10115 Berlin<\/Location>/);
      expect(index.match(/<Table>/g)).toHaveLength(2);
      expect(index).toMatch(/<URL>buchungsjournal\.csv<\/URL>\s*<Name>Buchungsjournal<\/Name>/);
      expect(index).toMatch(/<Range>\s*<From>01\.03\.2026<\/From>\s*<To>31\.03\.2026<\/To>\s*<\/Range>/);
      expect(index).toMatch(/<DecimalSymbol>,<\/DecimalSymbol>\s*<DigitGroupingSymbol>\.<\/DigitGroupingSymbol>/);
      expect(index).toMatch(/<ColumnDelimiter>;<\/ColumnDelimiter>\s*<RecordDelimiter>&#13;&#10;<\/RecordDelimiter>/);
      expect(index).not.toContain('__CRLF__');
      expect(index).toMatch(/<VariablePrimaryKey>\s*<Name>Buchungsnummer<\/Name>\s*<Numeric\s*\/>/);
      expect(index).toMatch(/<VariableColumn>\s*<Name>Soll<\/Name>\s*<Numeric>\s*<Accuracy>2<\/Accuracy>/);
      expect(index).toMatch(/<VariableColumn>\s*<Name>Buchungsdatum<\/Name>\s*<Date>\s*<Format>DD\.MM\.YYYY<\/Format>/);
      expect(index).toMatch(/<VariablePrimaryKey>\s*<Name>Konto<\/Name>\s*<AlphaNumeric\s*\/>/);
    });

    it('writes quoted Windows-1252 CSV with German dates and decimal commas', async () => {
      await service.export('gdpdu', '2026-03-01', '2026-03-31', null);

      const journal = iconv.decode(mockZipEntries[0].content, 'win1252').split('\r\n');
      const chart = iconv.decode(mockZipEntries[1].content, 'win1252').split('\r\n');

      expect(journal[0]).toBe(
        '"2026";"1";"1";"10.03.2026";"09.03.2026";"INV-1";"Invoice INV-1; March";"1400";"119,00";"0,00";"";"";"u1";"=HYPERLINK(""http://evil"")";"inv-1";"invoice";""',
      );
      expect(journal[1]).toContain('"8400";"0,00";"100,00";"OUT_STD";"19,00"');
      expect(journal[3]).toMatch(/"31\.03\.2026"$/);
      expect(chart[0]).toBe('"SKR03";"1400";"Forderungen";"asset";"B.II.1"');
      expect(chart[1]).toBe('"SKR03";"8400";"Erlöse";"revenue";""');
    });
  });

  describe('FEC', () => {
    it('requires the 9-digit SIREN', async () => {
      process.env['BILLING_ISSUER_SIREN'] = '12345';

      await expect(service.export('fec', '2026-01-01', '2026-03-31', null)).rejects.toThrow(/9-digit SIREN/);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('writes the 18 tab-separated FEC columns in ISO-8859-15 for the whole entity', async () => {
      const file = await service.export('fec', '2026-01-01', '2026-03-31', 'acme');

      expect(file.fileName).toBe('123456789FEC20260331.txt');
      expect(file.contentType).toBe('text/plain; charset=iso-8859-15');
      // Entity-wide statutory file: never tenant-filtered.
      expect(journalQuery().params).toEqual(['2026-01-01', '2026-03-31']);

      const lines = iconv.decode(file.content, 'iso-8859-15').split('\r\n');

      expect(lines[0].split('\t')).toEqual([
        'JournalCode',
        'JournalLib',
        'EcritureNum',
        'EcritureDate',
        'CompteNum',
        'CompteLib',
        'CompAuxNum',
        'CompAuxLib',
        'PieceRef',
        'PieceDate',
        'EcritureLib',
        'Debit',
        'Credit',
        'EcritureLet',
        'DateLet',
        'ValidDate',
        'Montantdevise',
        'Idevise',
      ]);
      expect(lines.slice(1, -1).every((l) => l.split('\t').length === 18)).toBe(true);
      expect(lines[1].split('\t')).toEqual([
        'VE',
        'Ventes',
        '2026-1',
        '20260310',
        '1400',
        'Receivables',
        'u1',
        '=HYPERLINK("http://evil")',
        'INV-1',
        '20260309',
        'Invoice INV-1; March',
        '119,00',
        '0,00',
        '',
        '',
        '20260310',
        '',
        '',
      ]);
      expect(lines[2].split('\t')[5]).toBe('Erlöse 19%');

      const manual = lines[4].split('\t');

      expect(manual.slice(0, 3)).toEqual(['OD', 'Operations diverses', '2026-2']);
      // No document number → entry number as piece reference; tabs in text must not break the layout.
      expect(manual[8]).toBe('2');
      expect(manual[10]).toBe('+cmd calc tab');
      expect(manual.slice(15)).toEqual(['20260331', '10,00', 'USD']);
    });
  });

  describe('SAF-T', () => {
    it('builds the OECD 2.0 audit file with header, master files and balanced ledger entries', async () => {
      const file = await service.export('saft', '2026-03-01', '2026-03-31', null);
      const xml = file.content.toString('utf8');

      expect(file).toEqual(
        expect.objectContaining({
          fileName: 'saft_2026-03-01_2026-03-31.xml',
          contentType: 'application/xml; charset=utf-8',
        }),
      );
      expect(xml).toMatch(/<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2\.00">/);

      const header = xml.indexOf('<Header>');
      const master = xml.indexOf('<MasterFiles>');
      const entries = xml.indexOf('<GeneralLedgerEntries>');

      expect(header).toBeGreaterThan(-1);
      expect(master).toBeGreaterThan(header);
      expect(entries).toBeGreaterThan(master);
      expect(xml).toContain('<AuditFileVersion>2.00</AuditFileVersion>');
      expect(xml).toContain('<AuditFileCountry>DE</AuditFileCountry>');
      expect(xml).toContain('<DefaultCurrencyCode>EUR</DefaultCurrencyCode>');
      expect(xml).toMatch(
        /<SelectionStartDate>2026-03-01<\/SelectionStartDate>\s*<SelectionEndDate>2026-03-31<\/SelectionEndDate>/,
      );
      expect(xml).toContain('<TaxAccountingBasis>A</TaxAccountingBasis>');
      expect(xml).toContain('Muster &lt;GmbH');
      expect(xml).toMatch(
        /<AccountID>1400<\/AccountID>\s*<AccountDescription>Receivables<\/AccountDescription>\s*<GroupingCategory>GL<\/GroupingCategory>\s*<GroupingCode>1400-G<\/GroupingCode>\s*<AccountType>Balance<\/AccountType>/,
      );
      expect(xml).toMatch(
        /<AccountID>8400<\/AccountID>\s*<AccountDescription>Revenue<\/AccountDescription>\s*<AccountType>PL<\/AccountType>/,
      );
      expect(xml).toMatch(
        /<TaxCode>OUT_STD<\/TaxCode>\s*<Description>Output VAT 19%<\/Description>\s*<TaxPercentage>19\.00<\/TaxPercentage>/,
      );
      expect(xml).toMatch(
        /<NumberOfEntries>2<\/NumberOfEntries>\s*<TotalDebit>129\.00<\/TotalDebit>\s*<TotalCredit>129\.00<\/TotalCredit>/,
      );
      expect(xml.match(/<Transaction>/g)).toHaveLength(2);
      expect(xml).toMatch(
        /<TransactionID>2026-1<\/TransactionID>\s*<Period>03<\/Period>\s*<PeriodYear>2026<\/PeriodYear>/,
      );
      expect(xml).toMatch(/<AccountID>1400<\/AccountID>\s*<CustomerID>u1<\/CustomerID>/);
      expect(xml).toMatch(/<DebitAmount>\s*<Amount>119\.00<\/Amount>\s*<\/DebitAmount>/);
      expect(xml).toMatch(
        /<CreditAmount>\s*<Amount>100\.00<\/Amount>\s*<\/CreditAmount>\s*<TaxInformation>\s*<TaxType>VAT<\/TaxType>\s*<TaxCode>OUT_STD<\/TaxCode>/,
      );
      expect(xml).toMatch(
        // Amount = CurrencyAmount × ExchangeRate per line (the fixture line has 10.00 EUR for 10.00 USD).
        /<Amount>10\.00<\/Amount>\s*<CurrencyCode>USD<\/CurrencyCode>\s*<CurrencyAmount>10\.00<\/CurrencyAmount>\s*<ExchangeRate>1<\/ExchangeRate>/,
      );
      // Manual entry without document number falls back to the entry id.
      expect(xml).toContain('<SourceDocumentID>e2</SourceDocumentID>');
    });

    it('uses the period and tenant filter for the ledger entries and the cash basis flag', async () => {
      config.getConfig.mockReturnValueOnce({ functionalCurrency: 'EUR', country: 'DE', method: 'cash' });

      const file = await service.export('saft', '2026-03-01', '2026-03-31', 'acme');

      expect(journalQuery().params).toEqual(['2026-03-01', '2026-03-31', 'acme']);
      expect(file.content.toString('utf8')).toContain('<TaxAccountingBasis>C</TaxAccountingBasis>');
    });
  });

  describe('XAF', () => {
    it('builds the Dutch Auditfile Financieel 3.2 with master data and balanced journals', async () => {
      const file = await service.export('xaf', '2026-03-01', '2026-03-31', null);
      const xml = file.content.toString('utf8');

      expect(file.fileName).toBe('auditfile_2026-03-01_2026-03-31.xaf');
      expect(xml).toMatch(/<auditfile xmlns="http:\/\/www\.auditfiles\.nl\/XAF\/3\.2">/);
      expect(xml.indexOf('<header>')).toBeLessThan(xml.indexOf('<company>'));
      expect(xml).toMatch(
        /<fiscalYear>2026<\/fiscalYear>\s*<startDate>2026-03-01<\/startDate>\s*<endDate>2026-03-31<\/endDate>/,
      );
      expect(xml).toMatch(/<accID>8400<\/accID>\s*<accDesc>Revenue<\/accDesc>\s*<accTp>P<\/accTp>/);
      expect(xml).toMatch(/<accID>1400<\/accID>\s*<accDesc>Receivables<\/accDesc>\s*<accTp>B<\/accTp>/);
      expect(xml).toMatch(/<periodNumber>1<\/periodNumber>\s*<periodDesc>2026-03<\/periodDesc>/);
      expect(xml).toMatch(/<jrnID>VK<\/jrnID>\s*<desc>Verkoopboek<\/desc>\s*<jrnTp>S<\/jrnTp>/);

      const debit = Number(/<totalDebit>([\d.]+)<\/totalDebit>/.exec(xml)?.[1]);
      const credit = Number(/<totalCredit>([\d.]+)<\/totalCredit>/.exec(xml)?.[1]);

      expect(debit).toBeGreaterThan(0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(xml).toContain('<amntTp>D</amntTp>');
      expect(xml).toContain('<amntTp>C</amntTp>');
    });
  });
});
