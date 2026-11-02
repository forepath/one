import {
  compareWith,
  riskRank,
  type PostureCategory,
  type PostureCondition,
  type PostureRiskLevel,
} from '@forepath/loadweaver/shared/util-model';

import type { PostureMatchKey, PostureStatus, PostureVendorDevice } from '../remote-access/posture-plugin';

/** What an integration says about one enrolled device, normalized and stored with the client (3.31). */
export interface IntegrationFact {
  integration: string;
  type: string;
  category: PostureCategory;
  status: PostureStatus;
  risk?: PostureRiskLevel;
  reasons: string[];
  checkedAt: string;
  /** After this the fact counts as unknown (sync failing, integration disabled). */
  staleAt: string;
  externalId?: string;
  matchedBy?: PostureMatchKey;
}

/** The device certificate of the last report, verified at report time. */
export interface CertificateFact {
  source: 'company' | 'loadweaver';
  valid: boolean;
  revoked: boolean;
  serialNumber?: string;
  notAfter?: string;
  reasons: string[];
  checkedAt: string;
}

export interface DeviceIdentifiers {
  serial?: string;
  hostname?: string;
  deviceId?: string;
}

const DAY_MS = 86_400_000;

/** `1.2.10` vs `1.2.9`: numeric per part, missing parts are 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => parseInt(p, 10) || 0);
  const pb = b.split(/[.\-+]/).map((p) => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);

    if (diff !== 0) return Math.sign(diff);
  }

  return 0;
}

export function normalizeSerial(value: string | undefined): string | undefined {
  const v = value?.trim().toUpperCase();

  return v && !['0', 'UNKNOWN', 'NONE', 'N/A', 'SYSTEM SERIAL NUMBER', 'TO BE FILLED BY O.E.M.'].includes(v)
    ? v
    : undefined;
}

/** Hostnames compare by their first label, case-insensitively (`ALICE-MBP.corp.example.com` = `alice-mbp`). */
export function normalizeHostname(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase().split('.')[0];

  return v || undefined;
}

export function normalizeDeviceId(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase();

  return v || undefined;
}

/** E-mail / UPN of a device user or client owner, compared case-insensitively. */
export function normalizeUser(value: string | undefined | null): string | undefined {
  const v = value?.trim().toLowerCase();

  return v || undefined;
}

/** Identifiers pinned with a client (normalized), as stored in `posture`. */
export interface PinnedIdentifiers {
  deviceId?: string;
  serialNumber?: string;
  hostname?: string;
}

export type PinOutcome =
  | { pinned: PinnedIdentifiers; newIdentifiers: boolean; hostnameTaken: boolean }
  | { error: 'changed' | 'taken'; key: 'deviceId' | 'serialNumber'; message: string };

/**
 * Pins a report's identifiers (3.31): device id, serial and hostname are normalized and pinned at the first report;
 * a later different device id / serial is refused (enroll again), a device id / serial another valid client holds is
 * refused. Hostnames are weaker (self-reported, often generic): one held by another valid client is just not pinned
 * (hostname matching then finds nothing for this device), and a later different hostname keeps the pinned one.
 */
export function pinIdentifiers(
  current: PinnedIdentifiers | null | undefined,
  report: { deviceId?: string; serialNumber?: string; hostname?: string },
  others: readonly (PinnedIdentifiers | null | undefined)[],
): PinOutcome {
  const pinnedId = normalizeDeviceId(current?.deviceId);
  const pinnedSerial = normalizeSerial(current?.serialNumber);
  const pinnedHost = normalizeHostname(current?.hostname);
  const reportedId = normalizeDeviceId(report.deviceId);
  const reportedSerial = normalizeSerial(report.serialNumber);
  const reportedHost = normalizeHostname(report.hostname);

  if (pinnedId && reportedId !== pinnedId)
    return {
      error: 'changed',
      key: 'deviceId',
      message: 'this device reported another device id before; enroll it again',
    };

  if (pinnedSerial && reportedSerial !== pinnedSerial)
    return {
      error: 'changed',
      key: 'serialNumber',
      message: 'this device reported another serial number before; enroll it again',
    };

  const newId = !pinnedId && !!reportedId;
  const newSerial = !pinnedSerial && !!reportedSerial;
  const newHost = !pinnedHost && !!reportedHost;

  if (newId && others.some((o) => normalizeDeviceId(o?.deviceId) === reportedId))
    return { error: 'taken', key: 'deviceId', message: 'this device id belongs to another enrolled device' };

  if (newSerial && others.some((o) => normalizeSerial(o?.serialNumber) === reportedSerial))
    return { error: 'taken', key: 'serialNumber', message: 'this serial number belongs to another enrolled device' };

  const hostnameTaken = newHost && others.some((o) => normalizeHostname(o?.hostname) === reportedHost);
  const deviceId = pinnedId ?? reportedId;
  const serialNumber = pinnedSerial ?? reportedSerial;
  const hostname = pinnedHost ?? (newHost && !hostnameTaken ? reportedHost : undefined);

  return {
    pinned: {
      ...(deviceId ? { deviceId } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      ...(hostname ? { hostname } : {}),
    },
    newIdentifiers: newId || newSerial || (newHost && !hostnameTaken),
    hostnameTaken,
  };
}

/** Partial unique indexes (migration 048) on the pinned identifiers of non-revoked clients. */
export const PINNED_IDENTIFIER_INDEXES = {
  deviceId: 'UQ_lw_vpn_clients_pinned_device_id',
  serialNumber: 'UQ_lw_vpn_clients_pinned_serial',
  hostname: 'UQ_lw_vpn_clients_pinned_hostname',
} as const;

/** The pinned identifier a unique violation (Postgres 23505) is about, or null for any other error. */
export function pinnedIdentifierViolation(error: unknown): keyof typeof PINNED_IDENTIFIER_INDEXES | null {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.driverError?.code ?? e?.code;
  const constraint = e?.driverError?.constraint ?? e?.constraint;

  if (code !== '23505' || !constraint) return null;

  const entry = Object.entries(PINNED_IDENTIFIER_INDEXES).find(([, name]) => name === constraint);

  return entry ? (entry[0] as keyof typeof PINNED_IDENTIFIER_INDEXES) : null;
}

export interface VendorIndex {
  serial: Map<string, PostureVendorDevice[]>;
  deviceId: Map<string, PostureVendorDevice[]>;
  hostname: Map<string, PostureVendorDevice[]>;
}

function add(map: Map<string, PostureVendorDevice[]>, key: string | undefined, device: PostureVendorDevice): void {
  if (!key) return;

  const list = map.get(key);

  if (list) {
    if (!list.includes(device)) list.push(device);
  } else map.set(key, [device]);
}

export function indexVendorDevices(devices: readonly PostureVendorDevice[]): VendorIndex {
  const index: VendorIndex = { serial: new Map(), deviceId: new Map(), hostname: new Map() };

  for (const d of devices) {
    add(index.serial, normalizeSerial(d.serial), d);
    add(index.hostname, normalizeHostname(d.hostname), d);

    for (const id of d.deviceIds) add(index.deviceId, normalizeDeviceId(id), d);
  }

  return index;
}

export type MatchResult =
  | { device: PostureVendorDevice; by: PostureMatchKey }
  | { ambiguous: PostureMatchKey; count: number }
  | { userMismatch: PostureMatchKey; externalId: string }
  | null;

export interface MatchOptions {
  /**
   * When set, the matched record's users must include this owner (e-mail / UPN, case-insensitive); `null` = the
   * client has no usable owner, so a required user match fails. Omitted = no user check.
   */
  requireUser?: string | null;
}

function latest(devices: PostureVendorDevice[]): PostureVendorDevice {
  return [...devices].sort((a, b) => (Date.parse(b.lastSeen ?? '') || 0) - (Date.parse(a.lastSeen ?? '') || 0))[0];
}

/**
 * Finds the vendor record of an enrolled device by the keys in order. Serials and device ids are unique per device
 * (duplicates are re-enrolments: the most recently seen wins); several records with the same hostname are ambiguous.
 * With `requireUser`, a record whose users don't include the client's owner is refused (no fallback to later keys:
 * the device was identified, it just belongs to someone else).
 */
export function matchDevice(
  index: VendorIndex,
  identifiers: DeviceIdentifiers,
  matchBy: readonly PostureMatchKey[],
  options: MatchOptions = {},
): MatchResult {
  const found = findDevice(index, identifiers, matchBy);

  if (!found || !('device' in found) || options.requireUser === undefined) return found;

  const owner = normalizeUser(options.requireUser);

  if (owner && (found.device.users ?? []).some((u) => normalizeUser(u) === owner)) return found;

  return { userMismatch: found.by, externalId: found.device.externalId };
}

function findDevice(
  index: VendorIndex,
  identifiers: DeviceIdentifiers,
  matchBy: readonly PostureMatchKey[],
): MatchResult {
  for (const key of matchBy) {
    const value =
      key === 'serial'
        ? normalizeSerial(identifiers.serial)
        : key === 'hostname'
          ? normalizeHostname(identifiers.hostname)
          : normalizeDeviceId(identifiers.deviceId);

    if (!value) continue;

    const found = index[key].get(value) ?? [];

    if (found.length === 1) return { device: found[0], by: key };

    if (found.length > 1) {
      if (key === 'hostname') return { ambiguous: key, count: found.length };

      return { device: latest(found), by: key };
    }
  }

  return null;
}

/** The fact stored for a device after a sync of an integration. */
export function integrationFact(
  integration: { name: string; type: string; category: PostureCategory; displayName: string; staleAfterMs: number },
  match: MatchResult,
  now: number,
): IntegrationFact {
  const base = {
    integration: integration.name,
    type: integration.type,
    category: integration.category,
    checkedAt: new Date(now).toISOString(),
    staleAt: new Date(now + integration.staleAfterMs).toISOString(),
  };

  if (!match) return { ...base, status: 'unknown', reasons: [`${integration.displayName}: device not found`] };

  if ('ambiguous' in match)
    return {
      ...base,
      status: 'unknown',
      reasons: [`${integration.displayName}: ${match.count} devices share this ${match.ambiguous}`],
    };

  if ('userMismatch' in match)
    return {
      ...base,
      status: 'unknown',
      reasons: [`${integration.displayName}: the device's user doesn't match the owner of this VPN client`],
      externalId: match.externalId,
      matchedBy: match.userMismatch,
    };

  return {
    ...base,
    status: match.device.status,
    ...(match.device.risk ? { risk: match.device.risk } : {}),
    reasons: match.device.reasons.slice(0, 10).map((r) => r.slice(0, 256)),
    externalId: match.device.externalId,
    matchedBy: match.by,
  };
}

/** Subset of the stored posture that conditions read. */
export interface PostureFactsView {
  report: {
    platform: string;
    osVersion: string;
    appVersion?: string;
    diskEncryption?: boolean;
    firewall?: boolean;
    screenLock?: boolean;
  } | null;
  certificate?: CertificateFact;
  integrations: Record<string, IntegrationFact>;
  /** Serial of the certificate the cluster CA issued last for this device (older ones are superseded). */
  certificateSerial: string | null;
}

function fresh(fact: IntegrationFact, now: number): boolean {
  return Date.parse(fact.staleAt) >= now;
}

/** Whether the device certificate counts as valid now, and why not. */
export function certificateState(view: PostureFactsView, now: number): { valid: boolean; reasons: string[] } {
  const cert = view.certificate;

  if (!cert) return { valid: false, reasons: ['no device certificate'] };

  if (!cert.valid)
    return { valid: false, reasons: cert.reasons.length ? cert.reasons : ['the device certificate is invalid'] };

  if (cert.notAfter && Date.parse(cert.notAfter) < now)
    return { valid: false, reasons: ['the device certificate expired'] };

  if (cert.source === 'loadweaver' && (!view.certificateSerial || cert.serialNumber !== view.certificateSerial))
    return { valid: false, reasons: ['the device certificate was superseded or revoked'] };

  return { valid: true, reasons: [] };
}

function selectFacts(view: PostureFactsView, category: PostureCategory, integration?: string): IntegrationFact[] {
  return Object.values(view.integrations).filter(
    (f) => f.category === category && (!integration || f.integration === integration),
  );
}

/** Why a condition fails for the device (null when it holds). Unknowns fail: posture is fail-closed. */
export function conditionFailure(condition: PostureCondition, view: PostureFactsView, now: number): string | null {
  const report = view.report;

  switch (condition.kind) {
    case 'boolean': {
      if (condition.fact === 'device.certificate.valid') {
        const state = certificateState(view, now);

        return state.valid === condition.expected
          ? null
          : condition.expected
            ? state.reasons.join(', ')
            : 'the device certificate is valid';
      }

      const key = condition.fact.slice('device.'.length) as 'diskEncryption' | 'firewall' | 'screenLock';
      const value = report?.[key];

      if (value === undefined) return `${condition.text}: not reported`;

      return value === condition.expected ? null : `${condition.text}: reported ${value}`;
    }
    case 'version': {
      const value = condition.fact === 'device.osVersion' ? report?.osVersion : report?.appVersion;

      if (!value) return `${condition.text}: not reported`;

      return compareWith(condition.op, compareVersions(value, condition.value))
        ? null
        : `${condition.text}: is ${value}`;
    }
    case 'number': {
      const state = certificateState(view, now);

      if (!state.valid || !view.certificate?.notAfter)
        return `${condition.text}: ${state.reasons.join(', ') || 'unknown'}`;

      const days = Math.floor((Date.parse(view.certificate.notAfter) - now) / DAY_MS);

      return compareWith(condition.op, days - condition.value) ? null : `${condition.text}: ${days} days left`;
    }
    case 'platform': {
      if (!report) return `${condition.text}: not reported`;

      return (report.platform === condition.value) === (condition.op === '==')
        ? null
        : `${condition.text}: is ${report.platform}`;
    }
    case 'integration-compliant': {
      const facts = selectFacts(view, condition.category, condition.integration);
      const label = condition.integration ?? condition.category.toUpperCase();
      const current = facts.filter((f) => fresh(f, now));

      if (facts.length === 0) return `${label}: no result for this device`;

      if (current.length === 0) return `${label}: the last result is outdated`;

      const failing = current.filter((f) => f.status === 'non-compliant');
      const compliant = current.some((f) => f.status === 'compliant');

      if (condition.expected) {
        if (failing.length)
          return failing
            .flatMap((f) => (f.reasons.length ? f.reasons : [`${f.integration}: not compliant`]))
            .join(', ');

        return compliant
          ? null
          : current.flatMap((f) => (f.reasons.length ? f.reasons : [`${f.integration}: unknown`])).join(', ');
      }

      return failing.length ? null : `${condition.text}: the device is compliant or unknown`;
    }
    case 'integration-risk': {
      const facts = selectFacts(view, condition.category, condition.integration).filter((f) => fresh(f, now) && f.risk);
      const label = condition.integration ?? condition.category.toUpperCase();

      if (facts.length === 0) return `${label}: no current risk level for this device`;

      const worst = facts.reduce((a, b) =>
        riskRank(b.risk as PostureRiskLevel) > riskRank(a.risk as PostureRiskLevel) ? b : a,
      );
      const level = worst.risk as PostureRiskLevel;

      if (compareWith(condition.op, riskRank(level) - riskRank(condition.value))) return null;

      return `${label}: risk ${level}${worst.reasons.length ? ` (${worst.reasons.join(', ')})` : ''}`;
    }
  }
}

/** The verdict the older `plugins` rules compare (`compliant` / `low-risk` / …) from an integration's fact. */
export function legacyVerdict(view: PostureFactsView, type: string, now: number): { verdict: string; detail?: string } {
  const fact = view.integrations[type] ?? Object.values(view.integrations).find((f) => f.type === type);

  if (!fact || !fresh(fact, now)) return { verdict: 'unknown' };

  const detail = fact.reasons.length ? fact.reasons.join(', ') : undefined;

  if (fact.category === 'edr') {
    const verdict = fact.status === 'non-compliant' ? 'non-compliant' : fact.risk ? `${fact.risk}-risk` : 'unknown';

    return { verdict, ...(detail ? { detail } : {}) };
  }

  return { verdict: fact.status, ...(detail ? { detail } : {}) };
}
