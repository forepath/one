import type { DataSource } from 'typeorm';

import type { AuditLogService } from '../services/audit-log.service';
import { DraftRetentionService } from './draft-retention.service';

describe('DraftRetentionService (3.36)', () => {
  function setup(locked = true, affected = 1) {
    const repo = {
      find: jest.fn(async () => [{ id: 'd1', version: 3, owner: 'u1', title: 't', projects: ['shop'], ops: [{}] }]),
      update: jest.fn(async () => ({ affected })),
      delete: jest.fn(async () => ({ affected: 2 })),
    };
    const manager = { query: jest.fn(async () => [{ locked }]), getRepository: () => repo };
    const dataSource = {
      transaction: async (fn: (m: unknown) => unknown) => await fn(manager),
    } as unknown as DataSource;
    const audit = { record: jest.fn() };
    const service = new DraftRetentionService(dataSource, audit as unknown as AuditLogService);

    return { service, repo, audit };
  }

  it('discards idle open drafts (version-guarded, audited) and purges old closed ones', async () => {
    const { service, repo, audit } = setup();
    const now = Date.parse('2026-10-27T00:00:00Z');

    expect(await service.tick(now)).toEqual({ expired: 1, purged: 2 });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'd1', version: 3, status: 'open' },
      { status: 'discarded', version: 4 },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'draft.expire', actor: { type: 'system', id: null }, project: 'shop' }),
    );
    const where = (repo.find.mock.calls[0] as unknown as [{ where: { updatedAt: { value: Date } } }])[0].where;

    expect(where.updatedAt.value.toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('keeps a draft edited meanwhile, and does nothing without the lock', async () => {
    const edited = setup(true, 0);

    expect(await edited.service.tick()).toEqual({ expired: 0, purged: 2 });
    expect(edited.audit.record).not.toHaveBeenCalled();

    const other = setup(false);

    expect(await other.service.tick()).toEqual({ expired: 0, purged: 0 });
    expect(other.repo.find).not.toHaveBeenCalled();
  });
});
