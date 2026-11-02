import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';
import { dnssecDs, type DsRecord } from '@forepath/loadweaver/shared/util-pki';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A key signs this long before the control plane rolls it over (3.15: automatic rollovers). */
export const DNSSEC_ROLLOVER_AFTER_MS = 365 * DAY_MS;
/** After a rollover, the old DS stays at the parent this long once the new one is visible (caches, bind's checks). */
export const DS_WITHDRAW_AFTER_MS = 2 * DAY_MS;
/** A retired key is removed from the instances this long after its DS disappeared from the parent. */
export const KEY_REMOVE_AFTER_MS = 14 * DAY_MS;
/** Turning DNSSEC off: keys go once no DS has been at the parent for this long (bind signs until then). */
export const INSECURE_REMOVE_AFTER_MS = 2 * DAY_MS;

export interface DnssecKeyState {
  id: string;
  publicKey: string;
  createdAt: Date;
  retiredAt: Date | null;
  /** Whether the parent publishes this key's DS (last successful check). */
  dsAtParent: boolean;
  /** Since when the parent has been seen without it. */
  dsAbsentSince: Date | null;
  /** Since when the parent has published it (continuously). */
  dsPresentSince?: Date | null;
}

export type DnssecAction = { type: 'create' } | { type: 'retire'; id: string } | { type: 'remove'; id: string };

const newestFirst = (a: DnssecKeyState, b: DnssecKeyState) => b.createdAt.getTime() - a.createdAt.getTime();

/** The signing key: the newest one not retired. */
export function currentKey(keys: readonly DnssecKeyState[]): DnssecKeyState | undefined {
  return keys.filter((k) => !k.retiredAt).sort(newestFirst)[0];
}

const absentFor = (key: DnssecKeyState, ms: number, now: Date) =>
  !key.dsAtParent && !!key.dsAbsentSince && now.getTime() - key.dsAbsentSince.getTime() >= ms;

/**
 * What the control plane does next for a zone's keys. A rollover starts only once the current key's DS is at the
 * parent and the previous rollover is complete (its old key removed); bind keeps both keys published until it saw the
 * new DS at the parent itself. Disabling DNSSEC keeps the zone signed (`insecure` policy) until no DS is left.
 */
export function dnssecActions(enabled: boolean, keys: readonly DnssecKeyState[], now: Date): DnssecAction[] {
  if (!enabled) {
    return keys.length > 0 && keys.every((k) => absentFor(k, INSECURE_REMOVE_AFTER_MS, now))
      ? keys.map((k) => ({ type: 'remove', id: k.id }))
      : [];
  }

  const current = currentKey(keys);

  if (!current) return [{ type: 'create' }];

  const actions: DnssecAction[] = keys
    .filter((k) => !k.retiredAt && k.id !== current.id)
    .map((k) => ({ type: 'retire', id: k.id }));
  const retired = keys.filter((k) => k.retiredAt);

  for (const key of retired) {
    if (current.dsAtParent && absentFor(key, KEY_REMOVE_AFTER_MS, now)) actions.push({ type: 'remove', id: key.id });
  }

  const rolloverDue = now.getTime() - current.createdAt.getTime() >= DNSSEC_ROLLOVER_AFTER_MS;

  if (rolloverDue && current.dsAtParent && retired.length === 0) {
    actions.push({ type: 'create' }, { type: 'retire', id: current.id });
  }

  return actions;
}

/** The DS set the parent should publish now: the current key, plus a retired key until its successor's DS settled. */
export function expectedDs(zone: string, enabled: boolean, keys: readonly DnssecKeyState[], now: Date): DsRecord[] {
  if (!enabled) return [];

  const current = currentKey(keys);

  if (!current) return [];

  // The old DS goes only once the new one has been at the parent for a while (caches, bind's own check).
  const settled =
    current.dsAtParent &&
    !!current.dsPresentSince &&
    now.getTime() - current.dsPresentSince.getTime() >= DS_WITHDRAW_AFTER_MS;
  const keep = keys.filter((k) => k.id === current.id || (k.retiredAt && !settled));

  return keep.sort(newestFirst).map((k) => dnssecDs(zone, k.publicKey));
}

/** The policy the instances run: signing, or the safe way out while a DS may still be at the parent. */
export function dnssecMode(enabled: boolean, keys: readonly DnssecKeyState[]): 'signed' | 'insecure' | null {
  if (keys.length === 0) return null;

  return enabled ? 'signed' : 'insecure';
}

export function sameDs(a: readonly DsRecord[], b: readonly DsRecord[]): boolean {
  const key = (d: DsRecord) => `${d.keyTag}/${d.algorithm}/${d.digestType}/${d.digest.toUpperCase()}`;

  return a.map(key).sort().join() === b.map(key).sort().join();
}

/** The plan in words when zones turn DNSSEC on or off (3.15: the plan shows DS state and rollover steps). */
export function dnssecPlanSteps(
  before: ReadonlyMap<string, DnsZoneSpec>,
  after: ReadonlyMap<string, DnsZoneSpec>,
): { layer: string; action: string; node: string; summary: string }[] {
  const steps: { layer: string; action: string; node: string; summary: string }[] = [];

  for (const [name, zone] of after) {
    const was = before.get(name)?.dnssec ?? false;
    const publish = zone.registrar
      ? `the DS is published through ${zone.registrar.type}`
      : 'publish the DS shown by GET /dns/dnssec at the parent';

    if (zone.dnssec && !was)
      steps.push({
        layer: 'dnssec',
        action: 'create',
        node: name,
        summary: `signs ${zone.zone} with DNSSEC: a key is generated and pushed to every bind9 instance, then ${publish}; keys roll over yearly once the DS is at the parent`,
      });

    if (!zone.dnssec && was)
      steps.push({
        layer: 'dnssec',
        action: 'delete',
        node: name,
        summary: `takes DNSSEC off ${zone.zone}: it stays signed until the DS is gone at the parent${zone.registrar ? '' : ' (remove it there)'}, then serves unsigned`,
      });
  }

  return steps;
}
