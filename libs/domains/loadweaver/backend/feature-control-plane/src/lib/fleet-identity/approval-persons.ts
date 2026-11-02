import { UserEntity } from '@forepath/identity/backend';
import type { EntityManager } from 'typeorm';

import { FleetPersonEntity } from './fleet-identity.entities';
import { isFleetPerson } from './fleet-identity.utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Creators / requesters are stored as `<id>`, `user:<id>` (cut-overs) or `fleet:<iss>:<sub>`. */
export function personKey(id: string): string {
  return id.startsWith('user:') ? id.slice('user:'.length) : id;
}

async function verifiedEmail(manager: EntityManager, id: string): Promise<string | null> {
  if (isFleetPerson(id)) {
    const person = await manager.getRepository(FleetPersonEntity).findOne({ where: { personId: id } });

    return person?.emailVerified && person.email ? person.email.trim().toLowerCase() : null;
  }

  if (!UUID.test(id)) return null;

  const user = await manager.getRepository(UserEntity).findOne({ where: { id } });

  // Users-mode confirmation, or an account of the identity provider (keycloak) that vouches for its emails.
  return user?.email && (user.emailConfirmedAt || user.keycloakSub) ? user.email.trim().toLowerCase() : null;
}

/**
 * Whether two acting persons are the same for the two-person rules (3.24): the same id, or — when a fleet person is
 * involved — the same verified email (fleet ↔ native account, or two fleets). Only ever used to **exclude** someone
 * from approving; an equal email never grants anything.
 */
export async function samePerson(
  manager: EntityManager,
  a: string | null | undefined,
  b: string | null | undefined,
): Promise<boolean> {
  if (!a || !b) return false;

  const left = personKey(a);
  const right = personKey(b);

  if (left === right) return true;

  if (!isFleetPerson(left) && !isFleetPerson(right)) return false;

  const [first, second] = await Promise.all([verifiedEmail(manager, left), verifiedEmail(manager, right)]);

  return !!first && first === second;
}
