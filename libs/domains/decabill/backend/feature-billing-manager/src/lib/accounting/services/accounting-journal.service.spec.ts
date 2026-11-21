import { BadRequestException } from '@nestjs/common';

import { AccountingAccountType, JournalEntryKind, JournalSourceType } from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingEntryLinkEntity } from '../entities/accounting-entry-link.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingJournalLineEntity } from '../entities/accounting-journal-line.entity';

import { AccountingJournalService } from './accounting-journal.service';

describe('AccountingJournalService', () => {
  const accounts = [
    { id: 'a-bank', chartId: 'c1', number: '1200', type: AccountingAccountType.ASSET, isActive: true },
    { id: 'a-rev', chartId: 'c1', number: '8400', type: AccountingAccountType.REVENUE, isActive: true },
    { id: 'a-other-chart', chartId: 'c2', number: '8400', type: AccountingAccountType.REVENUE, isActive: true },
    { id: 'a-stat', chartId: 'c1', number: '9000', type: AccountingAccountType.STATISTICAL, isActive: true },
    { id: 'a-inactive', chartId: 'c1', number: '4900', type: AccountingAccountType.EXPENSE, isActive: false },
  ];
  let saved: Record<string, unknown[]>;
  let sequence = 0;
  const repo = (name: string) => ({
    findOne: jest.fn(async () => null),
    find: jest.fn(async ({ where }: { where: { id: { _value: string[] } } }) =>
      accounts.filter((a) => where.id._value.includes(a.id)),
    ),
    create: (x: unknown) => x,
    save: jest.fn(async (x: unknown) => {
      saved[name] = [...(saved[name] ?? []), ...(Array.isArray(x) ? x : [x])];

      return Array.isArray(x) ? x : { id: `${name}-id`, ...(x as object) };
    }),
  });
  const repos = new Map<unknown, ReturnType<typeof repo>>();
  const manager = {
    getRepository: (entity: unknown) => {
      if (!repos.has(entity)) {
        repos.set(entity, repo(String((entity as { name?: string }).name)));
      }

      return repos.get(entity)!;
    },
    query: jest.fn(async () => [{ last_value: ++sequence }]),
  };
  const fiscalYears = {
    resolvePostingTarget: jest.fn(async (date: string) => ({
      fiscalYear: { id: 'fy-1', chartId: 'c1', name: '2026' },
      period: { id: 'p-1' },
      postingDate: date,
    })),
  };
  const service = new AccountingJournalService({} as never, fiscalYears as never);
  const base = {
    documentDate: '2026-03-01',
    description: 'Test',
    kind: JournalEntryKind.MANUAL,
    sourceType: JournalSourceType.MANUAL,
    lines: [
      { accountId: 'a-bank', debit: 119 },
      { accountId: 'a-rev', credit: 119 },
    ],
  };

  beforeEach(() => {
    saved = {};
    sequence = 0;
    repos.clear();
    manager.query.mockClear();
  });

  it('writes a balanced entry with a sequential number in the resolved period', async () => {
    const result = await service.post(base, manager as never);

    expect(result.created).toBe(true);
    expect(saved[AccountingJournalEntryEntity.name][0]).toEqual(
      expect.objectContaining({ entryNumber: 1, fiscalYearId: 'fy-1', periodId: 'p-1', total: 119 }),
    );
    expect(saved[AccountingJournalLineEntity.name]).toHaveLength(2);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('billing_accounting_entry_number_sequences'), [
      'fy-1',
    ]);
  });

  it('rejects unbalanced entries and lines with both sides', async () => {
    await expect(
      service.post(
        {
          ...base,
          lines: [
            { accountId: 'a-bank', debit: 100 },
            { accountId: 'a-rev', credit: 99.99 },
          ],
        },
        manager as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.post(
        {
          ...base,
          lines: [
            { accountId: 'a-bank', debit: 1, credit: 1 },
            { accountId: 'a-rev', credit: 0 },
          ],
        },
        manager as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects accounts of another chart, inactive accounts and carry-forward accounts outside openings', async () => {
    await expect(
      service.post(
        {
          ...base,
          lines: [
            { accountId: 'a-bank', debit: 1 },
            { accountId: 'a-other-chart', credit: 1 },
          ],
        },
        manager as never,
      ),
    ).rejects.toThrow(/does not belong to the chart/);
    await expect(
      service.post(
        {
          ...base,
          lines: [
            { accountId: 'a-bank', debit: 1 },
            { accountId: 'a-inactive', credit: 1 },
          ],
        },
        manager as never,
      ),
    ).rejects.toThrow(/inactive/);
    await expect(
      service.post(
        {
          ...base,
          lines: [
            { accountId: 'a-bank', debit: 1 },
            { accountId: 'a-stat', credit: 1 },
          ],
        },
        manager as never,
      ),
    ).rejects.toThrow(/reserved for opening balances/);
  });

  it('returns the existing entry for a repeated idempotency key', async () => {
    const existing = { id: 'e-1', idempotencyKey: 'invoice:inv-1:issued' };

    manager.getRepository(AccountingJournalEntryEntity).findOne.mockResolvedValueOnce(existing as never);

    const result = await service.post({ ...base, idempotencyKey: 'invoice:inv-1:issued' }, manager as never);

    expect(result).toEqual({ entry: existing, created: false });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('stores deduplicated links with the entry', async () => {
    await service.post(
      {
        ...base,
        links: [
          { linkType: 'invoice' as never, targetId: 'inv-1', role: 'source' as never },
          { linkType: 'invoice' as never, targetId: 'inv-1', role: 'source' as never },
        ],
      },
      manager as never,
    );

    expect(saved[AccountingEntryLinkEntity.name]).toHaveLength(1);
    expect(saved[AccountingAccountEntity.name]).toBeUndefined();
  });
});
