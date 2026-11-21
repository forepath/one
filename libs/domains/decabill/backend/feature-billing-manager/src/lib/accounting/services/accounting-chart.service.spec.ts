import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AccountingAccountRole as R, AccountingAccountType as T } from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingChartEntity } from '../entities/accounting-chart.entity';
import { AccountingJournalLineEntity } from '../entities/accounting-journal-line.entity';
import { AccountingTaxCodeEntity } from '../entities/accounting-tax-code.entity';
import { CHART_TEMPLATES } from '../profiles/accounting-profiles.registry';

import { AccountingChartService } from './accounting-chart.service';

type Row = Record<string, unknown>;

/** Minimal in-memory TypeORM repository (equality `where` only, which is all the chart service uses). */
function memoryRepo(prefix: string) {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);

  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null),
    find: jest.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn((x: Row) => ({ ...x })),
    save: jest.fn(async (x: Row) => {
      const saved = { id: `${prefix}-${++seq}`, isActive: true, ...x };

      rows.push(saved);

      return saved;
    }),
    update: jest.fn(async (criteria: string | Row, patch: Row) => {
      for (const r of rows.filter((row) =>
        typeof criteria === 'string' ? row['id'] === criteria : matches(row, criteria),
      )) {
        Object.assign(r, patch);
      }
    }),
    delete: jest.fn(async (id: string) => {
      rows.splice(
        rows.findIndex((r) => r['id'] === id),
        1,
      );
    }),
  };
}

describe('AccountingChartService', () => {
  let repos: Map<unknown, ReturnType<typeof memoryRepo>>;
  const repo = (entity: unknown) => repos.get(entity)!;
  const accounts = () => repo(AccountingAccountEntity).rows;
  const manager = { getRepository: jest.fn((entity: unknown) => repo(entity)) };
  const dataSource = {
    manager,
    getRepository: jest.fn((entity: unknown) => repo(entity)),
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => await cb(manager)),
  };
  let service: AccountingChartService;
  const seedAccount = (overrides: Row) => {
    const row = {
      id: `seed-${accounts().length + 1}`,
      chartId: 'c1',
      name: 'Seed',
      type: T.ASSET,
      role: null,
      isActive: true,
      ...overrides,
    };

    accounts().push(row);

    return row;
  };
  const book = (accountId: string) =>
    repo(AccountingJournalLineEntity).rows.push({ id: `line-${accountId}`, accountId });

  beforeEach(() => {
    jest.clearAllMocks();
    repos = new Map<unknown, ReturnType<typeof memoryRepo>>([
      [AccountingChartEntity, memoryRepo('chart')],
      [AccountingAccountEntity, memoryRepo('acc')],
      [AccountingTaxCodeEntity, memoryRepo('tc')],
      [AccountingJournalLineEntity, memoryRepo('line')],
    ]);
    repo(AccountingChartEntity).rows.push({ id: 'c1', code: 'MY-CHART', name: 'Mine' });
    service = new AccountingChartService(dataSource as never);
  });

  describe('createFromTemplate', () => {
    const template = CHART_TEMPLATES['DE-SKR03'];

    it('instantiates accounts, tax codes, automatic accounts and VAT account roles in one transaction', async () => {
      const chart = await service.createFromTemplate('DE-SKR03', { code: ' skr03-2027 ' });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(chart).toEqual(
        expect.objectContaining({
          code: 'SKR03-2027',
          name: template.name,
          country: 'DE',
          templateKey: 'DE-SKR03',
          accountLength: 4,
        }),
      );

      const created = accounts().filter((a) => a['chartId'] === chart.id);
      const taxCodes = repo(AccountingTaxCodeEntity).rows.filter((t) => t['chartId'] === chart.id);

      expect(created).toHaveLength(template.accounts.length);
      expect(taxCodes).toHaveLength(template.taxCodes.length);
      expect(created.every((a) => a['isTemplate'] === true)).toBe(true);

      // Automatic accounts reference their tax code.
      for (const tplAccount of template.accounts.filter((a) => a.automaticTaxCode)) {
        const saved = created.find((a) => a['number'] === tplAccount.number)!;
        const taxCode = taxCodes.find((t) => t['code'] === tplAccount.automaticTaxCode);

        expect(saved['isAutomatic']).toBe(true);
        expect(saved['defaultTaxCodeId']).toBe(taxCode?.['id'] ?? null);
      }

      // Tax codes point at the accounts holding their VAT roles.
      const withRole = template.taxCodes.filter(
        (tc) => tc.accountRole && template.accounts.some((a) => a.role === tc.accountRole),
      );

      expect(withRole.length).toBeGreaterThan(0);

      for (const tc of withRole) {
        const account = created.find((a) => a['role'] === tc.accountRole)!;

        expect(taxCodes.find((t) => t['code'] === tc.code)!['accountId']).toBe(account['id']);
      }
    });

    it('uses the caller transaction when a manager is given', async () => {
      await service.createFromTemplate('DE-SKR03', {}, manager as never);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(repo(AccountingChartEntity).rows.some((c) => c['code'] === 'DE-SKR03')).toBe(true);
    });

    it('rejects unknown templates and duplicate chart codes', async () => {
      await expect(service.createFromTemplate('XX-NOPE')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createFromTemplate('DE-SKR03', { code: 'my-chart' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(accounts()).toHaveLength(0);
    });
  });

  describe('account maintenance', () => {
    const input = { number: '1210', name: ' Bank 2 ', type: T.ASSET };

    it('creates a trimmed account and rejects duplicates, bad numbers, names and types', async () => {
      const created = await service.createAccount('c1', input);

      expect(created).toEqual(
        expect.objectContaining({
          chartId: 'c1',
          number: '1210',
          name: 'Bank 2',
          isTemplate: false,
          isActive: true,
          role: null,
        }),
      );

      await expect(service.createAccount('c1', input)).rejects.toThrow('Account 1210 already exists');
      await expect(service.createAccount('c1', { ...input, number: '#12' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createAccount('c1', { ...input, number: '1'.repeat(21) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createAccount('c1', { ...input, number: '1211', name: '  ' })).rejects.toThrow(
        'Account name is required',
      );
      await expect(service.createAccount('c1', { ...input, number: '1211', type: 'cash' as T })).rejects.toThrow(
        'Invalid account type',
      );
      await expect(service.createAccount('c1', { ...input, number: '1211', role: 'nope' as R })).rejects.toThrow(
        'Invalid account role',
      );
      await expect(service.createAccount('missing', { ...input, number: '1211' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows each role only once per chart', async () => {
      seedAccount({ number: '1200', role: R.BANK });

      await expect(service.createAccount('c1', { ...input, role: R.BANK })).rejects.toThrow(
        'Role "bank" is already assigned to account 1200',
      );
      await expect(service.createAccount('c1', { ...input, role: R.PAYABLES })).resolves.toEqual(
        expect.objectContaining({ role: R.PAYABLES }),
      );
    });

    it('invalidates the role cache when accounts change', async () => {
      await expect(service.getAccountByRole('c1', R.BANK)).resolves.toBeNull();

      await service.createAccount('c1', { ...input, role: R.BANK });

      await expect(service.getAccountByRole('c1', R.BANK)).resolves.toEqual(
        expect.objectContaining({ number: '1210' }),
      );
    });

    it('requires role accounts to exist and be active', async () => {
      // Seeded before the first lookup: the role map is cached per chart until the service changes an account.
      seedAccount({ number: '1600', role: R.PAYABLES, isActive: false });

      await expect(service.requireAccountByRole('c1', R.BANK)).rejects.toThrow('No account is assigned to role "bank"');
      await expect(service.requireAccountByRole('c1', R.PAYABLES)).rejects.toThrow(
        'Account 1600 (role "payables") is inactive',
      );
    });

    it('freezes number and type of accounts with postings but allows renaming and deactivation', async () => {
      const account = seedAccount({ number: '1200', name: 'Bank', type: T.ASSET });

      book(String(account['id']));

      await expect(service.updateAccount(String(account['id']), { number: '1201' })).rejects.toThrow(
        'cannot be changed',
      );
      await expect(service.updateAccount(String(account['id']), { type: T.LIABILITY })).rejects.toThrow(
        'cannot be changed',
      );

      const updated = await service.updateAccount(String(account['id']), {
        number: ' 1200 ',
        name: 'Main bank',
        isActive: false,
      });

      expect(updated).toEqual(
        expect.objectContaining({ number: '1200', name: 'Main bank', isActive: false, type: T.ASSET }),
      );
    });

    it('renumbers unused accounts but not onto an existing number or a taken role', async () => {
      const account = seedAccount({ number: '1200' });

      seedAccount({ number: '1300', role: R.RECEIVABLES });

      await expect(service.updateAccount(String(account['id']), { number: '1300' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.updateAccount(String(account['id']), { role: R.RECEIVABLES })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.updateAccount(String(account['id']), { number: '1250' })).resolves.toEqual(
        expect.objectContaining({ number: '1250' }),
      );
    });

    it('deletes only unused accounts and unlinks them from tax codes', async () => {
      const used = seedAccount({ number: '1200' });
      const unused = seedAccount({ number: '1776' });

      book(String(used['id']));
      repo(AccountingTaxCodeEntity).rows.push({
        id: 'tc-1',
        chartId: 'c1',
        code: 'OUT_STD',
        accountId: unused['id'],
        reverseAccountId: null,
      });
      repo(AccountingTaxCodeEntity).rows.push({
        id: 'tc-2',
        chartId: 'c1',
        code: 'RC',
        accountId: null,
        reverseAccountId: unused['id'],
      });

      await expect(service.deleteAccount(String(used['id']))).rejects.toThrow(/deactivate them instead/);

      await service.deleteAccount(String(unused['id']));

      expect(accounts().map((a) => a['number'])).toEqual(['1200']);
      expect(repo(AccountingTaxCodeEntity).rows.map((t) => [t['accountId'], t['reverseAccountId']])).toEqual([
        [null, null],
        [null, null],
      ]);
    });
  });

  describe('CSV / DATEV import', () => {
    it('parses semicolon and comma CSV, skips headers, blank lines and keeps only known types', () => {
      const rows = service.parseAccountCsv(
        [
          'Konto;Name;Typ;Position',
          '1200;"Bank; Hauptkonto";Asset;A.II.4',
          '',
          '8400,Erlöse 19 %,revenue',
          '4930;Bürobedarf;cost',
          ';no number',
        ].join('\r\n'),
      );

      expect(rows).toEqual([
        { number: '1200', name: 'Bank; Hauptkonto', type: T.ASSET, statementPosition: 'A.II.4' },
        { number: '8400', name: 'Erlöse 19 %', type: T.REVENUE, statementPosition: undefined },
        { number: '4930', name: 'Bürobedarf', type: undefined, statementPosition: undefined },
      ]);
    });

    it('keeps commas inside quoted comma-CSV fields and skips a German header row', () => {
      expect(service.parseAccountCsv(['Kontonummer,Bezeichnung', '1200,"Bank, Hauptkonto",asset'].join('\n'))).toEqual([
        { number: '1200', name: 'Bank, Hauptkonto', type: T.ASSET, statementPosition: undefined },
      ]);
    });

    it('imports new accounts, updates names of existing ones, never touches roles and counts bad rows', async () => {
      seedAccount({ number: '1200', name: 'Old', role: R.BANK, statementPosition: 'X' });

      const result = await service.importAccounts('c1', [
        { number: '1200', name: 'Bank renamed' },
        { number: '4930', name: 'Bürobedarf' },
        { number: '8400', name: 'Erlöse', type: T.REVENUE, statementPosition: 'P1' },
        { number: '#bad', name: 'Invalid number' },
        { number: '4931', name: '   ' },
      ]);

      expect(result).toEqual({ created: 2, updated: 1, skipped: 2 });
      expect(accounts().find((a) => a['number'] === '1200')).toEqual(
        expect.objectContaining({ name: 'Bank renamed', role: R.BANK, statementPosition: 'X' }),
      );
      expect(accounts().find((a) => a['number'] === '4930')).toEqual(
        expect.objectContaining({ type: T.EXPENSE, statementPosition: null }),
      );
      expect(accounts().find((a) => a['number'] === '8400')).toEqual(
        expect.objectContaining({ type: T.REVENUE, statementPosition: 'P1' }),
      );
    });

    it('rejects oversized imports before touching the database', async () => {
      const rows = Array.from({ length: 20_001 }, (_, i) => ({ number: String(i), name: 'x' }));

      await expect(service.importAccounts('c1', rows)).rejects.toThrow('At most 20,000 accounts per import');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('parses DATEV Kontenbeschriftungen and rejects other files', () => {
      const file = [
        '"EXTF";700;20;"Kontenbeschriftungen";3',
        'Konto;Kontenbeschriftung;Sprach-ID',
        '1200;"Bank ""Haupt""";de-DE',
        '8400;Erlöse;de-DE',
      ].join('\n');

      expect(service.parseDatevAccountLabels(file)).toEqual([
        { number: '1200', name: 'Bank "Haupt"' },
        { number: '8400', name: 'Erlöse' },
      ]);
      expect(() => service.parseDatevAccountLabels('Konto;Name\n1200;Bank')).toThrow('Not a DATEV EXTF file');
      expect(() => service.parseDatevAccountLabels('"EXTF";700;21;"Buchungsstapel"\nheader\n1;2')).toThrow(
        /category 20/,
      );
    });
  });

  it('treats accounts with journal lines as used', async () => {
    book('acc-x');

    await expect(service.isAccountUsed('acc-x')).resolves.toBe(true);
    await expect(service.isAccountUsed('acc-y')).resolves.toBe(false);
  });
});
