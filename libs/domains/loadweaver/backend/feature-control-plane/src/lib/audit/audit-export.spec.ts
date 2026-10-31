import { AuditService, type AuditEntryDto } from './audit.service';

const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';

function entry(overrides: Partial<AuditEntryDto>): AuditEntryDto {
  return {
    seq: '1',
    at: '2026-10-29T10:00:00.000Z',
    actorType: 'user',
    actorId: ALICE,
    actorEmail: 'alice@example.com',
    action: 'plan.apply',
    target: 'plan/p1',
    project: 'shop',
    details: {},
    hash: 'ab',
    ...overrides,
  };
}

describe('AuditService.export: actor email column (D11)', () => {
  function service(entries: AuditEntryDto[]) {
    const svc = Object.create(AuditService.prototype) as AuditService;
    const list = jest.spyOn(svc, 'list').mockResolvedValue({ entries, before: null });

    return { svc, list };
  }

  it('CSV has actorEmail next to actorId, from the scoped list (deleted / non-user actors empty)', async () => {
    const { svc, list } = service([
      entry({}),
      entry({ seq: '2', actorId: '6f1c1b0e-0000-4000-8000-0000000000ff', actorEmail: null }),
      entry({ seq: '3', actorType: 'system', actorId: null, actorEmail: null }),
    ]);
    const lines = (await svc.export(undefined, {}, 'csv')).trim().split('\n');

    expect(lines[0]).toBe('seq,at,actorType,actorId,actorEmail,action,target,project,details,hash');
    expect(lines[1]).toContain(`"${ALICE}","alice@example.com","plan.apply"`);
    expect(lines[2]).toContain('-0000000000ff","","plan.apply"');
    expect(lines[3]).toContain('"system","","","plan.apply"');
    // The same scoped, batched `list` as NDJSON and the console.
    expect(list).toHaveBeenCalledWith(undefined, expect.objectContaining({ limit: 500 }));
  });

  it('NDJSON carries actorEmail too', async () => {
    const { svc } = service([entry({})]);

    expect(JSON.parse((await svc.export(undefined, {}, 'ndjson')).trim()).actorEmail).toBe('alice@example.com');
  });
});
