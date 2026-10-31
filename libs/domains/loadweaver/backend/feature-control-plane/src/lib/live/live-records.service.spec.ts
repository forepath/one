import { UserEntity } from '@forepath/identity/backend';

import type { AccessCaller } from '../access/access.utils';
import { LiveRecordsService } from './live-records.service';

const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';
const BOB = '6f1c1b0e-0000-4000-8000-000000000002';
const GONE = '6f1c1b0e-0000-4000-8000-0000000000ff';

function session(id: string, project: string, userId: string | null) {
  return {
    id,
    user_id: userId,
    project,
    target: `replica/${project}/web/app/0`,
    node: 'n1',
    recorded: false,
    recording_key: null,
    exit_code: 0,
    started_at: new Date('2026-10-29T10:00:00Z'),
    ended_at: null,
  };
}

function service(caller: AccessCaller, rows: ReturnType<typeof session>[]) {
  const userLookups: string[][] = [];
  const users = [
    { id: ALICE, email: 'alice@example.com' },
    { id: BOB, email: 'bob@example.com' },
  ];
  const dataSource = {
    query: jest.fn(async () => rows),
    getRepository: (entity: unknown) => ({
      find: async ({ where }: { where: { id?: { _value: string[] } } }) => {
        if (entity !== UserEntity) return [];

        const ids = where.id?._value ?? [];

        userLookups.push(ids);

        return users.filter((u) => ids.includes(u.id));
      },
    }),
  };
  const access = { caller: jest.fn(async () => caller) };

  return {
    userLookups,
    svc: new LiveRecordsService(dataSource as never, access as never, {} as never, {} as never),
  };
}

describe('LiveRecordsService: user labels (D11)', () => {
  it('returns the user email next to the id, "deleted" users as null, in one lookup', async () => {
    const { svc, userLookups } = service({ isApiKey: false, clusterRole: 'auditor', projects: new Map() }, [
      session('s1', 'shop', ALICE),
      session('s2', 'shop', GONE),
      session('s3', 'shop', null),
    ]);
    const out = await svc.sessions(undefined);

    expect(out.map((s) => [s.userId, s.userEmail])).toEqual([
      [ALICE, 'alice@example.com'],
      [GONE, null],
      [null, null],
    ]);
    expect(userLookups).toEqual([[ALICE, GONE]]);
  });

  it('only resolves users of records the caller may read (no names beyond the record authz)', async () => {
    const { svc, userLookups } = service({ isApiKey: false, projects: new Map([['shop', 'admin' as const]]) }, [
      session('s1', 'shop', ALICE),
      session('s2', 'billing', BOB),
    ]);
    const out = await svc.sessions(undefined);

    expect(out.map((s) => s.id)).toEqual(['s1']);
    expect(userLookups).toEqual([[ALICE]]);
    expect(JSON.stringify(out)).not.toContain('bob@example.com');
  });
});
