import { UserEntity } from '@forepath/identity/backend';

import { samePerson } from './approval-persons';
import { FleetPersonEntity } from './fleet-identity.entities';

const NATIVE = '6f1c1b0e-0000-4000-8000-000000000001';
const OTHER = '6f1c1b0e-0000-4000-8000-000000000002';

function manager(
  persons: Record<string, { email: string | null; emailVerified: boolean }>,
  users: Record<string, { email: string; emailConfirmedAt?: Date; keycloakSub?: string }>,
) {
  const lookups: string[] = [];

  return {
    lookups,
    getRepository: (entity: unknown) => ({
      findOne: async ({ where }: { where: { personId?: string; id?: string } }) => {
        lookups.push(String(where.personId ?? where.id));

        if (entity === FleetPersonEntity) {
          const p = where.personId ? persons[where.personId] : undefined;

          return p ? { personId: where.personId, ...p } : null;
        }

        if (entity === UserEntity) return (where.id && users[where.id]) || null;

        return null;
      },
    }),
  };
}

describe('two-person rules: the same person (3.24)', () => {
  const m = manager(
    {
      'fleet:f1:alice': { email: 'Alice@Example.com', emailVerified: true },
      'fleet:f2:alice': { email: 'alice@example.com', emailVerified: true },
      'fleet:f1:bob': { email: 'bob@example.com', emailVerified: true },
      'fleet:f1:eve': { email: 'carol@example.com', emailVerified: false },
    },
    {
      [NATIVE]: { email: 'alice@example.com', emailConfirmedAt: new Date() },
      [OTHER]: { email: 'carol@example.com', emailConfirmedAt: new Date() },
    },
  );

  it('matches equal ids, also the cut-over `user:` form', async () => {
    await expect(samePerson(m as never, 'fleet:f1:alice', 'fleet:f1:alice')).resolves.toBe(true);
    await expect(samePerson(m as never, NATIVE, `user:${NATIVE}`)).resolves.toBe(true);
    await expect(samePerson(m as never, null, NATIVE)).resolves.toBe(false);
  });

  it('treats the same verified email as the same person across fleets and native accounts', async () => {
    await expect(samePerson(m as never, 'fleet:f1:alice', NATIVE)).resolves.toBe(true);
    await expect(samePerson(m as never, 'fleet:f1:alice', 'fleet:f2:alice')).resolves.toBe(true);
    await expect(samePerson(m as never, 'fleet:f1:alice', 'fleet:f1:bob')).resolves.toBe(false);
  });

  it('ignores unverified fleet emails and compares native accounts by id only', async () => {
    await expect(samePerson(m as never, 'fleet:f1:eve', OTHER)).resolves.toBe(false);

    const before = m.lookups.length;

    await expect(samePerson(m as never, NATIVE, OTHER)).resolves.toBe(false);
    expect(m.lookups.length).toBe(before);
  });
});
