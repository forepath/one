import { createHash } from 'node:crypto';

import { fleetAutoTrustEnabled } from '../constants/fleet.constants';
import type { FleetClusterHealth } from '../entities/fleet-cluster.entity';
import { clusterAvailability, type FleetAvailability } from './cluster-availability';
import { fleetClaimsIgnored } from './fleet-identity-claims';

/**
 * Fleet overview (3.25 "Fleet overview"): one card per cluster from its own overview / updates / plans endpoints,
 * a merged needs-attention inbox, the sites with known locations for the world map, and a side-by-side comparison
 * (versions, capacity, policy drift). Pure functions over what the fleet fetched, so they are tested without HTTP.
 */

/** The parts of the control plane's `GET /overview` the fleet uses. */
export interface ClusterOverviewLike {
  headline?: { state?: string; message?: string };
  inbox?: ClusterInboxItemLike[];
  summary?: {
    sites?: number;
    nodes?: { total?: number; up?: number };
    deployments?: number;
    capacity?: {
      cpuMillis?: { used?: number; total?: number };
      memoryBytes?: { used?: number; total?: number; reserve?: number };
    } | null;
    alertsFiring?: number;
  };
}

export interface ClusterInboxItemLike {
  kind?: string;
  severity?: 'critical' | 'warning' | 'info' | string;
  title?: string;
  link?: string;
  project?: string;
  since?: string;
}

/** The parts of `GET /updates/status` the fleet uses. */
export interface ClusterUpdatesLike {
  clusterVersion?: string | null;
  controlPlaneVersion?: string | null;
  latestAvailable?: string | null;
  activeRollout?: string | null;
}

/** A resource as `GET /resources` returns it. */
export interface ClusterResourceLike {
  kind?: string;
  metadata?: { name?: string; project?: string | null };
  spec?: unknown;
}

export interface ClusterSnapshot {
  overview: ClusterOverviewLike | null;
  updates: ClusterUpdatesLike | null;
  pendingPlans: number | null;
  sites: ClusterResourceLike[] | null;
  /** Which parts could not be fetched (`overview: 503`, ...). */
  errors: string[];
  fetchedAt: string;
  /**
   * When `overview` was fetched, if earlier than `fetchedAt` (2026-10-31): the cluster didn't answer this time, so the
   * last good overview is kept and its counts are shown "as of" then. Missing / null: fetched now (or never).
   */
  overviewAt?: string | null;
}

export interface FleetClusterRef {
  id: string;
  name: string;
  /** Normalised endpoint (origin + base path) of the cluster: its own console lives there. */
  endpoint?: string;
}

export interface FleetCardCluster extends FleetClusterRef {
  reference: string | null;
  state: string;
  readOnlyUntil: Date | null;
  health: FleetClusterHealth;
}

export interface FleetCard {
  id: string;
  name: string;
  reference: string | null;
  state: string;
  readOnlyUntil: string | null;
  connection: FleetClusterHealth;
  /** Unreachable / read-only (3.43, 2026-10-31): the console disables changes to the cluster then. */
  availability: FleetAvailability;
  /**
   * Health, alert, node and inbox counts are from this earlier snapshot (the cluster is unreachable or didn't answer
   * its overview): shown "as of" it. Null: current. Capacity is never carried over (null then).
   */
  asOf: string | null;
  health: { state: string; message: string } | null;
  sites: number | null;
  nodes: { total: number; up: number } | null;
  deployments: number | null;
  capacity: {
    cpu: { used: number; total: number; percent: number | null };
    memory: { used: number; total: number; reserve: number; percent: number | null };
  } | null;
  version: string | null;
  latestAvailable: string | null;
  upgradeAvailable: boolean;
  activeRollout: string | null;
  openAlerts: number | null;
  pendingPlans: number | null;
  inbox: { critical: number; warning: number; info: number };
  /** Console route of the cluster's own overview. */
  link: string;
  /** Project grants only: aggregates of the whole cluster are withheld. */
  limited: boolean;
  errors: string[];
  fetchedAt: string | null;
}

const percent = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Semver-ish comparison of `1.2.3[-x]` (prefix `v` allowed); unknown formats compare as equal. */
export function compareFleetVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10));
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;

    if (Number.isNaN(x) || Number.isNaN(y)) return 0;

    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

export function buildFleetCard(
  cluster: FleetCardCluster,
  snapshot: ClusterSnapshot | null,
  limited: boolean,
): FleetCard {
  const base = {
    id: cluster.id,
    name: cluster.name,
    reference: cluster.reference,
    state: cluster.state,
    readOnlyUntil: cluster.readOnlyUntil ? cluster.readOnlyUntil.toISOString() : null,
    connection: cluster.health,
    availability: clusterAvailability(cluster.health),
    link: `/clusters/${cluster.id}`,
    limited,
    version: cluster.health.version,
  };

  if (limited || !snapshot) {
    return {
      ...base,
      health: null,
      sites: null,
      nodes: null,
      deployments: null,
      capacity: null,
      latestAvailable: null,
      upgradeAvailable: false,
      activeRollout: null,
      openAlerts: null,
      pendingPlans: null,
      inbox: { critical: 0, warning: 0, info: 0 },
      asOf: null,
      errors: snapshot?.errors ?? [],
      fetchedAt: snapshot?.fetchedAt ?? null,
    };
  }

  const asOf = snapshotAsOf(cluster.health, snapshot);

  const summary = snapshot.overview?.summary;
  const cpu = summary?.capacity?.cpuMillis;
  const memory = summary?.capacity?.memoryBytes;
  const version = snapshot.updates?.clusterVersion ?? snapshot.updates?.controlPlaneVersion ?? base.version ?? null;
  const latest = snapshot.updates?.latestAvailable ?? null;
  const inbox = { critical: 0, warning: 0, info: 0 };

  for (const item of snapshot.overview?.inbox ?? []) {
    if (item.severity === 'critical' || item.severity === 'warning' || item.severity === 'info') inbox[item.severity]++;
  }

  return {
    ...base,
    version,
    health: snapshot.overview?.headline
      ? { state: snapshot.overview.headline.state ?? 'unknown', message: snapshot.overview.headline.message ?? '' }
      : null,
    sites: num(summary?.sites),
    nodes: summary?.nodes ? { total: num(summary.nodes.total) ?? 0, up: num(summary.nodes.up) ?? 0 } : null,
    deployments: num(summary?.deployments),
    // Only what the cluster reports now: an unreachable cluster's last snapshot keeps its other facts (marked "as of"),
    // but not a capacity that may be long gone (2026-10-31).
    capacity:
      cpu && memory && cluster.health.state !== 'unreachable' && !asOf
        ? {
            cpu: { used: cpu.used ?? 0, total: cpu.total ?? 0, percent: percent(cpu.used ?? 0, cpu.total ?? 0) },
            memory: {
              used: memory.used ?? 0,
              total: memory.total ?? 0,
              reserve: memory.reserve ?? 0,
              percent: percent(memory.used ?? 0, memory.total ?? 0),
            },
          }
        : null,
    latestAvailable: latest,
    upgradeAvailable: !!(version && latest && compareFleetVersions(version, latest) < 0),
    activeRollout: snapshot.updates?.activeRollout ?? null,
    openAlerts: num(summary?.alertsFiring),
    pendingPlans: snapshot.pendingPlans,
    inbox,
    asOf,
    errors: snapshot.errors,
    fetchedAt: snapshot.fetchedAt,
  };
}

/**
 * When the snapshot's overview counts are from (2026-10-31), if they aren't current: kept from an earlier fetch, or
 * fetched before the fleet's health poll found the cluster unreachable. Null: current (or no overview at all).
 */
export function snapshotAsOf(
  health: Pick<FleetClusterHealth, 'state'> | null | undefined,
  snapshot: ClusterSnapshot,
): string | null {
  if (!snapshot.overview) return null;

  const at = snapshot.overviewAt ?? snapshot.fetchedAt;

  return at !== snapshot.fetchedAt || health?.state === 'unreachable' ? at : null;
}

export interface FleetInboxItem {
  clusterId: string;
  clusterName: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  /** Console route inside the cluster (`/clusters/<id>` + the cluster's own link). */
  link: string;
  /**
   * The same page in the cluster's own console (`<endpoint><link>`): only for approvals on a cluster that doesn't
   * trust this fleet (the one thing that can't be done through the fleet then). Everything else — and approvals on
   * a trusting cluster — is resolved in the fleet (2026-10-29).
   */
  nativeUrl: string | null;
  project: string | null;
  since: string | null;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

const APPROVAL_KINDS: ReadonlySet<string> = new Set(['approval', 'cross-project-request']);

/**
 * A cluster that doesn't trust this fleet and where the fleet couldn't fix that by itself (2026-10-29): approvals,
 * favourites and saved views don't work through the fleet until a fleet admin establishes trust (cluster page).
 */
function trustItem(cluster: FleetClusterRef, health: FleetClusterHealth): FleetInboxItem | null {
  if (health.state !== 'healthy' && health.state !== 'degraded') return null;

  const keyMissing = /^key \S+ of fleet \S+ is not registered$/i.test(health.identityReason ?? '');

  if (health.identity !== 'untrusted') return null;

  // "Not in effect" (2026-10-29): trust is in place, but the connection's credential can't carry identities, so
  // approvals, secrets and requests on someone's behalf don't work through the fleet — fixed on the connection.
  if (fleetClaimsIgnored(health))
    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      kind: 'trust',
      severity: 'warning',
      title: `Cluster ${cluster.name} ignores the fleet's identities on this connection`,
      link: `/fleet/clusters/${cluster.id}`,
      nativeUrl: null,
      project: null,
      since: health.checkedAt,
    };

  // The fleet establishes trust by itself after the next check: no item until that was tried (and didn't work).
  if (fleetAutoTrustEnabled() && !health.trust) return null;

  if (health.trust?.state === 'established' || health.trust?.state === 'already-trusted') return null;

  const outcome = health.trust?.state;
  const title =
    outcome === 'revoked'
      ? `Cluster ${cluster.name} no longer trusts this fleet`
      : outcome === 'identity-mismatch'
        ? `Cluster ${cluster.name} answers with another cluster identity: trust was not established`
        : keyMissing
          ? `Cluster ${cluster.name} doesn't know the fleet's active key`
          : `Cluster ${cluster.name} doesn't trust this fleet yet`;

  return {
    clusterId: cluster.id,
    clusterName: cluster.name,
    kind: 'trust',
    severity: 'warning',
    title,
    link: `/fleet/clusters/${cluster.id}`,
    nativeUrl: null,
    project: null,
    since: health.trust?.at ?? health.checkedAt,
  };
}

/**
 * One inbox across clusters: critical first, then what has waited longest; clusters that could not be reached
 * show up as their own critical item (an unreachable cluster needs attention, too).
 */
export function mergeInbox(
  entries: readonly { cluster: FleetClusterRef; health: FleetClusterHealth; inbox: ClusterInboxItemLike[] | null }[],
  limit = 500,
): FleetInboxItem[] {
  const items: FleetInboxItem[] = [];

  for (const { cluster, health, inbox } of entries) {
    if (health.state === 'unreachable' || health.state === 'credential-rejected')
      items.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        kind: 'connection',
        severity: 'critical',
        title:
          health.state === 'unreachable'
            ? `Cluster ${cluster.name} is unreachable`
            : `Cluster ${cluster.name} rejects the fleet's service credential`,
        link: `/clusters/${cluster.id}/connection`,
        nativeUrl: null,
        project: null,
        since: health.checkedAt,
      });
    else if (health.database?.readOnly)
      // 3.43 (2026-10-31): the cluster answers, but its control plane can't write: changes through the fleet pause.
      items.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        kind: 'read-only',
        severity: 'critical',
        title: `Cluster ${cluster.name} is read-only: ${clusterAvailability(health).reason}`.slice(0, 512),
        link: `/clusters/${cluster.id}`,
        nativeUrl: null,
        project: null,
        since: health.checkedAt,
      });

    const trust = trustItem(cluster, health);

    if (trust) items.push(trust);

    const nativeApprovals = health.identity !== 'verified';

    for (const item of inbox ?? []) {
      const severity =
        item.severity === 'critical' || item.severity === 'warning' || item.severity === 'info'
          ? item.severity
          : 'info';
      const link = typeof item.link === 'string' && item.link.startsWith('/') ? item.link : '/';

      items.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        kind: item.kind ?? 'unknown',
        severity,
        title: String(item.title ?? '').slice(0, 512),
        link: `/clusters/${cluster.id}${link}`,
        nativeUrl:
          nativeApprovals && APPROVAL_KINDS.has(item.kind ?? '') && cluster.endpoint
            ? `${cluster.endpoint.replace(/\/+$/, '')}${link}`
            : null,
        project: item.project ?? null,
        since: item.since ?? null,
      });
    }
  }

  return items
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (a.since ?? '￿').localeCompare(b.since ?? '￿') ||
        a.clusterName.localeCompare(b.clusterName),
    )
    .slice(0, limit);
}

export interface FleetSite {
  clusterId: string;
  clusterName: string;
  site: string;
  latitude: number;
  longitude: number;
  label: string | null;
}

/** Sites with a `spec.location` for the world map; sites without one are counted, not placed. */
export function fleetSites(entries: readonly { cluster: FleetClusterRef; sites: ClusterResourceLike[] | null }[]): {
  sites: FleetSite[];
  withoutLocation: number;
} {
  const sites: FleetSite[] = [];
  let withoutLocation = 0;

  for (const { cluster, sites: resources } of entries) {
    for (const resource of resources ?? []) {
      if (resource.kind !== undefined && resource.kind !== 'Site') continue;

      const location = (resource.spec as { location?: { latitude?: unknown; longitude?: unknown; label?: unknown } })
        ?.location;
      const latitude = num(location?.latitude);
      const longitude = num(location?.longitude);

      if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        withoutLocation++;
        continue;
      }

      sites.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        site: resource.metadata?.name ?? 'unknown',
        latitude,
        longitude,
        label: typeof location?.label === 'string' ? location.label : null,
      });
    }
  }

  return { sites, withoutLocation };
}

/** Kinds compared for policy drift between clusters. */
export const DRIFT_KINDS = ['Policy', 'ImagePolicy', 'BackupPolicy', 'MaintenanceWindow', 'AlertRule'] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);

  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );

  return value;
}

export function specHash(spec: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(spec ?? null)))
    .digest('hex')
    .slice(0, 16);
}

export interface DriftItem {
  kind: string;
  project: string | null;
  name: string;
  /** Spec hash per cluster id; missing = the resource does not exist there. */
  clusters: Record<string, string | null>;
  state: 'missing' | 'different';
}

export interface FleetComparison {
  clusters: FleetClusterRef[];
  versions: { clusterId: string; version: string | null; latestAvailable: string | null }[];
  sameVersion: boolean;
  capacity: { clusterId: string; capacity: FleetCard['capacity']; nodes: FleetCard['nodes']; sites: number | null }[];
  policyDrift: {
    kinds: readonly string[];
    identical: number;
    missing: number;
    different: number;
    items: DriftItem[];
  };
}

export function compareClusters(
  entries: readonly { cluster: FleetClusterRef; card: FleetCard; policies: ClusterResourceLike[] | null }[],
  itemLimit = 1000,
): FleetComparison {
  const versions = entries.map((e) => ({
    clusterId: e.cluster.id,
    version: e.card.version,
    latestAvailable: e.card.latestAvailable,
  }));
  const known = versions.map((v) => v.version).filter((v): v is string => !!v);
  const byKey = new Map<string, DriftItem>();

  for (const { cluster, policies } of entries) {
    for (const resource of policies ?? []) {
      const kind = resource.kind ?? '';

      if (!(DRIFT_KINDS as readonly string[]).includes(kind) || !resource.metadata?.name) continue;

      const project = resource.metadata.project ?? null;
      const key = `${kind}/${project ?? '-'}/${resource.metadata.name}`;
      const item =
        byKey.get(key) ??
        ({
          kind,
          project,
          name: resource.metadata.name,
          clusters: Object.fromEntries(entries.map((e) => [e.cluster.id, null])),
          state: 'missing',
        } as DriftItem);

      item.clusters[cluster.id] = specHash(resource.spec);
      byKey.set(key, item);
    }
  }

  let identical = 0;
  let missing = 0;
  let different = 0;
  const items: DriftItem[] = [];

  for (const item of [...byKey.values()].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) || (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name),
  )) {
    const hashes = Object.values(item.clusters);

    if (hashes.some((h) => h === null)) {
      item.state = 'missing';
      missing++;
    } else if (new Set(hashes).size > 1) {
      item.state = 'different';
      different++;
    } else {
      identical++;
      continue;
    }

    if (items.length < itemLimit) items.push(item);
  }

  return {
    clusters: entries.map((e) => e.cluster),
    versions,
    sameVersion: known.length === entries.length && new Set(known).size <= 1,
    capacity: entries.map((e) => ({
      clusterId: e.cluster.id,
      capacity: e.card.capacity,
      nodes: e.card.nodes,
      sites: e.card.sites,
    })),
    policyDrift: { kinds: DRIFT_KINDS, identical, missing, different, items },
  };
}
