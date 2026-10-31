import { FleetAuditService } from './fleet-audit.service';

const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';
const GONE = '6f1c1b0e-0000-4000-8000-0000000000ff';

function service(rows: { actorType: string; actorId: string | null }[]) {
  const lookups: string[][] = [];
  const query = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () =>
      rows.map((r, i) => ({
        seq: String(i + 1),
        at: new Date('2026-10-29T10:00:00Z'),
        action: 'grant.put',
        clusterId: null,
        target: 'grant/1',
        details: {},
        ...r,
      })),
    ),
  };
  const repo = { createQueryBuilder: () => query };
  const users = {
    find: jest.fn(async ({ where }: { where: { id: { _value: string[] } } }) => {
      lookups.push(where.id._value);

      return [{ id: ALICE, email: 'alice@example.com' }].filter((u) => where.id._value.includes(u.id));
    }),
  };

  return { lookups, users, svc: new FleetAuditService(repo as never, users as never) };
}

describe('FleetAuditService.list: actor labels (D11)', () => {
  it('adds the acting user email (null for deleted users / other actors) with one batched lookup', async () => {
    const { svc, lookups } = service([
      { actorType: 'user', actorId: ALICE },
      { actorType: 'user', actorId: GONE },
      { actorType: 'user', actorId: ALICE },
      { actorType: 'api-key', actorId: null },
      { actorType: 'system', actorId: null },
    ]);
    const out = await svc.list({});

    expect(out.map((e) => e.actorEmail)).toEqual(['alice@example.com', null, 'alice@example.com', null, null]);
    expect(lookups).toEqual([[ALICE, GONE]]);
  });

  it('skips the lookup when no user acted', async () => {
    const { svc, users } = service([{ actorType: 'system', actorId: null }]);

    await svc.list({});

    expect(users.find).not.toHaveBeenCalled();
  });
});
