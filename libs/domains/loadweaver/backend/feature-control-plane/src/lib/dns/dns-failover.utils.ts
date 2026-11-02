import type { Probe } from '@forepath/loadweaver/shared/util-agent-protocol';
import { dnsFailoverSpecSchema, type DnsFailoverSpec } from '@forepath/loadweaver/shared/util-model';

import { steer, type LatencyChoice, type Steering } from './steering.utils';

export function dnsFailovers(
  resources: readonly { kind: string; name: string; spec: Record<string, unknown> }[],
): Map<string, DnsFailoverSpec> {
  return new Map(
    resources.filter((r) => r.kind === 'DnsFailover').map((r) => [r.name, dnsFailoverSpecSchema.parse(r.spec)]),
  );
}

/** Modes that answer every healthy endpoint, steered per client or not. */
const ALL_HEALTHY_MODES = new Set<DnsFailoverSpec['mode']>(['multi-value', 'weighted', 'geo', 'latency']);

export interface FailoverAnswer {
  name: string;
  host: string;
  ttl: number;
  /** The default answer: what API providers serve and clients no steering view matches. */
  addresses: string[];
  /** Per-client answers for hosted bind9 (weighted / geo / latency). */
  steering?: Steering;
}

/** What a failover answers right now: the engine's choice, or its first endpoint before the first round. */
export function failoverAnswers(
  failovers: ReadonlyMap<string, DnsFailoverSpec>,
  states: ReadonlyMap<string, FailoverState>,
): FailoverAnswer[] {
  return [...failovers].map(([name, spec]) => {
    const state = states.get(name);
    const active =
      state?.active ??
      (ALL_HEALTHY_MODES.has(spec.mode) ? spec.endpoints.map((e) => e.name) : [spec.endpoints[0].name]);

    if (spec.mode === 'weighted' || spec.mode === 'geo' || spec.mode === 'latency') {
      const steered = steer(spec, active, state?.latency);

      return { name, host: spec.host, ttl: spec.ttl, ...steered };
    }

    return {
      name,
      host: spec.host,
      ttl: spec.ttl,
      addresses: spec.endpoints.filter((e) => active.includes(e.name)).map((e) => e.address),
    };
  });
}

/** Probing nodes per site (3.28: at least two sites probe, more add nothing but load). */
export const PROBERS_PER_SITE = 2;

export interface ProberNode {
  name: string;
  site: string;
}

export function probeId(failover: string, endpoint: string): string {
  return `${failover}/${endpoint}`;
}

function defaultPort(protocol: 'http' | 'https' | 'tcp'): number {
  return protocol === 'http' ? 80 : 443;
}

/**
 * Which node probes what (3.28): per endpoint, up to two nodes per site, from other sites than the endpoint's own
 * where such sites exist (a site that lost its uplink must not vote on itself).
 */
export function assignProbes(
  failovers: ReadonlyMap<string, DnsFailoverSpec>,
  nodes: readonly ProberNode[],
): Map<string, Probe[]> {
  const bySite = new Map<string, string[]>();

  for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name)))
    bySite.set(n.site, [...(bySite.get(n.site) ?? []), n.name]);

  const result = new Map<string, Probe[]>();

  for (const [name, f] of failovers) {
    for (const endpoint of f.endpoints) {
      const ownSite = endpoint.site;
      const outside = [...bySite.keys()].filter((s) => s !== ownSite);
      const probersIn = (sites: string[]) => sites.flatMap((s) => (bySite.get(s) ?? []).slice(0, PROBERS_PER_SITE));
      // Latency is measured from every site, the endpoint's own included (that's where its nearby clients are).
      // Otherwise from outside the endpoint's site, topped up from inside when fewer than two probers are outside
      // (a single-site cluster with one external probe location still needs two votes).
      const probers =
        f.mode === 'latency' || !ownSite
          ? probersIn([...bySite.keys()])
          : probersIn(outside).length >= 2
            ? probersIn(outside)
            : [...probersIn(outside), ...probersIn([ownSite])];
      const probe: Probe = {
        id: probeId(name, endpoint.name),
        address: endpoint.address,
        port: f.check.port ?? defaultPort(f.check.protocol),
        protocol: f.check.protocol,
        ...(f.check.protocol !== 'tcp' ? { host: f.host, path: f.check.path, expectStatus: f.check.expectStatus } : {}),
        intervalSeconds: f.intervalSeconds,
      };

      for (const node of probers) result.set(node, [...(result.get(node) ?? []), probe]);
    }
  }

  return result;
}

export interface EndpointHealth {
  healthy: boolean;
  /** Consecutive rounds: positive healthy, negative failed. */
  streak: number;
  /** When `healthy` last changed. */
  since: string;
}

export interface FailoverState {
  endpoints: Record<string, EndpointHealth>;
  /** Endpoint names currently answered. */
  active: string[];
  /** Latency steering: the endpoint per continent (and for everyone else). */
  latency?: LatencyChoice;
  /** Manual fail-back: the primary is healthy again and waits for an operator. */
  failbackPending: boolean;
}

export interface ProbeVote {
  ok: boolean;
  at: Date;
}

export interface FailoverDecision {
  state: FailoverState;
  changed: boolean;
  /** Endpoints whose health flipped this round. */
  flipped: string[];
}

/**
 * One round of the engine (3.28): votes from fresh probe results per endpoint (at least two probing nodes, majority
 * decides), hysteresis, and the answer for the mode. Failing an endpoint over needs control-plane quorum, so an
 * isolated part of the cluster can't flip records on its own; recovering one doesn't.
 */
export function evaluateFailover(
  spec: DnsFailoverSpec,
  previous: FailoverState | undefined,
  votes: ReadonlyMap<string, ProbeVote[]>,
  now: Date,
  quorum: boolean,
  failbackConfirmed = false,
): FailoverDecision {
  const nowIso = now.toISOString();
  const fresh = (v: ProbeVote) => now.getTime() - v.at.getTime() <= spec.intervalSeconds * 3_000;
  const endpoints: Record<string, EndpointHealth> = {};
  const flipped: string[] = [];

  for (const e of spec.endpoints) {
    const before = previous?.endpoints[e.name] ?? { healthy: true, streak: 0, since: nowIso };
    const current = (votes.get(e.name) ?? []).filter(fresh);
    let next = before;

    if (current.length >= 2) {
      const ok = current.filter((v) => v.ok).length > current.length / 2;
      const streak = ok ? Math.max(0, before.streak) + 1 : Math.min(0, before.streak) - 1;
      let healthy = before.healthy;

      if (before.healthy && streak <= -spec.failAfter && quorum) healthy = false;

      if (!before.healthy && streak >= spec.recoverAfter) healthy = true;

      next = { healthy, streak, since: healthy === before.healthy ? before.since : nowIso };

      if (healthy !== before.healthy) flipped.push(e.name);
    }

    endpoints[e.name] = next;
  }

  const healthy = spec.endpoints.filter((e) => endpoints[e.name].healthy).map((e) => e.name);
  let active: string[];
  let failbackPending = false;

  if (ALL_HEALTHY_MODES.has(spec.mode)) {
    // Nothing healthy: answer everything rather than nothing (fail open).
    active = healthy.length > 0 ? healthy : spec.endpoints.map((e) => e.name);
  } else {
    const primary = spec.endpoints[0].name;
    const current = previous?.active[0];
    const stable =
      endpoints[primary].healthy && now.getTime() - Date.parse(endpoints[primary].since) >= spec.stableSeconds * 1000;

    if (!current || !endpoints[current]?.healthy) active = [healthy[0] ?? current ?? primary];
    else if (current !== primary && stable) {
      if (spec.failback === 'auto' || failbackConfirmed) active = [primary];
      else {
        active = [current];
        failbackPending = true;
      }
    } else active = [current];
  }

  const state: FailoverState = {
    endpoints,
    active,
    failbackPending,
    ...(previous?.latency ? { latency: previous.latency } : {}),
  };

  return { state, changed: !previous || previous.active.join(',') !== active.join(','), flipped };
}

/** Rough time for pushing a switch to providers and name servers, for the expected recovery time. */
const UPDATE_SECONDS = 10;

/**
 * What the plan says about DNS failovers (3.28): the expected recovery time (honestly: slower and fuzzier than
 * floating IPs), endpoints only probed from their own site, L4 connections that break on a switch, and steering that
 * can't work yet.
 */
export function failoverPlanNotes(
  failovers: ReadonlyMap<string, DnsFailoverSpec>,
  nodes: readonly ProberNode[],
  sitesWithLocation: ReadonlySet<string>,
  geoip: boolean,
): { level: 'info' | 'warning'; message: string }[] {
  const sites = new Set(nodes.map((n) => n.site));
  const notes: { level: 'info' | 'warning'; message: string }[] = [];

  for (const spec of failovers.values()) {
    const detection = spec.failAfter * spec.intervalSeconds;

    notes.push({
      level: 'info',
      message: `${spec.host}: DNS failover recovers in about ${detection + UPDATE_SECONDS + spec.ttl} s (${spec.failAfter} × ${spec.intervalSeconds} s detection, update, ${spec.ttl} s TTL); some resolvers and clients cache longer than the TTL`,
    });

    if (spec.check.protocol === 'tcp')
      notes.push({
        level: 'info',
        message: `${spec.host}: on a switch, existing connections break; clients must reconnect and resolve again`,
      });

    for (const e of spec.endpoints) {
      if (e.site && sites.has(e.site) && ![...sites].some((s) => s !== e.site))
        notes.push({
          level: 'warning',
          message: `${spec.host}: ${e.name} is only probed from its own site ${e.site}; add an external probe location (e.g. the witness on a small VPS in another site)`,
        });
    }

    if ((spec.mode === 'geo' || spec.mode === 'latency') && !geoip)
      notes.push({
        level: 'warning',
        message: `${spec.host}: ${spec.mode} steering needs a GeoIP database (release bundle or LOADWEAVER_GEOIP_DB); until then everyone gets the default answer`,
      });

    if (spec.mode === 'latency' && ![...sites].some((s) => sitesWithLocation.has(s)))
      notes.push({
        level: 'warning',
        message: `${spec.host}: latency steering needs sites with a location; until then everyone gets the endpoint fastest on average`,
      });
  }

  return notes;
}
