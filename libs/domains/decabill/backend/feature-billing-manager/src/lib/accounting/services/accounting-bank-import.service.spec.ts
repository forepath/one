import { ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { FindOperator } from 'typeorm';

import type { ParsedStatement, ParsedTransaction } from '../bank-import/bank-import.types';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankStatementEntity } from '../entities/accounting-bank-statement.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingCsvMappingEntity } from '../entities/accounting-csv-mapping.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';

import { AccountingBankImportService, type ImportScope } from './accounting-bank-import.service';
import { AccountingReconciliationService, type MatchSuggestion } from './accounting-reconciliation.service';

type Row = Record<string, unknown>;

let overlappingImports: Row[] = [];
const IBAN = 'DE89370400440532013000';
const FOREIGN_IBAN = 'GB82WEST12345698765432';

function matches(row: Row, where: Row | Row[]): boolean {
  if (Array.isArray(where)) {
    return where.some((w) => matches(row, w));
  }

  return Object.entries(where).every(([key, value]) =>
    value instanceof FindOperator ? (value.value as unknown[]).includes(row[key]) : row[key] === value,
  );
}

function memoryRepo(rows: Row[], prefix: string) {
  return {
    findOne: jest.fn(async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null),
    findOneOrFail: jest.fn(async ({ where }: { where: Row }) => {
      const found = rows.find((r) => matches(r, where));

      if (!found) {
        throw new Error(`${prefix} not found`);
      }

      return found;
    }),
    find: jest.fn(async ({ where }: { where: Row | Row[] }) => rows.filter((r) => matches(r, where))),
    create: jest.fn((data: Row) => ({ ...data })),
    save: jest.fn(async (row: Row) => {
      if (!row['id']) {
        row['id'] = `${prefix}-${rows.length + 1}`;
      }

      rows.push(row);

      return row;
    }),
    update: jest.fn(async (criteria: string | Row, patch: Row) => {
      for (const row of rows.filter((r) =>
        typeof criteria === 'string' ? r['id'] === criteria : matches(r, criteria),
      )) {
        Object.assign(row, patch);
      }
    }),
    delete: jest.fn(async (criteria: string | Row) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (typeof criteria === 'string' ? rows[i]['id'] === criteria : matches(rows[i], criteria)) {
          rows.splice(i, 1);
        }
      }
    }),
    count: jest.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where)).length),
    createQueryBuilder: jest.fn(() => {
      const qb = {
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        getOne: async () => null,
        getMany: async () => overlappingImports,
      };

      return qb;
    }),
  };
}

describe('AccountingBankImportService', () => {
  let imports: Row[];
  let statements: Row[];
  let transactions: Row[];
  let accounts: Row[];
  let csvMappings: Row[];
  let inserted: unknown[][];
  let insertKeys: Set<string>;
  let repos: Map<unknown, ReturnType<typeof memoryRepo>>;
  let parsedStatements: ParsedStatement[];
  const manager = {
    getRepository: (entity: unknown) => repos.get(entity)!,
    // In-memory model of the raw SQL of the import (dedupe slots, cross-format candidates, inserts).
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('dedupe_key = ANY')) {
        const keys = params[1] as string[];

        return transactions
          .filter((t) => t['financialAccountId'] === params[0] && keys.includes(t['dedupeKey'] as string))
          .map((t) => ({
            id: t['matchStatus'] === 'superseded' && t['supersededById'] ? t['supersededById'] : t['id'],
            dedupe_key: t['dedupeKey'],
            dedupe_ordinal: t['dedupeOrdinal'],
          }));
      }

      if (sql.includes('source_format <> $2')) {
        return transactions
          .filter(
            (t) =>
              t['financialAccountId'] === params[0] &&
              t['sourceFormat'] &&
              t['sourceFormat'] !== params[1] &&
              t['matchStatus'] !== 'superseded' &&
              (t['bookingDate'] as string) >= (params[2] as string) &&
              (t['bookingDate'] as string) <= (params[3] as string),
          )
          .map((t) => ({
            id: t['id'],
            status: t['status'],
            booking_date: t['bookingDate'],
            value_date: t['valueDate'] ?? null,
            amount: String(t['amount']),
            currency: t['currency'],
            end_to_end_id: t['endToEndId'] ?? null,
            counterparty_iban: t['counterpartyIban'] ?? null,
          }));
      }

      if (!sql.includes('INSERT INTO billing_accounting_bank_transactions')) {
        return [];
      }

      // ON CONFLICT (financial_account_id, dedupe_key, dedupe_ordinal) DO NOTHING
      const key = `${String(params[0])}|${String(params[22])}|${String(params[23])}`;

      if (insertKeys.has(key)) {
        return [];
      }

      insertKeys.add(key);
      inserted.push(params);

      const id = `bt-${inserted.length}`;

      transactions.push({
        id,
        financialAccountId: params[0],
        importId: params[1],
        status: params[4],
        bookingDate: params[5],
        valueDate: params[6],
        amount: params[7],
        currency: params[8],
        counterpartyIban: params[11],
        endToEndId: params[14],
        dedupeKey: params[22],
        dedupeOrdinal: params[23],
        sourceFormat: params[24],
        matchStatus: params[25],
        supersededById: params[26],
      });

      return [{ id }];
    }),
  };
  const dataSource = {
    getRepository: (entity: unknown) => repos.get(entity)!,
    transaction: jest.fn(async (run: (m: unknown) => unknown) => await run(manager)),
    query: jest.fn(async () => []),
  };
  const config = {
    getConfig: jest.fn(() => ({ bankImportMaxBytes: 1024, autoMatchThreshold: 0.9 })),
    isEnabled: () => true,
  };
  let parsedFormat = 'camt.053';
  let parsedFiles: Array<{
    name: string;
    parsed: { format: string; statements: ParsedStatement[]; warnings: string[] };
  }> | null = null;
  const parser = {
    parse: jest.fn(() => ({
      files: parsedFiles ?? [
        { name: 'statement.xml', parsed: { format: parsedFormat, statements: parsedStatements, warnings: [] } },
      ],
      warnings: [],
    })),
  };
  const reconciliation = {
    suggestAndAutoMatch: jest.fn(async (ids: string[]) => ({ suggested: 0, matched: ids.length > 0 ? 1 : 0 })),
  };
  const fileStorage = {
    writeAccountingImportFile: jest.fn(),
    readAccountingImportFile: jest.fn(async () => Buffer.from('raw')),
  };
  const storedFileRegistry = { registerFromBuffer: jest.fn(async () => ({ id: 'sf-1' })) };
  const service = new AccountingBankImportService(
    dataSource as never,
    config as never,
    parser as never,
    reconciliation as never,
    fileStorage as never,
    storedFileRegistry as never,
  );
  const acme: ImportScope = { tenantId: 'acme', global: false };
  const file = (content = 'statement-1', originalname = 'statement.xml') => {
    const buffer = Buffer.from(content);

    return { buffer, originalname, size: buffer.length };
  };
  const tx = (overrides: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
    status: 'booked',
    bookingDate: '2026-03-12',
    amount: '119.00',
    currency: 'EUR',
    isReversal: false,
    isBatch: false,
    details: [{ remittance: 'INV-2026-00042', counterparty: { name: 'Fischer GmbH' } }],
    locator: 'entry 1',
    ...overrides,
  });
  const statement = (txs: ParsedTransaction[], overrides: Partial<ParsedStatement> = {}): ParsedStatement => ({
    kind: 'statement',
    account: { iban: IBAN },
    currency: 'EUR',
    transactions: txs,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    imports = [];
    statements = [];
    transactions = [];
    csvMappings = [];
    accounts = [
      {
        id: 'fa-1',
        tenantId: 'acme',
        name: 'Main account',
        iban: IBAN,
        currency: 'EUR',
        isActive: true,
        lastClosingBalance: null,
        lastClosingDate: null,
      },
      {
        id: 'fa-foreign',
        tenantId: 'other',
        name: 'Other tenant',
        iban: FOREIGN_IBAN,
        currency: 'EUR',
        isActive: true,
        lastClosingBalance: null,
        lastClosingDate: null,
      },
    ];
    inserted = [];
    insertKeys = new Set();
    parsedStatements = [statement([tx()])];
    parsedFormat = 'camt.053';
    parsedFiles = null;
    overlappingImports = [];
    repos = new Map<unknown, ReturnType<typeof memoryRepo>>([
      [AccountingBankImportEntity, memoryRepo(imports, 'imp')],
      [AccountingBankStatementEntity, memoryRepo(statements, 'st')],
      [AccountingBankTransactionEntity, memoryRepo(transactions, 'tx')],
      [AccountingFinancialAccountEntity, memoryRepo(accounts, 'fa')],
      [AccountingCsvMappingEntity, memoryRepo(csvMappings, 'map')],
    ]);
    config.getConfig.mockReturnValue({ bankImportMaxBytes: 1024, autoMatchThreshold: 0.9 });
  });

  it('rejects empty and oversize files before storing anything', async () => {
    await expect(
      service.upload({ buffer: Buffer.alloc(0), originalname: 'a.xml', size: 0 }, {}, acme, 'u1'),
    ).rejects.toThrow(/Empty file/);
    await expect(service.upload(file('x'.repeat(2048)), {}, acme, 'u1')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(fileStorage.writeAccountingImportFile).not.toHaveBeenCalled();
    expect(imports).toHaveLength(0);
  });

  it('rejects unsupported file types unless a known format is chosen explicitly', async () => {
    await expect(service.upload(file('MZ', 'payload.exe'), {}, acme, 'u1')).rejects.toThrow(/Unsupported file type/);
    await expect(service.upload(file('MZ', 'payload.exe'), { format: 'xlsx' }, acme, 'u1')).rejects.toThrow(
      /Unknown format/,
    );
    await expect(service.upload(file('data', 'statement.xml'), { format: 'pdf' }, acme, 'u1')).rejects.toThrow(
      /Unknown format/,
    );
    expect(parser.parse).not.toHaveBeenCalled();

    const record = await service.upload(file('data', 'export.bin'), { format: 'camt.053' }, acme, 'u1');

    expect(record.status).toBe('completed');
  });

  it('sanitizes the file name so the storage key stays inside the tenant folder', async () => {
    const record = await service.upload(file('data', '../../etc/passwd.xml'), {}, acme, 'u1');

    expect(record.fileName).not.toContain('/');

    const storageKey = fileStorage.writeAccountingImportFile.mock.calls[0][0] as string;

    expect(storageKey.startsWith('acme/')).toBe(true);
    expect(storageKey.split('/')).toHaveLength(3);
    expect(storedFileRegistry.registerFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'acme', storageKey }),
    );
  });

  it('detects duplicate files per tenant only', async () => {
    await service.upload(file('same-bytes'), {}, acme, 'u1');

    await expect(service.upload(file('same-bytes'), {}, acme, 'u1')).rejects.toBeInstanceOf(ConflictException);

    const importRepo = repos.get(AccountingBankImportEntity)!;

    expect(importRepo.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'completed', tenantId: 'acme' }),
    });

    // The same bytes uploaded by another tenant are not a duplicate (into that tenant's own account).
    parsedStatements = [statement([tx()], { account: { iban: FOREIGN_IBAN } })];

    const other = await service.upload(file('same-bytes'), {}, { tenantId: 'other', global: false }, 'u2');

    expect(other.status).toBe('completed');
    expect(other.tenantId).toBe('other');
  });

  it('does not book a statement of another IBAN into a forced target account', async () => {
    accounts.push({ ...accounts[0], id: 'fa-2', iban: 'DE02120300000000202051', name: 'Second account' });
    parsedStatements = [statement([tx()], { account: { iban: IBAN } })];

    const record = await service.upload(file(), { financialAccountId: 'fa-2' }, acme, 'u1');

    expect(record.status).toBe('failed');
    expect(record.errorMessage).toMatch(/not the chosen account Second account/);

    // A statement without account identification (e.g. CSV) goes to the chosen account.
    parsedStatements = [statement([tx()], { account: {} })];

    const csv = await service.upload(file('csv', 'bank.csv'), { financialAccountId: 'fa-2' }, acme, 'u1');

    expect(csv.status).toBe('completed');
    expect(inserted[0][0]).toBe('fa-2');
  });

  it('names later overlapping imports when rolling back', async () => {
    imports.push({ id: 'imp-1', tenantId: 'acme', status: 'completed', warnings: [], createdAt: new Date() });
    statements.push({ id: 'st-1', importId: 'imp-1', financialAccountId: 'fa-1' });
    overlappingImports = [{ id: 'imp-2', fileName: 'march.sta' }];

    const record = await service.rollback('imp-1', acme);

    expect(record.warnings).toEqual([expect.stringMatching(/Later imports overlapping .*: march\.sta/)]);
  });

  it('rejects a forced target account that belongs to another tenant', async () => {
    await expect(service.upload(file(), { financialAccountId: 'fa-foreign' }, acme, 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(imports).toHaveLength(0);
    expect(fileStorage.writeAccountingImportFile).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('resolves an MT940 "bank code/account number" identifier to the account via the derived IBAN', async () => {
    parsedStatements = [statement([tx()], { account: { bankCode: '37040044', accountNumber: '532013000' } })];

    const record = await service.upload(file(), {}, acme, 'u1');

    expect(record.status).toBe('completed');
    expect(inserted[0][0]).toBe('fa-1');
    // The auto-detected account is recorded on the import.
    expect(record.financialAccountId).toBe('fa-1');
  });

  it('never assigns a statement to a foreign tenant account by IBAN (import fails, nothing inserted)', async () => {
    parsedStatements = [statement([tx()], { account: { iban: FOREIGN_IBAN } })];

    const record = await service.upload(file(), {}, acme, 'u1');

    expect(record.status).toBe('failed');
    expect(record.errorMessage).toMatch(/No financial account for GB82WEST12345698765432/);
    expect(inserted).toHaveLength(0);
    expect(reconciliation.suggestAndAutoMatch).not.toHaveBeenCalled();
  });

  it('lets global operators import into any tenant account', async () => {
    parsedStatements = [statement([tx()], { account: { iban: FOREIGN_IBAN } })];

    const record = await service.upload(file(), {}, { tenantId: 'acme', global: true }, 'u1');

    expect(record.status).toBe('completed');
    expect(inserted[0][0]).toBe('fa-foreign');
    // Tenant dimension of the transaction follows the account, not the uploader.
    expect(inserted[0][3]).toBe('other');
  });

  it('rejects statements whose currency does not match the account', async () => {
    parsedStatements = [statement([tx({ currency: 'USD' })])];

    const record = await service.upload(file(), {}, acme, 'u1');

    expect(record.status).toBe('failed');
    expect(record.errorMessage).toMatch(/USD does not match account Main account \(EUR\)/);
  });

  it('keeps identical lines within one file and only adds new lines on overlapping re-imports', async () => {
    const same = tx({ amount: '10.00', details: [{ remittance: 'Coffee' }] });

    parsedStatements = [statement([same, { ...same, locator: 'entry 2' }])];

    const first = await service.upload(file('day-1'), {}, acme, 'u1');

    expect(first).toEqual(expect.objectContaining({ transactionCount: 2, duplicateCount: 0 }));
    expect(inserted.map((p) => p[23])).toEqual([0, 1]);

    parsedStatements = [
      statement([same, { ...same, locator: 'entry 2' }, tx({ amount: '25.00', details: [{ remittance: 'Lunch' }] })]),
    ];

    const second = await service.upload(file('day-1-and-2'), {}, acme, 'u1');

    expect(second).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 2 }));
    expect(reconciliation.suggestAndAutoMatch).toHaveBeenLastCalledWith(['bt-3']);
  });

  it('does not treat a recurring generic reference on another day as a duplicate', async () => {
    parsedFormat = 'qif';
    parsedStatements = [statement([tx({ bankReference: 'ATM', amount: '-50.00', bookingDate: '2026-01-15' })])];
    await service.upload(file('jan'), {}, acme, 'u1');

    parsedStatements = [statement([tx({ bankReference: 'ATM', amount: '-50.00', bookingDate: '2026-02-15' })])];

    const february = await service.upload(file('feb'), {}, acme, 'u1');

    expect(february).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 0 }));
  });

  it('dedupes on the native bank reference (ignoring text changes) but falls back to fingerprints for NONREF', async () => {
    parsedStatements = [
      statement([
        tx({ bankReference: 'REF-1', details: [{ remittance: 'first text' }] }),
        tx({ bankReference: 'NONREF', amount: '5.00', details: [{ remittance: 'a' }] }),
      ]),
    ];
    await service.upload(file('a'), {}, acme, 'u1');

    parsedStatements = [
      statement([
        tx({ bankReference: 'REF-1', details: [{ remittance: 'bank reworded the text' }] }),
        tx({ bankReference: 'NONREF', amount: '5.00', details: [{ remittance: 'b' }] }),
      ]),
    ];

    const second = await service.upload(file('b'), {}, acme, 'u1');

    expect(second).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 1 }));
    expect(inserted).toHaveLength(3);
    expect(inserted[2][13]).toBe('b');
  });

  it('replaces the matching pending line when the booked line arrives', async () => {
    transactions.push(
      {
        id: 'pending-1',
        financialAccountId: 'fa-1',
        status: 'pending',
        matchStatus: 'unmatched',
        amount: '-50.00',
        bookingDate: '2026-03-10',
        endToEndId: 'E2E-1',
        counterpartyIban: null,
      },
      {
        id: 'pending-old',
        financialAccountId: 'fa-1',
        status: 'pending',
        matchStatus: 'unmatched',
        amount: '-50.00',
        bookingDate: '2026-02-01',
        endToEndId: 'E2E-1',
        counterpartyIban: null,
      },
      {
        id: 'pending-matched',
        financialAccountId: 'fa-1',
        status: 'pending',
        matchStatus: 'matched',
        amount: '-50.00',
        bookingDate: '2026-03-11',
        endToEndId: 'E2E-1',
        counterpartyIban: null,
      },
    );
    parsedStatements = [statement([tx({ amount: '-50.00', details: [{ endToEndId: 'E2E-1', remittance: 'Rent' }] })])];

    await service.upload(file(), {}, acme, 'u1');

    const txRepo = repos.get(AccountingBankTransactionEntity)!;

    // Kept as superseded (not deleted) so re-importing the intraday file cannot bring the pending line back.
    expect(txRepo.delete).not.toHaveBeenCalled();
    expect(txRepo.update).toHaveBeenCalledTimes(1);
    expect(txRepo.update).toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({ matchStatus: 'superseded', suggestion: null }),
    );
  });

  it('only supersedes an identifier-less pending line when the match is unambiguous', async () => {
    transactions.push(
      {
        id: 'pending-a',
        financialAccountId: 'fa-1',
        status: 'pending',
        matchStatus: 'unmatched',
        amount: '-50.00',
        bookingDate: '2026-03-10',
        endToEndId: null,
        counterpartyIban: null,
      },
      {
        id: 'pending-b',
        financialAccountId: 'fa-1',
        status: 'pending',
        matchStatus: 'unmatched',
        amount: '-50.00',
        bookingDate: '2026-03-11',
        endToEndId: null,
        counterpartyIban: null,
      },
    );
    parsedStatements = [statement([tx({ amount: '-50.00', details: [{ remittance: 'Card payment' }] })])];

    await service.upload(file(), {}, acme, 'u1');

    expect(repos.get(AccountingBankTransactionEntity)!.update).not.toHaveBeenCalledWith('pending-a', expect.anything());
    expect(repos.get(AccountingBankTransactionEntity)!.update).not.toHaveBeenCalledWith('pending-b', expect.anything());
  });

  it('does not supersede anything when a pending line is imported', async () => {
    transactions.push({
      id: 'pending-1',
      financialAccountId: 'fa-1',
      status: 'pending',
      matchStatus: 'unmatched',
      amount: '119.00',
      bookingDate: '2026-03-12',
      endToEndId: null,
      counterpartyIban: null,
    });
    parsedStatements = [statement([tx({ status: 'pending' })])];

    await service.upload(file(), {}, acme, 'u1');

    expect(repos.get(AccountingBankTransactionEntity)!.delete).not.toHaveBeenCalled();
  });

  it('warns when the opening balance does not continue the last closing balance and advances the closing balance', async () => {
    accounts[0]['lastClosingBalance'] = '1000.00';
    accounts[0]['lastClosingDate'] = '2026-02-28';
    parsedStatements = [
      statement([tx()], {
        openingBalance: { amount: '900.00', currency: 'EUR', date: '2026-03-01' },
        closingBalance: { amount: '1019.00', currency: 'EUR', date: '2026-03-31' },
      }),
    ];

    const record = await service.upload(file(), {}, acme, 'u1');

    expect(record.warnings).toEqual([
      expect.stringMatching(/Opening balance 900.00 of Main account does not match the last closing balance 1000.00/),
    ]);
    expect(statements[0]['warnings']).toEqual(record.warnings);
    expect(accounts[0]).toEqual(expect.objectContaining({ lastClosingBalance: 1019, lastClosingDate: '2026-03-31' }));
  });

  it('raises no continuity warning for a matching or non-adjacent opening balance', async () => {
    accounts[0]['lastClosingBalance'] = 1000;
    accounts[0]['lastClosingDate'] = '2026-02-28';
    parsedStatements = [
      statement([tx()], { openingBalance: { amount: '1000.00', currency: 'EUR', date: '2026-03-01' } }),
    ];

    expect((await service.upload(file('a'), {}, acme, 'u1')).warnings).toEqual([]);

    parsedStatements = [
      statement([tx({ amount: '1.00' })], { openingBalance: { amount: '5.00', currency: 'EUR', date: '2026-06-01' } }),
    ];

    expect((await service.upload(file('b'), {}, acme, 'u1')).warnings).toEqual([]);
  });

  it('does not let an older statement move the closing balance backwards', async () => {
    accounts[0]['lastClosingBalance'] = 500;
    accounts[0]['lastClosingDate'] = '2026-03-31';
    parsedStatements = [
      statement([tx()], { closingBalance: { amount: '100.00', currency: 'EUR', date: '2026-01-31' } }),
    ];

    await service.upload(file(), {}, acme, 'u1');

    expect(accounts[0]).toEqual(expect.objectContaining({ lastClosingBalance: 500, lastClosingDate: '2026-03-31' }));
  });

  it('hands only newly inserted transactions to auto-matching and records the matched count', async () => {
    const record = await service.upload(file(), {}, acme, 'u1');

    expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith(['bt-1']);
    expect(record.matchedCount).toBe(1);
  });

  it('rejects a saved CSV mapping of another tenant but allows shared ones', async () => {
    csvMappings.push(
      { id: 'map-foreign', tenantId: 'other', mapping: { columns: {} } },
      { id: 'map-shared', tenantId: null, mapping: { columns: {}, dateFormat: 'DD.MM.YYYY' } },
    );

    await expect(service.upload(file('x', 'bank.csv'), { csvMappingId: 'map-foreign' }, acme, 'u1')).rejects.toThrow(
      /CSV mapping not found/,
    );
    await expect(service.upload(file('x', 'bank.csv'), { csvPreset: 'no-such-bank' }, acme, 'u1')).rejects.toThrow(
      /Unknown CSV preset/,
    );

    await service.upload(file('x', 'bank.csv'), { csvMappingId: 'map-shared' }, acme, 'u1');

    expect(parser.parse).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv', csvMapping: csvMappings[1]['mapping'] }),
    );
  });

  it('hides imports and stored files of other tenants', async () => {
    imports.push({ id: 'imp-foreign', tenantId: 'other', fileName: 'x.xml', storageKey: 'other/2026-03/x.xml' });

    await expect(service.getImport('imp-foreign', acme)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.downloadImportFile('imp-foreign', acme)).rejects.toBeInstanceOf(NotFoundException);
    expect(fileStorage.readAccountingImportFile).not.toHaveBeenCalled();
    await expect(service.getImport('imp-foreign', { tenantId: 'acme', global: true })).resolves.toEqual(
      expect.objectContaining({ id: 'imp-foreign' }),
    );
  });

  it('refuses to roll back an import with reconciled transactions', async () => {
    imports.push({ id: 'imp-1', tenantId: 'acme', status: 'completed' });
    transactions.push({ id: 'bt-x', importId: 'imp-1', matchStatus: 'matched' });

    await expect(service.rollback('imp-1', acme)).rejects.toThrow(/reconciled; undo them first/);
    expect(imports[0]['status']).toBe('completed');

    transactions[0]['matchStatus'] = 'unmatched';

    const record = await service.rollback('imp-1', acme);

    expect(record.status).toBe('rolled_back');
    expect(transactions).toHaveLength(0);
  });

  it('restores the pending lines a rolled-back import had superseded', async () => {
    imports.push({ id: 'imp-2', tenantId: 'acme', status: 'completed' });
    transactions.push(
      { id: 'bt-booked', importId: 'imp-2', matchStatus: 'unmatched' },
      {
        id: 'bt-pending',
        importId: 'imp-1',
        status: 'pending',
        matchStatus: 'superseded',
        supersededById: 'bt-booked',
        matchedAt: new Date(),
      },
      {
        id: 'bt-other',
        importId: 'imp-1',
        status: 'pending',
        matchStatus: 'superseded',
        supersededById: 'bt-elsewhere',
      },
    );

    await service.rollback('imp-2', acme);

    expect(transactions.map((t) => [t['id'], t['matchStatus'], t['supersededById']])).toEqual([
      ['bt-pending', 'unmatched', null],
      ['bt-other', 'superseded', 'bt-elsewhere'],
    ]);
  });

  describe('cross-format dedupe', () => {
    const rows = () => transactions.map((t) => [t['sourceFormat'], t['matchStatus'], t['supersededById'] ?? null]);

    it('keeps a line already imported from another format as a superseded duplicate', async () => {
      parsedStatements = [
        statement([tx({ bankReference: 'CAMT-ACCTSVCR-1', details: [{ remittance: 'INV-2026-00042 Fischer GmbH' }] })]),
      ];

      const camt = await service.upload(file('camt'), {}, acme, 'u1');

      expect(camt.transactionCount).toBe(1);

      // The same booking from the MT940 export: other bank reference, reformatted remittance.
      parsedFormat = 'mt940';
      parsedStatements = [
        statement([tx({ bankReference: '0312A1B2', details: [{ remittance: '?20INV-2026-00042?21FISCHER GMBH' }] })]),
      ];
      reconciliation.suggestAndAutoMatch.mockClear();

      const mt940 = await service.upload(file('mt940'), {}, acme, 'u1');

      expect(mt940).toEqual(expect.objectContaining({ transactionCount: 0, duplicateCount: 1 }));
      expect(mt940.warnings).toEqual([expect.stringMatching(/1 transaction\(s\) were already imported from another/)]);
      expect(rows()).toEqual([
        ['camt.053', 'unmatched', null],
        ['mt940', 'superseded', 'bt-1'],
      ]);
      expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith([]);

      // Re-importing the MT940 (other bytes) hits its own dedupe slot: nothing new, no second duplicate row.
      const again = await service.upload(file('mt940-again'), {}, acme, 'u1');

      expect(again).toEqual(expect.objectContaining({ transactionCount: 0, duplicateCount: 1, warnings: [] }));
      expect(transactions).toHaveLength(2);
    });

    it('counts identical lines as a multiset and adds only the surplus', async () => {
      const coffee = (n: number) => tx({ amount: '-3.50', locator: `entry ${n}`, details: [{ remittance: 'Coffee' }] });

      parsedStatements = [statement([coffee(1), coffee(2)])];
      await service.upload(file('camt'), {}, acme, 'u1');

      parsedFormat = 'csv';
      parsedStatements = [
        statement(
          [1, 2, 3].map((n) => tx({ amount: '-3.50', locator: `row ${n}`, details: [{ remittance: 'KAFFEE' }] })),
        ),
      ];

      const csv = await service.upload(file('csv', 'bank.csv'), {}, acme, 'u1');

      expect(csv).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 2 }));
      expect(rows()).toEqual([
        ['camt.053', 'unmatched', null],
        ['camt.053', 'unmatched', null],
        ['csv', 'superseded', 'bt-1'],
        ['csv', 'superseded', 'bt-2'],
        ['csv', 'unmatched', null],
      ]);
    });

    it('never pairs lines whose identifiers or value dates contradict, and pairs identified lines first', async () => {
      parsedStatements = [
        statement([
          tx({ amount: '-50.00', details: [{ endToEndId: 'E2E-A', remittance: 'Rent' }] }),
          tx({ amount: '-50.00', locator: 'entry 2', details: [{ remittance: 'Card' }] }),
          tx({ amount: '20.00', valueDate: '2026-03-12', details: [{ remittance: 'Refund' }] }),
        ]),
      ];
      await service.upload(file('camt'), {}, acme, 'u1');

      parsedFormat = 'mt940';
      parsedStatements = [
        statement([
          // Anonymous line first: it must not take the twin of the identified line below.
          tx({ amount: '-50.00', details: [{ remittance: 'CARD PAYMENT 0312' }] }),
          tx({ amount: '-50.00', locator: 'line 2', details: [{ endToEndId: 'E2E-A', remittance: 'RENT MARCH' }] }),
          tx({ amount: '-50.00', locator: 'line 3', details: [{ endToEndId: 'E2E-OTHER', remittance: 'x' }] }),
          tx({ amount: '20.00', valueDate: '2026-03-13', details: [{ remittance: 'REFUND' }] }),
        ]),
      ];

      const mt940 = await service.upload(file('mt940'), {}, acme, 'u1');

      expect(mt940).toEqual(expect.objectContaining({ transactionCount: 2, duplicateCount: 2 }));
      expect(transactions.slice(3).map((t) => [t['endToEndId'] ?? null, t['supersededById'] ?? null])).toEqual([
        [null, 'bt-2'],
        ['E2E-A', 'bt-1'],
        ['E2E-OTHER', null],
        [null, null],
      ]);
    });

    it('lets a line deduplicated by its key keep its twin to itself', async () => {
      parsedStatements = [statement([tx({ amount: '-50.00', details: [{ remittance: 'Card' }] })])];
      await service.upload(file('camt'), {}, acme, 'u1');

      parsedFormat = 'mt940';
      parsedStatements = [
        statement([
          // Same fingerprint as the camt line (formats agree here) → same dedupe key.
          tx({ amount: '-50.00', details: [{ remittance: 'CARD' }] }),
          tx({ amount: '-50.00', locator: 'line 2', details: [{ remittance: 'Second card payment' }] }),
        ]),
      ];

      const mt940 = await service.upload(file('mt940'), {}, acme, 'u1');

      expect(mt940).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 1 }));
      expect(rows()).toEqual([
        ['camt.053', 'unmatched', null],
        ['mt940', 'unmatched', null],
      ]);
    });

    it('dedupes a ZIP that carries the same period in two formats', async () => {
      parsedFiles = [
        {
          name: 'a.xml',
          parsed: { format: 'camt.053', statements: [statement([tx({ bankReference: 'C-1' })])], warnings: [] },
        },
        {
          name: 'a.sta',
          parsed: { format: 'mt940', statements: [statement([tx({ bankReference: 'M-1' })])], warnings: [] },
        },
      ];

      const record = await service.upload(file('zip', 'statements.zip'), {}, acme, 'u1');

      expect(record).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 1 }));
      expect(rows()).toEqual([
        ['camt.053', 'unmatched', null],
        ['mt940', 'superseded', 'bt-1'],
      ]);
    });

    it('does not compare lines of the same format beyond their dedupe key', async () => {
      parsedStatements = [statement([tx({ bankReference: 'REF-1' })])];
      await service.upload(file('a'), {}, acme, 'u1');

      parsedStatements = [statement([tx({ bankReference: 'REF-2' })])];

      const second = await service.upload(file('b'), {}, acme, 'u1');

      expect(second).toEqual(expect.objectContaining({ transactionCount: 1, duplicateCount: 0 }));
    });

    it('brings cross-format duplicates back when the original import is rolled back', async () => {
      parsedStatements = [statement([tx({ bankReference: 'CAMT-1' })])];

      const camt = await service.upload(file('camt'), {}, acme, 'u1');

      parsedFormat = 'mt940';
      parsedStatements = [statement([tx({ bankReference: 'MT-1' })])];
      await service.upload(file('mt940'), {}, acme, 'u1');
      reconciliation.suggestAndAutoMatch.mockClear();

      await service.rollback(camt.id, acme);

      expect(rows()).toEqual([['mt940', 'unmatched', null]]);
      expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith(['bt-2']);
    });
  });

  it('re-points dependants to the successor when the rolled-back line was itself superseded', async () => {
    imports.push({ id: 'imp-mt942', tenantId: 'acme', status: 'completed' });
    transactions.push(
      { id: 'p-mt942', importId: 'imp-mt942', status: 'pending', matchStatus: 'superseded', supersededById: 'b-1' },
      { id: 'p-camt052', importId: 'imp-x', status: 'pending', matchStatus: 'superseded', supersededById: 'p-mt942' },
      { id: 'b-1', importId: 'imp-y', status: 'booked', matchStatus: 'unmatched' },
    );

    await service.rollback('imp-mt942', acme);

    expect(transactions.map((t) => [t['id'], t['matchStatus'], t['supersededById']])).toEqual([
      ['p-camt052', 'superseded', 'b-1'],
      ['b-1', 'unmatched', undefined],
    ]);
    expect(reconciliation.suggestAndAutoMatch).not.toHaveBeenCalled();
  });

  describe('auto-match threshold (with the real reconciliation service)', () => {
    const txRows = new Map<string, Row>();
    const reconDataSource = {
      getRepository: () => ({
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => txRows.get(where.id) ?? null),
        update: jest.fn(async (id: string, patch: Row) => Object.assign(txRows.get(id) ?? {}, patch)),
      }),
    };
    const realReconciliation = new AccountingReconciliationService(
      reconDataSource as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const importService = new AccountingBankImportService(
      dataSource as never,
      config as never,
      parser as never,
      realReconciliation,
      fileStorage as never,
      storedFileRegistry as never,
    );
    const suggestion = (score: number): MatchSuggestion => ({
      score,
      reasons: [],
      targets: [{ type: 'invoice', id: 'inv-1', amount: 119 }],
    });
    let suggestSpy: jest.SpyInstance;
    let applySpy: jest.SpyInstance;

    beforeEach(() => {
      txRows.clear();
      txRows.set('bt-1', { id: 'bt-1', status: 'booked', matchStatus: 'unmatched' });
      suggestSpy = jest.spyOn(realReconciliation, 'suggest');
      applySpy = jest.spyOn(realReconciliation, 'apply').mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      suggestSpy.mockRestore();
      applySpy.mockRestore();
    });

    it('auto-applies a unique suggestion at or above the threshold', async () => {
      suggestSpy.mockResolvedValue([suggestion(0.95)]);

      const record = await importService.upload(file(), {}, acme, 'u1');

      expect(applySpy).toHaveBeenCalledWith('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 119 }], null, {
        learn: false,
      });
      expect(record.matchedCount).toBe(1);
    });

    it('only suggests below the threshold or when the best match is ambiguous', async () => {
      suggestSpy.mockResolvedValue([suggestion(0.85)]);

      const low = await importService.upload(file('low'), {}, acme, 'u1');

      expect(applySpy).not.toHaveBeenCalled();
      expect(low.matchedCount).toBe(0);
      expect(txRows.get('bt-1')).toEqual(expect.objectContaining({ matchStatus: 'suggested' }));

      txRows.set('bt-2', { id: 'bt-2', status: 'booked', matchStatus: 'unmatched' });
      suggestSpy.mockResolvedValue([suggestion(0.98), suggestion(0.95)]);
      parsedStatements = [statement([tx({ amount: '7.00' })])];

      const ambiguous = await importService.upload(file('ambiguous'), {}, acme, 'u1');

      expect(applySpy).not.toHaveBeenCalled();
      expect(ambiguous.matchedCount).toBe(0);
    });
  });
});
