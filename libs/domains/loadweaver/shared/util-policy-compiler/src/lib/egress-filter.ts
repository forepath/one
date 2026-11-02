import {
  POLICY_EGRESS_SETTINGS,
  stricterEgressMode,
  translateEgressUrlPattern,
  type EgressMode,
} from '@forepath/loadweaver/shared/util-model';

import { uniqueSorted } from './hash';
import { peerWorkloads } from './mesh';
import { clientAddresses, clientGroupMembers, policyKey } from './resolve';
import type { CompilerDiagnostic, CompilerInput, EgressFilterConfig, EgressWebPort, Flow, NamedPolicy } from './types';

/** Web ports the node proxy inspects: HTTP by Host, TLS by SNI (no decryption). */
export const EGRESS_HTTP_PORT = 15080;
export const EGRESS_TLS_PORT = 15444;
const WEB_PORTS: readonly EgressWebPort[] = [80, 443];
const INTERNET = ['0.0.0.0/0', '::/0'];

function portCovered(ports: readonly string[], port: number): boolean {
  if (ports.length === 0) return true;

  return ports.some((p) => {
    const [from, to = from] = p.split('-').map(Number);

    return port >= from && port <= to;
  });
}

/** Egress settings of one source: the cluster's, tightened by the policies selecting it. */
export interface EgressSourceSettings {
  mode: EgressMode;
  blockPrivateNetworks: boolean;
  blockIpLiterals: boolean;
  logAllowed: boolean;
  denyUrlRegexes: string[];
  /** Whether a policy contributed (otherwise the node-level values apply). */
  custom: boolean;
}

const hasEgressSettings = (policy: NamedPolicy) => POLICY_EGRESS_SETTINGS.some((key) => policy.spec[key] !== undefined);

/**
 * Per workload address, the egress settings of the policies selecting it combined with the cluster's (3.7): the most
 * restrictive wins (stricter mode, blocks on, logging on, URL patterns add up). Only addresses a policy selects.
 */
export function egressSourceSettings(input: CompilerInput): Map<string, EgressSourceSettings> {
  const cluster = input.egressFilter ?? {
    mode: 'off' as const,
    blockPrivateNetworks: true,
    blockIpLiterals: false,
    logAllowed: true,
  };
  const result = new Map<string, EgressSourceSettings>();

  for (const policy of input.policies) {
    if (!hasEgressSettings(policy) || policy.spec.action !== 'allow') continue;

    const regexes = (policy.spec.denyUrlPatterns ?? []).flatMap((pattern) => {
      const translated = translateEgressUrlPattern(pattern);

      return 're2' in translated ? [translated.re2] : [];
    });
    // Settings only reach the policy's own workloads (validated on the policy too).
    const addresses = policy.spec.from
      .filter((peer) => 'selector' in peer || ('group' in peer && !peer.project))
      .flatMap((peer) => peerWorkloads(input, policy, peer).flatMap((w) => w.addresses));

    for (const address of addresses) {
      const current = result.get(address) ?? { ...cluster, denyUrlRegexes: [], custom: true };

      result.set(address, {
        mode: stricterEgressMode(current.mode, policy.spec.egressMode ?? 'off'),
        blockPrivateNetworks: current.blockPrivateNetworks || policy.spec.blockPrivateNetworks === true,
        blockIpLiterals: current.blockIpLiterals || policy.spec.blockIpLiterals === true,
        logAllowed: current.logAllowed || policy.spec.logAllowed === true,
        denyUrlRegexes: uniqueSorted([...current.denyUrlRegexes, ...regexes]),
        custom: true,
      });
    }
  }

  return result;
}

/** Workload addresses whose effective egress mode is `offline`: nothing of theirs leaves the cluster. */
export function offlineEgressSources(
  input: CompilerInput,
  settings: ReadonlyMap<string, EgressSourceSettings> = egressSourceSettings(input),
): (address: string) => boolean {
  if (input.egressFilter?.mode === 'offline') return () => true;

  const offline = new Set([...settings].filter(([, s]) => s.mode === 'offline').map(([address]) => address));

  return (address) => offline.has(address);
}

/**
 * Egress filtering through the node proxy (3.7, Agenstra's semantics): per local workload, the web ports it may use
 * (from L3 policies to destinations outside the cluster, and from policies with hostname destinations, which grant
 * reachability on their own), the hostname allow / deny lists (deny wins; no allow list means unrestricted) and the
 * cluster-wide mode. Allowed hostnames are forwarded to the host itself, other allowed traffic to its original
 * destination, so the redirect only covers destinations the policies allow.
 */
export function compileEgressFilter(
  input: CompilerInput,
  flows: readonly Flow[],
  diagnostics: CompilerDiagnostic[],
): Map<string, EgressFilterConfig> {
  const settings = input.egressFilter ?? {
    mode: 'off' as const,
    blockPrivateNetworks: true,
    blockIpLiterals: false,
    logAllowed: true,
  };
  const result = new Map<string, EgressFilterConfig>();
  const perSource = egressSourceSettings(input);

  if (settings.mode === 'off' && ![...perSource.values()].some((s) => s.mode !== 'off')) return result;

  const effective = (address: string): EgressSourceSettings =>
    perSource.get(address) ?? { ...settings, denyUrlRegexes: [], custom: false };

  const network = input.network;
  const clusterRanges = uniqueSorted(
    [
      network.podPoolV4,
      network.podPoolV6,
      network.servicePoolV4,
      network.servicePoolV6,
      network.overlayPoolV4,
      network.overlayPoolV6,
    ].filter((p): p is string => !!p),
  );
  const gateway = input.remoteAccess?.active;
  // Remote clients' web traffic is filtered on the active gateway like its workloads' (3.31).
  const nodeOf = new Map([
    ...input.workloads.flatMap((w) => w.addresses.map((a) => [a, w.node] as const)),
    ...(gateway
      ? (input.remoteAccess?.clients ?? []).flatMap((c) => clientAddresses(c).map((a) => [a, gateway] as const))
      : []),
  ]);
  type Source = EgressFilterConfig['sources'][number];
  const sources = new Map<string, Source>();
  const source = (address: string): Source | undefined => {
    const node = nodeOf.get(address);

    if (!node) return undefined;

    let s = sources.get(address);

    if (!s) {
      s = { address, ports: [], allow: [], deny: [], allowCidrs: [], unrestricted: false, denyCidrs: [] };
      sources.set(address, s);
    }

    return s;
  };
  const addPort = (s: Source, port: EgressWebPort, destinations: string[]) => {
    const entry = s.ports.find((p) => p.port === port);
    const ofFamily = destinations.filter((d) => d.includes(':') === s.address.includes(':'));

    if (ofFamily.length === 0) return;

    if (entry) entry.destinations = uniqueSorted([...entry.destinations, ...ofFamily]);
    else s.ports.push({ port, destinations: uniqueSorted(ofFamily) });
  };

  // Reachability from L3 / L4 policies to the outside.
  for (const flow of flows) {
    // Traffic leaving through an egress gateway (own prefixes) isn't redirected here: the proxy would send it out
    // with this node's address instead.
    if ((flow.srcKind !== 'workload' && flow.srcKind !== 'client') || flow.dstKind !== 'external' || flow.via) continue;

    if (flow.protocol !== 'tcp' && flow.protocol !== 'any') continue;

    for (const port of WEB_PORTS) {
      if (!portCovered(flow.ports, port)) continue;

      for (const address of flow.src) {
        const s = source(address);

        if (!s) continue;

        addPort(s, port, flow.dst);

        if (flow.dst.some((d) => INTERNET.includes(d))) s.unrestricted = true;
        else
          s.allowCidrs = uniqueSorted([
            ...s.allowCidrs,
            ...flow.dst.filter((d) => d.includes(':') === address.includes(':')),
          ]);
      }
    }
  }

  // Sources leaving through an egress gateway (own prefixes) bypass the node proxy: hostname rules can't apply there.
  const viaSources = new Set(
    flows.filter((f) => f.via && f.dstKind === 'external' && !f.dstNode).flatMap((f) => f.src),
  );

  // Web denies by address (deny policies naming CIDRs on ports 80 / 443).
  for (const policy of input.policies) {
    if (policy.spec.action !== 'deny' || policy.spec.to.length === 0 || !policy.spec.to.every((p) => 'cidr' in p))
      continue;

    const cidrs = policy.spec.to.flatMap((p) => ('cidr' in p ? [p.cidr] : []));
    const addresses = policy.spec.from
      .flatMap((p) =>
        'clients' in p
          ? (clientGroupMembers(input, p.clients) ?? []).flatMap(clientAddresses)
          : peerWorkloads(input, policy, p).flatMap((w) => w.addresses),
      )
      .filter((a) => !viaSources.has(a));

    for (const rule of policy.spec.rules) {
      const ports = WEB_PORTS.filter((p) => portCovered((rule.ports ?? []).map(String), p));

      for (const address of addresses) {
        const s = source(address);

        if (!s) continue;

        for (const cidr of cidrs.filter((c) => c.includes(':') === address.includes(':')))
          s.denyCidrs?.push({
            cidr,
            ports: [...ports],
            policy: policyKey(policy),
            monitor: policy.spec.mode === 'monitor',
          });
      }
    }
  }

  // Hostname policies: allow / deny lists per source, and reachability for allows.
  for (const policy of input.policies) {
    const hosts = policy.spec.to.filter((p): p is { host: string } => 'host' in p).map((p) => p.host);

    if (hosts.length === 0) continue;

    const sourceAddresses = policy.spec.from.flatMap((p) =>
      'clients' in p
        ? (clientGroupMembers(input, p.clients) ?? []).flatMap(clientAddresses)
        : peerWorkloads(input, policy, p).flatMap((w) => w.addresses),
    );
    const addresses = sourceAddresses.filter((a) => !viaSources.has(a));

    if (addresses.length < sourceAddresses.length)
      diagnostics.push({
        level: 'warning',
        policy: policyKey(policy),
        message: 'hostname rules do not apply to sources leaving through an egress address (own prefixes)',
      });

    for (const rule of policy.spec.rules) {
      const ports = WEB_PORTS.filter((p) => portCovered((rule.ports ?? []).map(String), p));

      if (ports.length === 0) {
        diagnostics.push({
          level: 'warning',
          policy: policyKey(policy),
          message: 'hostname destinations only work for web traffic (TCP 80 / 443); use CIDRs for other ports',
        });
        continue;
      }

      for (const address of addresses) {
        const s = source(address);

        if (!s) continue;

        const entries = hosts.map((host) => ({
          host,
          ports: [...ports],
          policy: policyKey(policy),
          monitor: policy.spec.mode === 'monitor',
        }));

        if (policy.spec.action === 'deny') s.deny.push(...entries);
        else {
          s.allow.push(...entries);

          // A monitor allow only records what it would allow: it opens nothing.
          if (policy.spec.mode !== 'monitor') for (const port of ports) addPort(s, port, INTERNET);
        }
      }
    }
  }

  for (const s of sources.values()) {
    const own = effective(s.address);

    // Not filtered: the cluster and the policies selecting it leave its egress alone.
    if (s.ports.length === 0 || own.mode === 'off') continue;

    // An allow list (hostnames or CIDR policies) restricts; only internet-wide L3 policies without one don't. Monitor
    // allows don't count: they must not take away what the source may reach today.
    s.unrestricted = s.unrestricted && s.allow.every((a) => a.monitor);
    s.ports.sort((a, b) => a.port - b.port);

    if (s.denyCidrs?.length === 0) delete s.denyCidrs;

    if (own.custom) {
      s.mode = own.mode;
      s.blockPrivateNetworks = own.blockPrivateNetworks;
      s.blockIpLiterals = own.blockIpLiterals;
      s.logAllowed = own.logAllowed;

      if (own.denyUrlRegexes.length > 0) s.denyUrlRegexes = own.denyUrlRegexes;
    }

    const node = nodeOf.get(s.address) as string;
    const config =
      result.get(node) ??
      ({
        mode: settings.mode === 'off' ? own.mode : settings.mode,
        blockPrivateNetworks: settings.blockPrivateNetworks,
        blockIpLiterals: settings.blockIpLiterals,
        logAllowed: settings.logAllowed,
        clusterRanges,
        sources: [],
      } satisfies EgressFilterConfig);

    // With the cluster `off`, the node level is what agents without per-source settings apply: the strictest.
    if (settings.mode === 'off') config.mode = stricterEgressMode(config.mode, own.mode) as EgressFilterConfig['mode'];

    config.sources.push(s);
    result.set(node, config);
  }

  for (const config of result.values()) config.sources.sort((a, b) => a.address.localeCompare(b.address));

  return result;
}
