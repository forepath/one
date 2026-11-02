import type { DnsRecord } from '@forepath/shared/backend/util-hosting-providers';

import { ownedTypes, ownershipName, ownershipValue, type DesiredRecord } from './dns-desired.utils';

export interface ZoneOperations {
  upsert: DnsRecord[];
  delete: string[];
  /** Names Loadweaver wants but doesn't own: left untouched (3.15). */
  conflicts: string[];
}

const strip = (value: string) => value.replace(/^"|"$/g, '');

/**
 * Brings one zone at one provider to the desired records, touching only names Loadweaver owns (ownership TXT) or
 * names that are free. Providers keep one record per value, so a record set is reconciled value by value.
 */
export function reconcileZone(
  desired: readonly DesiredRecord[],
  actual: readonly DnsRecord[],
  clusterId: string,
): ZoneOperations {
  const ops: ZoneOperations = { upsert: [], delete: [], conflicts: [] };
  const at = (fqdn: string, type?: string) => actual.filter((r) => r.name === fqdn && (!type || r.type === type));
  const ownership = (fqdn: string) =>
    ownedTypes(
      at(ownershipName(fqdn), 'TXT').map((r) => r.content),
      clusterId,
    );
  const desiredByName = new Map<string, DesiredRecord[]>();

  for (const r of desired) desiredByName.set(r.fqdn, [...(desiredByName.get(r.fqdn) ?? []), r]);

  for (const [fqdn, sets] of desiredByName) {
    const owned = ownership(fqdn);
    const foreign = sets.filter((s) => owned === null && at(fqdn, s.type).length > 0);

    if (foreign.length > 0) {
      ops.conflicts.push(...foreign.map((s) => `${s.type} ${fqdn} exists and is not managed by this cluster`));
      continue;
    }

    for (const set of sets) {
      const existing = at(fqdn, set.type);

      for (const value of set.values) {
        const match = existing.find((r) => strip(r.content) === value);

        if (!match)
          ops.upsert.push({
            name: fqdn,
            type: set.type,
            content: value,
            ttl: set.ttl,
            ...(set.priority !== undefined ? { priority: set.priority } : {}),
          });
        else if (match.ttl !== set.ttl && match.ttl !== 1) ops.upsert.push({ ...match, ttl: set.ttl });
      }

      ops.delete.push(
        ...existing.filter((r) => r.id && !set.values.includes(strip(r.content))).map((r) => r.id as string),
      );
    }

    // Types managed here before but no longer desired at this name.
    for (const type of (owned ?? []).filter((t) => !sets.some((s) => s.type === t)))
      ops.delete.push(
        ...at(fqdn, type)
          .filter((r) => r.id)
          .map((r) => r.id as string),
      );

    const value = ownershipValue(
      clusterId,
      sets.map((s) => s.type),
    );
    const marker = at(ownershipName(fqdn), 'TXT').find((r) => strip(r.content).startsWith('heritage=loadweaver,'));

    if (!marker || strip(marker.content) !== value)
      ops.upsert.push({
        ...(marker?.id ? { id: marker.id } : {}),
        name: ownershipName(fqdn),
        type: 'TXT',
        content: value,
        ttl: 300,
      });
  }

  // Names this cluster owns but no longer wants: remove what it created, then the marker.
  for (const marker of actual.filter((r) => r.type === 'TXT' && r.name.startsWith('_loadweaver.'))) {
    const fqdn = marker.name.slice('_loadweaver.'.length).replace(/^wildcard\./, '*.');
    const owned = ownedTypes([marker.content], clusterId);

    if (owned === null || desiredByName.has(fqdn)) continue;

    for (const type of owned)
      ops.delete.push(
        ...at(fqdn, type)
          .filter((r) => r.id)
          .map((r) => r.id as string),
      );

    if (marker.id) ops.delete.push(marker.id);
  }

  return ops;
}
