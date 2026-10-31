import { UserEntity } from '@forepath/identity/backend';
import { In, type EntityManager } from 'typeorm';

import { personKey } from './approval-persons';
import { FleetPersonEntity } from './fleet-identity.entities';
import { isFleetPerson } from './fleet-identity.utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lookup = Pick<EntityManager, 'getRepository'>;

/**
 * The human-facing label of acting users (D11, no raw ids in the UI), resolved server-side from the identity users
 * table like Agenstra (`createdByEmail`, `actorEmail`) and Decabill (`userEmail`): one batched query per store
 * (native users by id, fleet persons by `fleet:<iss>:<sub>` with a verified email), never one per row.
 *
 * Only called with the ids of records the caller is already allowed to read (the label is part of that record's
 * response, so the record-level authz applies). Ids that resolve to nothing map to `null`: a deleted user (the
 * console shows "Deleted user"), a fleet person without a verified email, or an id that is no user at all.
 */
export async function userEmails(
  manager: Lookup,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  const keys = new Map(wanted.map((id) => [id, personKey(id)]));
  const native = [...new Set([...keys.values()].filter((key) => UUID.test(key)))];
  const fleet = [...new Set([...keys.values()].filter((key) => isFleetPerson(key)))];
  const found = new Map<string, string>();

  if (native.length) {
    const users = await manager
      .getRepository(UserEntity)
      .find({ where: { id: In(native) }, select: { id: true, email: true } });

    for (const user of users) if (user.email) found.set(user.id, user.email);
  }

  if (fleet.length) {
    const persons = await manager
      .getRepository(FleetPersonEntity)
      .find({ where: { personId: In(fleet) }, select: { personId: true, email: true, emailVerified: true } });

    // Unverified fleet emails are claims of the fleet only: not shown as a name (no look-alike approvers).
    for (const person of persons) if (person.email && person.emailVerified) found.set(person.personId, person.email);
  }

  return new Map(wanted.map((id) => [id, found.get(keys.get(id) as string) ?? null]));
}

/** The email of `id` in a {@link userEmails} result (`null` for no id or nothing found). */
export function emailOf(emails: ReadonlyMap<string, string | null>, id: string | null | undefined): string | null {
  return id ? (emails.get(id) ?? null) : null;
}

/**
 * The actor ids behind an email (the audit "Actor" filter takes what the console shows): native users with that email
 * and fleet persons with it verified. Only narrows a query that is already scoped to the caller's entries.
 */
export async function userIdsByEmail(manager: Lookup, email: string): Promise<string[]> {
  const normalized = email.trim().toLowerCase();
  const [users, persons] = await Promise.all([
    manager.getRepository(UserEntity).find({ where: { email: normalized }, select: { id: true } }),
    manager
      .getRepository(FleetPersonEntity)
      .find({ where: { email: normalized, emailVerified: true }, select: { personId: true } }),
  ]);

  return [...users.map((u) => u.id), ...persons.map((p) => p.personId)];
}
