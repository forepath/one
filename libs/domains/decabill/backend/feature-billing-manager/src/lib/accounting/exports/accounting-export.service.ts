import { PassThrough } from 'stream';

import { BadRequestException, Injectable } from '@nestjs/common';
import { ZipArchive } from 'archiver';
import * as iconv from 'iconv-lite';
import { DataSource } from 'typeorm';
import { create } from 'xmlbuilder2';

import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { neutralizeCsvCell } from '../bank-import/parsers/csv-injection.util';
import type { AccountingExportKind } from '../profiles/accounting-profile.types';
import { AccountingConfigService } from '../services/accounting-config.service';
import { AccountingReportsService, type TenantFilter } from '../services/accounting-reports.service';

export interface ExportFile {
  fileName: string;
  contentType: string;
  content: Buffer;
}

interface JournalRow {
  entry_id: string;
  entry_number: number;
  fiscal_year: string;
  posting_date: string;
  document_date: string;
  document_number: string | null;
  description: string;
  kind: string;
  source_type: string;
  tenant_id: string | null;
  currency: string;
  fx_rate: string;
  line_no: number;
  account_number: string;
  account_name: string;
  debit: string;
  credit: string;
  original_amount: string | null;
  original_currency: string | null;
  tax_code: string | null;
  tax_rate: string | null;
  counterparty_type: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  open_item_id: string | null;
  locked_at: Date | null;
  created_at: Date;
}

const SOURCE_JOURNAL_CODES: Record<string, [string, string]> = {
  invoice: ['VE', 'Ventes'],
  credit_document: ['VE', 'Ventes'],
  supplier_invoice: ['AC', 'Achats'],
  settlement: ['BQ', 'Banque'],
  bank_transaction: ['BQ', 'Banque'],
  processor_transaction: ['BQ', 'Banque'],
  opening_balance: ['AN', 'A nouveaux'],
  fiscal_year: ['AN', 'A nouveaux'],
};

/**
 * Ledger exports: journal / trial balance CSV, GoBD data access (GDPdU description standard, CSV + index.xml),
 * France FEC (Fichier des Écritures Comptables) and OECD SAF-T 2.0 (generic profile).
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly reports: AccountingReportsService,
    private readonly issuer: BillingIssuerConfigService,
  ) {}

  async export(kind: AccountingExportKind, from: string, to: string, tenant: TenantFilter): Promise<ExportFile> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new BadRequestException('Invalid date range');
    }

    if (kind !== 'journal_csv' && kind !== 'trial_balance_csv' && !this.config.isFeatureAvailable(kind)) {
      const missing = this.config.getFeatureAvailability().find((f) => f.key === kind)?.missing ?? [];

      throw new BadRequestException(
        missing.length
          ? `Export ${kind} needs: ${missing.join(', ')}`
          : `Export ${kind} is not available for this country`,
      );
    }

    switch (kind) {
      case 'journal_csv':
        return this.journalCsv(await this.journalRows(from, to, tenant), from, to);
      case 'trial_balance_csv':
        return await this.trialBalanceCsv(from, to, tenant);
      case 'gdpdu':
        return await this.gdpdu(from, to, tenant);
      case 'fec':
        return await this.fec(from, to);
      case 'saft':
        return await this.saft(from, to, tenant);
      case 'xaf':
        return await this.xaf(from, to, tenant);
      default:
        throw new BadRequestException(`Export ${kind} is provided elsewhere (DATEV export) or not supported`);
    }
  }

  async journalRows(from: string, to: string, tenant: TenantFilter): Promise<JournalRow[]> {
    const params: unknown[] = [from, to];
    const tenantSql = tenant !== null ? `AND e.tenant_id = $${params.push(tenant)}` : '';

    return await this.dataSource.query(
      `SELECT e.id AS entry_id, e.entry_number, y.name AS fiscal_year, e.posting_date::text, e.document_date::text,
              e.document_number, e.description, e.kind, e.source_type, e.tenant_id, e.currency, e.fx_rate::text,
              l.line_no, a.number AS account_number, a.name AS account_name, l.debit::text, l.credit::text,
              l.original_amount::text, l.original_currency, tc.code AS tax_code, l.tax_rate::text,
              l.counterparty_type, l.counterparty_id,
              COALESCE(NULLIF(cp.company, ''), TRIM(CONCAT(cp.first_name, ' ', cp.last_name)),
                       NULLIF(sp.company, ''), TRIM(CONCAT(sp.first_name, ' ', sp.last_name))) AS counterparty_name,
              l.open_item_id, p.locked_at, e.created_at
       FROM billing_accounting_journal_entries e
       JOIN billing_accounting_fiscal_years y ON y.id = e.fiscal_year_id
       JOIN billing_accounting_periods p ON p.id = e.period_id
       JOIN billing_accounting_journal_lines l ON l.entry_id = e.id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       LEFT JOIN billing_accounting_tax_codes tc ON tc.id = l.tax_code_id
       LEFT JOIN billing_customer_profiles cp ON l.counterparty_type = 'customer' AND cp.user_id::text = l.counterparty_id
       LEFT JOIN billing_supplier_profiles sp ON l.counterparty_type = 'supplier' AND sp.id::text = l.counterparty_id
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 ${tenantSql}
       ORDER BY e.posting_date, y.start_date, e.entry_number, l.line_no`,
      params,
    );
  }

  private journalCsv(rows: JournalRow[], from: string, to: string): ExportFile {
    const header = [
      'fiscal_year',
      'entry_number',
      'posting_date',
      'document_date',
      'document_number',
      'description',
      'kind',
      'source_type',
      'tenant',
      'line',
      'account',
      'account_name',
      'debit',
      'credit',
      'currency',
      'original_amount',
      'original_currency',
      'tax_code',
      'tax_rate',
      'counterparty_type',
      'counterparty',
      'counterparty_name',
      'open_item',
    ];
    const lines = rows.map((r) =>
      [
        r.fiscal_year,
        r.entry_number,
        r.posting_date,
        r.document_date,
        r.document_number ?? '',
        r.description,
        r.kind,
        r.source_type,
        r.tenant_id ?? '',
        r.line_no,
        r.account_number,
        r.account_name,
        r.debit,
        r.credit,
        this.config.getConfig().functionalCurrency,
        r.original_amount ?? '',
        r.original_currency ?? '',
        r.tax_code ?? '',
        r.tax_rate ?? '',
        r.counterparty_type ?? '',
        r.counterparty_id ?? '',
        r.counterparty_name ?? '',
        r.open_item_id ?? '',
      ].map((v) => this.csvCell(String(v))),
    );

    return {
      fileName: `journal_${from}_${to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: Buffer.from(`\uFEFF${[header.join(';'), ...lines.map((l) => l.join(';'))].join('\r\n')}\r\n`, 'utf8'),
    };
  }

  private async trialBalanceCsv(from: string, to: string, tenant: TenantFilter): Promise<ExportFile> {
    const rows = await this.reports.trialBalance(from, to, tenant);
    const header = ['account', 'name', 'type', 'statement_position', 'opening', 'debit', 'credit', 'closing'];
    const lines = rows.map((r) =>
      [
        r.number,
        r.name,
        r.type,
        r.statementPosition ?? '',
        r.opening.toFixed(2),
        r.debit.toFixed(2),
        r.credit.toFixed(2),
        r.closing.toFixed(2),
      ].map((v) => this.csvCell(v)),
    );

    return {
      fileName: `trial_balance_${from}_${to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: Buffer.from(`\uFEFF${[header.join(';'), ...lines.map((l) => l.join(';'))].join('\r\n')}\r\n`, 'utf8'),
    };
  }

  /** GoBD Datenträgerüberlassung (Z3): CSV tables + index.xml per the GDPdU description standard. */
  private async gdpdu(from: string, to: string, tenant: TenantFilter): Promise<ExportFile> {
    const rows = await this.journalRows(from, to, tenant);
    const de = (v: string | number | null) => (v === null ? '' : String(v).replace('.', ','));
    const date = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const journal = rows.map((r) =>
      [
        r.fiscal_year,
        r.entry_number,
        r.line_no,
        date(r.posting_date),
        date(r.document_date),
        r.document_number ?? '',
        r.description,
        r.account_number,
        de(r.debit),
        de(r.credit),
        r.tax_code ?? '',
        de(r.tax_rate),
        r.counterparty_id ?? '',
        r.counterparty_name ?? '',
        r.open_item_id ?? '',
        r.source_type,
        r.locked_at ? date(new Date(r.locked_at).toISOString().slice(0, 10)) : '',
      ]
        .map((v) => this.gdpduCell(String(v)))
        .join(';'),
    );
    const accounts: Array<{ number: string; name: string; type: string; position: string | null; chart: string }> =
      await this.dataSource.query(
        `SELECT a.number, a.name, a.type, a.statement_position AS position, c.code AS chart
       FROM billing_accounting_accounts a JOIN billing_accounting_charts c ON c.id = a.chart_id ORDER BY c.code, a.number`,
      );
    const accountCsv = accounts.map((a) =>
      [a.chart, a.number, a.name, a.type, a.position ?? ''].map((v) => this.gdpduCell(v)).join(';'),
    );
    const tables = [
      {
        file: 'buchungsjournal.csv',
        name: 'Buchungsjournal',
        // Entry numbers restart per fiscal year and an entry has several lines: the record key is year + number + line.
        keys: ['Wirtschaftsjahr', 'Buchungsnummer', 'Zeile'],
        columns: [
          ['Wirtschaftsjahr', 'a'],
          ['Buchungsnummer', 'n'],
          ['Zeile', 'n'],
          ['Buchungsdatum', 'd'],
          ['Belegdatum', 'd'],
          ['Belegnummer', 'a'],
          ['Buchungstext', 'a'],
          ['Konto', 'a'],
          ['Soll', 'm'],
          ['Haben', 'm'],
          ['Steuerschluessel', 'a'],
          ['Steuersatz', 'm'],
          ['Personenkonto', 'a'],
          ['Name', 'a'],
          ['OffenerPosten', 'a'],
          ['Herkunft', 'a'],
          ['Festgeschrieben', 'd'],
        ] as Array<[string, 'a' | 'n' | 'd' | 'm']>,
        content: journal,
      },
      {
        file: 'kontenplan.csv',
        name: 'Kontenplan',
        keys: ['Kontenrahmen', 'Konto'],
        columns: [
          ['Kontenrahmen', 'a'],
          ['Konto', 'a'],
          ['Bezeichnung', 'a'],
          ['Kontoart', 'a'],
          ['Bilanzposition', 'a'],
        ] as Array<[string, 'a' | 'n' | 'd' | 'm']>,
        content: accountCsv,
      },
    ];
    const issuer = this.issuer.getConfig();
    const index = create({ version: '1.0', encoding: 'UTF-8' })
      .dtd({ name: 'DataSet', sysID: 'gdpdu-01-09-2004.dtd' })
      .ele('DataSet');

    index.ele('Version').txt('1.0');

    const supplier = index.ele('DataSupplier');

    supplier.ele('Name').txt(issuer.name || 'Decabill');
    supplier.ele('Location').txt([issuer.postalCode, issuer.city].filter(Boolean).join(' ') || '-');
    supplier.ele('Comment').txt(`Decabill accounting export ${from} – ${to}`);

    const media = index.ele('Media');

    media.ele('Name').txt('Export 1');

    for (const table of tables) {
      const t = media.ele('Table');

      t.ele('URL').txt(table.file);
      t.ele('Name').txt(table.name);

      const validity = t.ele('Validity');
      const range = validity.ele('Range');

      range.ele('From').txt(date(from));
      range.ele('To').txt(date(to));
      validity.ele('Format').txt('DD.MM.YYYY');
      t.ele('DecimalSymbol').txt(',');
      t.ele('DigitGroupingSymbol').txt('.');

      const vl = t.ele('VariableLength');

      vl.ele('ColumnDelimiter').txt(';');
      vl.ele('RecordDelimiter').txt('__CRLF__');
      vl.ele('TextEncapsulator').txt('"');

      // The DTD lists primary keys before the other columns; the CSV starts with the key columns in the same order.
      for (const [name, type] of table.columns) {
        const col = vl.ele(table.keys.includes(name) ? 'VariablePrimaryKey' : 'VariableColumn');

        col.ele('Name').txt(name);

        if (type === 'n') {
          col.ele('Numeric');
        } else if (type === 'm') {
          col.ele('Numeric').ele('Accuracy').txt('2');
        } else if (type === 'd') {
          col.ele('Date').ele('Format').txt('DD.MM.YYYY');
        } else {
          col.ele('AlphaNumeric');
        }
      }
    }

    const files = [
      ...tables.map((t) => ({ name: t.file, content: iconv.encode(`${t.content.join('\r\n')}\r\n`, 'win1252') })),
      {
        name: 'index.xml',
        content: Buffer.from(index.end({ prettyPrint: true }).replace(/__CRLF__/g, '&#13;&#10;'), 'utf8'),
      },
    ];

    return {
      fileName: `gdpdu_${from}_${to}.zip`,
      contentType: 'application/zip',
      content: await this.zip(files),
    };
  }

  /** France: FEC (art. A47 A-1 LPF), 18 tab-separated columns, file `SIRENFECAAAAMMJJ.txt`. */
  private async fec(from: string, to: string): Promise<ExportFile> {
    const siren = (process.env.BILLING_ISSUER_SIREN ?? '').replace(/\s/g, '');

    if (!/^\d{9}$/.test(siren)) {
      throw new BadRequestException('BILLING_ISSUER_SIREN must be the 9-digit SIREN');
    }

    const rows = await this.journalRows(from, to, null);
    const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
    const amount = (v: string | null) =>
      Number(v ?? 0)
        .toFixed(2)
        .replace('.', ',');
    const clean = (v: string | null | undefined) => (v ?? '').replace(/[\t\r\n|]/g, ' ').trim();
    const header = [
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
    ];
    const lines = rows.map((r) => {
      const [code, lib] = SOURCE_JOURNAL_CODES[r.source_type] ?? ['OD', 'Operations diverses'];

      return [
        code,
        lib,
        `${r.fiscal_year}-${r.entry_number}`,
        ymd(r.posting_date),
        r.account_number,
        clean(r.account_name),
        r.counterparty_id ? clean(r.counterparty_id) : '',
        clean(r.counterparty_name),
        clean(r.document_number) || `${r.entry_number}`,
        ymd(r.document_date),
        clean(r.description),
        amount(r.debit),
        amount(r.credit),
        '',
        '',
        r.locked_at ? ymd(new Date(r.locked_at).toISOString()) : ymd(new Date(r.created_at).toISOString()),
        r.original_amount ? Math.abs(Number(r.original_amount)).toFixed(2).replace('.', ',') : '',
        r.original_currency ?? '',
      ].join('\t');
    });

    return {
      fileName: `${siren}FEC${ymd(to)}.txt`,
      contentType: 'text/plain; charset=iso-8859-15',
      content: iconv.encode(`${[header.join('\t'), ...lines].join('\r\n')}\r\n`, 'iso-8859-15'),
    };
  }

  /** OECD SAF-T 2.0 (generic profile): header, general-ledger accounts, tax table and entries. */
  /**
   * Dutch XML Auditfile Financieel 3.2 (Belastingdienst audit file): header, company master data (customers /
   * suppliers, general ledger, VAT codes, periods) and the transactions grouped into journals by source.
   */
  private async xaf(from: string, to: string, tenant: TenantFilter): Promise<ExportFile> {
    const rows = await this.journalRows(from, to, tenant);
    const issuer = this.issuer.getConfig();
    const cfg = this.config.getConfig();
    const accounts: Array<{ number: string; name: string; type: string }> = await this.dataSource.query(
      `SELECT DISTINCT a.number, a.name, a.type FROM billing_accounting_accounts a
         JOIN billing_accounting_journal_lines l ON l.account_id = a.id ORDER BY a.number`,
    );
    const vatCodes = new Map<string, string>();
    const parties = new Map<string, { name: string; type: 'C' | 'S' }>();

    for (const r of rows) {
      if (r.tax_code) vatCodes.set(r.tax_code, r.tax_rate ? `${Number(r.tax_rate)} %` : r.tax_code);

      if (r.counterparty_id && (r.counterparty_type === 'customer' || r.counterparty_type === 'supplier')) {
        parties.set(r.counterparty_id, {
          name: r.counterparty_name ?? r.counterparty_id,
          type: r.counterparty_type === 'customer' ? 'C' : 'S',
        });
      }
    }

    const amount = (v: number): string => v.toFixed(2);
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('http://www.auditfiles.nl/XAF/3.2', 'auditfile');
    const header = doc.ele('header');

    header.ele('fiscalYear').txt(from.slice(0, 4));
    header.ele('startDate').txt(from);
    header.ele('endDate').txt(to);
    header.ele('curCode').txt(cfg.functionalCurrency);
    header.ele('dateCreated').txt(new Date().toISOString().slice(0, 10));
    header.ele('softwareDesc').txt('Decabill');
    header.ele('softwareVersion').txt('1');

    const company = doc.ele('company');

    company.ele('companyName').txt((issuer.name || '-').slice(0, 255));
    company.ele('taxRegistrationCountry').txt((issuer.country || 'NL').slice(0, 2));
    company.ele('taxRegIdent').txt(issuer.vatId || '-');

    const address = company.ele('streetAddress');

    address.ele('streetname').txt(issuer.addressLine1 || '-');
    address.ele('city').txt(issuer.city || '-');
    address.ele('postalCode').txt(issuer.postalCode || '-');
    address.ele('country').txt((issuer.country || 'NL').slice(0, 2));

    if (parties.size > 0) {
      const list = company.ele('customersSuppliers');

      for (const [id, party] of parties) {
        const cs = list.ele('customerSupplier');

        cs.ele('custSupID').txt(id);
        cs.ele('custSupName').txt(party.name.slice(0, 255));
        cs.ele('custSupTp').txt(party.type);
      }
    }

    const gl = company.ele('generalLedger');

    for (const a of accounts) {
      const acc = gl.ele('ledgerAccount');

      acc.ele('accID').txt(a.number);
      acc.ele('accDesc').txt(a.name.slice(0, 255));
      // B = balance sheet, P = profit and loss.
      acc.ele('accTp').txt(a.type === 'revenue' || a.type === 'expense' ? 'P' : 'B');
    }

    if (vatCodes.size > 0) {
      const vat = company.ele('vatCodes');

      for (const [code, desc] of vatCodes) {
        const v = vat.ele('vatCode');

        v.ele('vatID').txt(code);
        v.ele('vatDesc').txt(desc);
      }
    }

    // Calendar months of the selection as periods.
    const periods = company.ele('periods');
    const periodOf = (date: string): number =>
      (Number(date.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      Number(date.slice(5, 7)) -
      Number(from.slice(5, 7)) +
      1;

    for (let start = `${from.slice(0, 7)}-01`, n = 1; start <= to; n += 1) {
      const next = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1));
      const end = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
      const period = periods.ele('period');

      period.ele('periodNumber').txt(String(n));
      period.ele('periodDesc').txt(start.slice(0, 7));
      period.ele('startDatePeriod').txt(start < from ? from : start);
      period.ele('endDatePeriod').txt(end > to ? to : end);
      start = next.toISOString().slice(0, 10);
    }

    const transactions = company.ele('transactions');
    const totalDebit = rows.reduce((sum, r) => sum + Number(r.debit), 0);
    const totalCredit = rows.reduce((sum, r) => sum + Number(r.credit), 0);

    transactions.ele('linesCount').txt(String(rows.length));
    transactions.ele('totalDebit').txt(amount(totalDebit));
    transactions.ele('totalCredit').txt(amount(totalCredit));

    // XAF journal types: S sales, P purchases, B bank, O opening balance, M memorial (everything else).
    const journalOf = (sourceType: string): { id: string; desc: string; type: string } => {
      if (sourceType === 'invoice' || sourceType === 'credit_document' || sourceType === 'void_document') {
        return { id: 'VK', desc: 'Verkoopboek', type: 'S' };
      }

      if (sourceType === 'supplier_invoice') return { id: 'IK', desc: 'Inkoopboek', type: 'P' };

      if (sourceType === 'settlement' || sourceType === 'bank_transaction' || sourceType === 'processor_transaction') {
        return { id: 'BK', desc: 'Bankboek', type: 'B' };
      }

      if (sourceType === 'opening_balance' || sourceType === 'fiscal_year')
        return { id: 'BG', desc: 'Beginbalans', type: 'O' };

      return { id: 'MM', desc: 'Memoriaal', type: 'M' };
    };
    const journals = new Map<string, { desc: string; type: string; entries: Map<string, JournalRow[]> }>();

    for (const r of rows) {
      const j = journalOf(r.source_type);
      const journal = journals.get(j.id) ?? { desc: j.desc, type: j.type, entries: new Map<string, JournalRow[]>() };

      journal.entries.set(r.entry_id, [...(journal.entries.get(r.entry_id) ?? []), r]);
      journals.set(j.id, journal);
    }

    for (const [id, journal] of journals) {
      const jrn = transactions.ele('journal');

      jrn.ele('jrnID').txt(id);
      jrn.ele('desc').txt(journal.desc);
      jrn.ele('jrnTp').txt(journal.type);

      for (const lines of journal.entries.values()) {
        const first = lines[0];
        const tr = jrn.ele('transaction');

        tr.ele('nr').txt(`${first.fiscal_year}-${first.entry_number}`);
        tr.ele('desc').txt((first.description || '-').slice(0, 255));
        tr.ele('periodNumber').txt(String(periodOf(first.posting_date)));
        tr.ele('trDt').txt(first.posting_date);
        tr.ele('amnt').txt(amount(lines.reduce((sum, l) => sum + Number(l.debit), 0)));
        tr.ele('sourceID').txt(first.source_type);

        for (const l of lines) {
          const debit = Number(l.debit);
          const line = tr.ele('trLine');

          line.ele('nr').txt(String(l.line_no));
          line.ele('accID').txt(l.account_number);
          line.ele('docRef').txt((l.document_number || `${l.entry_number}`).slice(0, 255));
          line.ele('effDate').txt(l.document_date);
          line.ele('desc').txt((l.description || '-').slice(0, 255));
          line.ele('amnt').txt(amount(debit > 0 ? debit : Number(l.credit)));
          line.ele('amntTp').txt(debit > 0 ? 'D' : 'C');

          if (l.counterparty_id && parties.has(l.counterparty_id)) line.ele('custSupID').txt(l.counterparty_id);

          if (l.tax_code) {
            const vat = line.ele('vat');

            vat.ele('vatID').txt(l.tax_code);

            if (l.tax_rate) vat.ele('vatPerc').txt(Number(l.tax_rate).toFixed(2));
          }

          if (l.original_currency && l.original_amount && l.original_currency !== cfg.functionalCurrency) {
            const currency = line.ele('currency');

            currency.ele('curCode').txt(l.original_currency);
            currency.ele('curAmnt').txt(Math.abs(Number(l.original_amount)).toFixed(2));
          }
        }
      }
    }

    return {
      fileName: `auditfile_${from}_${to}.xaf`,
      contentType: 'application/xml; charset=utf-8',
      content: Buffer.from(doc.end({ prettyPrint: true }), 'utf8'),
    };
  }

  private async saft(from: string, to: string, tenant: TenantFilter): Promise<ExportFile> {
    const rows = await this.journalRows(from, to, tenant);
    const issuer = this.issuer.getConfig();
    const cfg = this.config.getConfig();
    const accounts: Array<{
      number: string;
      name: string;
      type: string;
      external_codes: Record<string, string> | null;
    }> = await this.dataSource.query(
      `SELECT DISTINCT a.number, a.name, a.type, a.external_codes FROM billing_accounting_accounts a
         JOIN billing_accounting_journal_lines l ON l.account_id = a.id ORDER BY a.number`,
    );
    const taxCodes: Array<{ code: string; name: string; rate: string | null }> = await this.dataSource.query(
      `SELECT DISTINCT tc.code, tc.name, tc.rate::text FROM billing_accounting_tax_codes tc
       JOIN billing_accounting_journal_lines l ON l.tax_code_id = tc.id`,
    );
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('urn:OECD:StandardAuditFile-Tax:2.00', 'AuditFile');
    const header = doc.ele('Header');

    header.ele('AuditFileVersion').txt('2.00');
    header.ele('AuditFileCountry').txt(cfg.country === '*' ? issuer.country || 'XX' : cfg.country);
    header.ele('AuditFileDateCreated').txt(new Date().toISOString().slice(0, 10));
    header.ele('SoftwareCompanyName').txt('Forepath');
    header.ele('SoftwareID').txt('Decabill');
    header.ele('SoftwareVersion').txt('1');

    const company = header.ele('Company');

    company.ele('RegistrationNumber').txt(issuer.vatId || '-');
    company.ele('Name').txt(issuer.name || '-');

    const address = company.ele('Address');

    address.ele('StreetName').txt(issuer.addressLine1 || '-');
    address.ele('City').txt(issuer.city || '-');
    address.ele('PostalCode').txt(issuer.postalCode || '-');
    address.ele('Country').txt(issuer.country || '-');
    company
      .ele('TaxRegistration')
      .ele('TaxRegistrationNumber')
      .txt(issuer.vatId || '-');
    header.ele('DefaultCurrencyCode').txt(cfg.functionalCurrency);

    const criteria = header.ele('SelectionCriteria');

    criteria.ele('SelectionStartDate').txt(from);
    criteria.ele('SelectionEndDate').txt(to);
    header.ele('TaxAccountingBasis').txt(cfg.method === 'cash' ? 'C' : 'A');

    const master = doc.ele('MasterFiles');
    const gl = master.ele('GeneralLedgerAccounts');

    for (const a of accounts) {
      const acc = gl.ele('Account');

      acc.ele('AccountID').txt(a.number);
      acc.ele('AccountDescription').txt(a.name);

      if (a.external_codes?.['saftGroupingCategory']) {
        acc.ele('GroupingCategory').txt(a.external_codes['saftGroupingCategory']);
        acc.ele('GroupingCode').txt(a.external_codes['saftGroupingCode'] ?? a.number);
      }

      acc
        .ele('AccountType')
        .txt(a.type === 'asset' || a.type === 'liability' || a.type === 'equity' ? 'Balance' : 'PL');
    }

    const taxTable = master.ele('TaxTable').ele('TaxTableEntry');

    taxTable.ele('TaxType').txt('VAT');
    taxTable.ele('Description').txt('Value added tax');

    for (const t of taxCodes) {
      const detail = taxTable.ele('TaxCodeDetails');

      detail.ele('TaxCode').txt(t.code);
      detail.ele('Description').txt(t.name);

      if (t.rate !== null) {
        detail.ele('TaxPercentage').txt(Number(t.rate).toFixed(2));
      }
    }

    const entries = doc.ele('GeneralLedgerEntries');
    const byEntry = new Map<string, JournalRow[]>();

    for (const r of rows) {
      byEntry.set(r.entry_id, [...(byEntry.get(r.entry_id) ?? []), r]);
    }

    let totalDebit = 0;
    let totalCredit = 0;

    entries.ele('NumberOfEntries').txt(String(byEntry.size));

    const totalDebitEl = entries.ele('TotalDebit');
    const totalCreditEl = entries.ele('TotalCredit');
    const journal = entries.ele('Journal');

    journal.ele('JournalID').txt('GL');
    journal.ele('Description').txt('General ledger');
    journal.ele('Type').txt('GL');

    for (const [entryId, lines] of byEntry) {
      const first = lines[0];
      const tx = journal.ele('Transaction');

      tx.ele('TransactionID').txt(`${first.fiscal_year}-${first.entry_number}`);
      tx.ele('Period').txt(first.posting_date.slice(5, 7));
      tx.ele('PeriodYear').txt(first.posting_date.slice(0, 4));
      tx.ele('TransactionDate').txt(first.document_date);
      tx.ele('Description').txt(first.description);
      tx.ele('SystemEntryDate').txt(new Date(first.created_at).toISOString().slice(0, 10));
      tx.ele('GLPostingDate').txt(first.posting_date);
      tx.ele('SourceDocumentID').txt(first.document_number ?? entryId);

      for (const line of lines) {
        const l = tx.ele('Line');

        l.ele('RecordID').txt(String(line.line_no));
        l.ele('AccountID').txt(line.account_number);

        if (line.counterparty_type === 'customer' && line.counterparty_id) {
          l.ele('CustomerID').txt(line.counterparty_id);
        } else if (line.counterparty_type === 'supplier' && line.counterparty_id) {
          l.ele('SupplierID').txt(line.counterparty_id);
        }

        l.ele('Description').txt(line.description);

        const debit = Number(line.debit);
        const amountEl = l.ele(debit > 0 ? 'DebitAmount' : 'CreditAmount');

        amountEl.ele('Amount').txt((debit > 0 ? debit : Number(line.credit)).toFixed(2));

        if (line.original_currency && line.original_amount && Number(line.original_amount) !== 0) {
          const currencyAmount = Math.abs(Number(line.original_amount));
          const amount = debit > 0 ? debit : Number(line.credit);

          amountEl.ele('CurrencyCode').txt(line.original_currency);
          amountEl.ele('CurrencyAmount').txt(currencyAmount.toFixed(2));
          // SAF-T: Amount = CurrencyAmount × ExchangeRate (per line — a settlement mixes invoice and payment rates).
          amountEl.ele('ExchangeRate').txt(String(Math.round((amount / currencyAmount) * 1e8) / 1e8));
        }

        if (line.tax_code) {
          const tax = l.ele('TaxInformation');

          tax.ele('TaxType').txt('VAT');
          tax.ele('TaxCode').txt(line.tax_code);

          if (line.tax_rate) {
            tax.ele('TaxPercentage').txt(Number(line.tax_rate).toFixed(2));
          }
        }

        totalDebit += Math.round(debit * 100);
        totalCredit += Math.round(Number(line.credit) * 100);
      }
    }

    totalDebitEl.txt((totalDebit / 100).toFixed(2));
    totalCreditEl.txt((totalCredit / 100).toFixed(2));

    return {
      fileName: `saft_${from}_${to}.xml`,
      contentType: 'application/xml; charset=utf-8',
      content: Buffer.from(doc.end({ prettyPrint: true }), 'utf8'),
    };
  }

  private csvCell(value: string): string {
    const safe = neutralizeCsvCell(value);

    return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  private gdpduCell(value: string): string {
    const v = value.replace(/[\r\n]+/g, ' ');

    return `"${v.replace(/"/g, '""')}"`;
  }

  private async zip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<void>((resolve, reject) => {
      stream.on('end', () => resolve());
      archive.on('error', reject);
    });

    archive.pipe(stream);

    for (const file of files) {
      archive.append(file.content, { name: file.name });
    }

    await archive.finalize();
    await done;

    return Buffer.concat(chunks);
  }
}
