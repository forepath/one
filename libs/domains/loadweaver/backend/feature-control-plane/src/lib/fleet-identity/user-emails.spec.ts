import { UserEntity } from '@forepath/identity/backend';

import { FleetPersonEntity } from './fleet-identity.entities';
import { emailOf, userEmails, userIdsByEmail } from './user-emails';

const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';
const BOB = '6f1c1b0e-0000-4000-8000-000000000002';
const GONE = '6f1c1b0e-0000-4000-8000-0000000000ff';

interface FindArgs {
  where: Record<string, unknown>;
}

/** A manager whose `find` honours `In(...)` / equality and records every query per store. */
function manager() {
  const users = [
    { id: ALICE, email: 'alice@example.com' },
    { id: BOB, email: 'bob@example.com' },
  ];
  const persons = [
    { personId: 'fleet:f1:carol', email: 'carol@example.com', emailVerified: true },
    { personId: 'fleet:f1:mallory', email: 'boss@example.com', emailVerified: false },
  ];
  const queries: { store: string; where: Record<string, unknown> }[] = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      const value = row[key];
      const operator = condition as { _type?: string; _value?: unknown[] };

      return operator?._type === 'in' ? (operator._value ?? []).includes(value) : value === condition;
    });

  return {
    queries,
    getRepository: (entity: unknown) => ({
      find: async ({ where }: FindArgs) => {
        const store = entity === UserEntity ? 'users' : entity === FleetPersonEntity ? 'persons' : 'other';

        queries.push({ store, where });

        const rows: Record<string, unknown>[] = store === 'users' ? users : store === 'persons' ? persons : [];

        return rows.filter((row) => matches(row, where));
      },
    }),
  };
}

describe('userEmails (user labels instead of ids, D11)', () => {
  it('resolves native users, `user:` ids and verified fleet persons in one query per store', async () => {
    const m = manager();
    const emails = await userEmails(m as never, [ALICE, `user:${BOB}`, ALICE, 'fleet:f1:carol', null, undefined]);

    expect(emails.get(ALICE)).toBe('alice@example.com');
    expect(emails.get(`user:${BOB}`)).toBe('bob@example.com');
    expect(emails.get('fleet:f1:carol')).toBe('carol@example.com');
    // Batched: one users query (both ids, deduplicated) and one fleet-persons query, never one per row.
    expect(m.queries.map((q) => q.store)).toEqual(['users', 'persons']);
    expect((m.queries[0].where['id'] as { _value: string[] })._value).toEqual([ALICE, BOB]);
  });

  it('maps a deleted user to null (the console shows "Deleted user")', async () => {
    const emails = await userEmails(manager() as never, [GONE]);

    expect(emails.has(GONE)).toBe(true);
    expect(emails.get(GONE)).toBeNull();
  });

  it('never shows an unverified fleet email (no look-alike names)', async () => {
    const emails = await userEmails(manager() as never, ['fleet:f1:mallory']);

    expect(emails.get('fleet:f1:mallory')).toBeNull();
  });

  it('does not query for actor keywords or empty input', async () => {
    const m = manager();
    const emails = await userEmails(m as never, ['api-key', 'system', 'git', null]);

    expect(m.queries).toEqual([]);
    expect([...emails.values()]).toEqual([null, null, null]);
  });

  it('only looks up the ids it is given (callers pass visible records only)', async () => {
    const m = manager();

    await userEmails(m as never, [ALICE]);

    expect(m.queries).toHaveLength(1);
    expect((m.queries[0].where['id'] as { _value: string[] })._value).toEqual([ALICE]);
  });

  it('emailOf: null for no id or an unknown one', () => {
    const emails = new Map([[ALICE, 'alice@example.com']]);

    expect(emailOf(emails, ALICE)).toBe('alice@example.com');
    expect(emailOf(emails, BOB)).toBeNull();
    expect(emailOf(emails, null)).toBeNull();
  });

  it('userIdsByEmail: native users and verified fleet persons with that email', async () => {
    const m = manager();

    expect(await userIdsByEmail(m as never, ' Alice@Example.com ')).toEqual([ALICE]);
    expect(await userIdsByEmail(m as never, 'carol@example.com')).toEqual(['fleet:f1:carol']);
    expect(await userIdsByEmail(m as never, 'boss@example.com')).toEqual([]);
  });
});
