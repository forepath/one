import type { CompilationResult, NodeNetworkConfig } from './types';

export type NetworkLayer = 'tunnels' | 'routing' | 'filtering' | 'dns' | 'services' | 'egress' | 'remote-access';

export interface NetworkChange {
  layer: NetworkLayer;
  action: 'add' | 'remove' | 'change';
  node: string;
  /** Plain-words summary for the plan, e.g. "adds WireGuard peer n1↔n3". */
  summary: string;
  policies: string[];
}

function emptyConfig(node: string): NodeNetworkConfig {
  return {
    node,
    addresses: [],
    wireguard: [],
    services: [],
    bgp: { asn: 0, routerId: '', routeReflector: false, originate: [], sessions: [] },
    firewall: { sets: {}, rules: [] },
    dns: { domain: '', records: [], visibility: {} },
  };
}

function setDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);

  return { added: after.filter((x) => !b.has(x)), removed: before.filter((x) => !a.has(x)) };
}

/** Per-layer effect of a change, as shown in the plan (3.3, 3.8). */
export function diffCompilation(before: CompilationResult | undefined, after: CompilationResult): NetworkChange[] {
  const changes: NetworkChange[] = [];
  const nodes = [...new Set([...Object.keys(before?.nodes ?? {}), ...Object.keys(after.nodes)])].sort();

  for (const node of nodes) {
    const old = before?.nodes[node] ?? emptyConfig(node);
    const cur = after.nodes[node] ?? emptyConfig(node);

    for (const link of cur.wireguard) {
      const prev = old.wireguard.find((l) => l.peer === link.peer);

      if (!prev) {
        if (node < link.peer)
          changes.push({
            layer: 'tunnels',
            action: 'add',
            node,
            summary: `adds WireGuard peer ${node}↔${link.peer}`,
            policies: link.reasons,
          });
        continue;
      }

      const ips = setDiff(prev.allowedIps, link.allowedIps);

      if (ips.added.length || ips.removed.length) {
        const parts = [
          ips.added.length ? `allows ${ips.added.join(', ')}` : '',
          ips.removed.length ? `stops allowing ${ips.removed.join(', ')}` : '',
        ].filter(Boolean);

        changes.push({
          layer: 'tunnels',
          action: 'change',
          node,
          summary: `${node}→${link.peer}: ${parts.join('; ')}`,
          policies: link.reasons,
        });
      }
    }

    for (const link of old.wireguard) {
      if (!cur.wireguard.some((l) => l.peer === link.peer) && node < link.peer) {
        changes.push({
          layer: 'tunnels',
          action: 'remove',
          node,
          summary: `removes WireGuard peer ${node}↔${link.peer}`,
          policies: link.reasons,
        });
      }
    }

    for (const session of cur.bgp.sessions) {
      const prev = old.bgp.sessions.find((s) => s.peer === session.peer);
      const exp = setDiff(prev?.exports ?? [], session.exports);

      if (exp.added.length)
        changes.push({
          layer: 'routing',
          action: 'add',
          node,
          summary: `exports ${exp.added.join(', ')} from ${node} to ${session.peer}`,
          policies: [],
        });

      if (exp.removed.length)
        changes.push({
          layer: 'routing',
          action: 'remove',
          node,
          summary: `withdraws ${exp.removed.join(', ')} from ${node} to ${session.peer}`,
          policies: [],
        });
    }

    if (cur.bgp.routeReflector && !old.bgp.routeReflector)
      changes.push({
        layer: 'routing',
        action: 'add',
        node,
        summary: `promotes ${node} to route reflector`,
        policies: [],
      });

    if (!cur.bgp.routeReflector && old.bgp.routeReflector)
      changes.push({
        layer: 'routing',
        action: 'remove',
        node,
        summary: `demotes ${node} from route reflector`,
        policies: [],
      });

    const rules = setDiff(
      old.firewall.rules.map((r) => r.id),
      cur.firewall.rules.map((r) => r.id),
    );

    for (const id of rules.added) {
      const rule = cur.firewall.rules.find((r) => r.id === id);

      if (rule)
        changes.push({
          layer: 'filtering',
          action: 'add',
          node,
          summary: `adds ${rule.action} rule on ${node} (${rule.chain}, ${rule.protocol}${rule.ports.length ? ` ${rule.ports.join(',')}` : ''})`,
          policies: [rule.policy],
        });
    }

    for (const id of rules.removed) {
      const rule = old.firewall.rules.find((r) => r.id === id);

      if (rule)
        changes.push({
          layer: 'filtering',
          action: 'remove',
          node,
          summary: `removes rule on ${node} (${rule.chain}, ${rule.protocol})`,
          policies: [rule.policy],
        });
    }

    // Egress from own prefixes (3.27), in words: who leaves with which address, through which gateway.
    const snatKey = (s: { address: string; sources: string[] }) => `${s.address} ← ${s.sources.join(', ')}`;
    const snat = setDiff((old.egress?.snat ?? []).map(snatKey), (cur.egress?.snat ?? []).map(snatKey));

    snat.added.forEach((k) =>
      changes.push({
        layer: 'egress',
        action: 'add',
        node,
        summary: `${node} sends ${k.split(' ← ')[1]} out as ${k.split(' ← ')[0]}`,
        policies: [],
      }),
    );
    snat.removed.forEach((k) =>
      changes.push({
        layer: 'egress',
        action: 'remove',
        node,
        summary: `${node} stops sending ${k.split(' ← ')[1]} out as ${k.split(' ← ')[0]}`,
        policies: [],
      }),
    );

    const routeKey = (r: { interface: string; sources: string[] }) => `${r.sources.join(', ')} → ${r.interface}`;
    const routes = setDiff((old.egress?.routes ?? []).map(routeKey), (cur.egress?.routes ?? []).map(routeKey));
    const gateway = (iface: string) =>
      cur.wireguard.find((l) => l.interface === iface)?.peer ??
      old.wireguard.find((l) => l.interface === iface)?.peer ??
      iface;

    routes.added.forEach((k) =>
      changes.push({
        layer: 'egress',
        action: 'add',
        node,
        summary: `routes egress of ${k.split(' → ')[0]} on ${node} through ${gateway(k.split(' → ')[1])}`,
        policies: [],
      }),
    );
    routes.removed.forEach((k) =>
      changes.push({
        layer: 'egress',
        action: 'remove',
        node,
        summary: `stops routing egress of ${k.split(' → ')[0]} on ${node} through ${gateway(k.split(' → ')[1])}`,
        policies: [],
      }),
    );

    // Remote access gateways (3.31): role changes; client peers come and go without plans.
    const role = (c: NodeNetworkConfig) => (c.remoteAccess ? (c.remoteAccess.active ? 'active' : 'standby') : 'none');

    if (role(old) !== role(cur))
      changes.push({
        layer: 'remote-access',
        action: role(old) === 'none' ? 'add' : role(cur) === 'none' ? 'remove' : 'change',
        node,
        summary:
          role(cur) === 'none'
            ? `${node} stops being a remote access gateway`
            : `${node} becomes the ${role(cur)} remote access gateway`,
        policies: [],
      });

    const names = setDiff(
      old.dns.records.map((r) => r.name),
      cur.dns.records.map((r) => r.name),
    );

    names.added.forEach((n) =>
      changes.push({ layer: 'dns', action: 'add', node, summary: `${n} becomes resolvable on ${node}`, policies: [] }),
    );
    names.removed.forEach((n) =>
      changes.push({
        layer: 'dns',
        action: 'remove',
        node,
        summary: `${n} no longer resolvable on ${node}`,
        policies: [],
      }),
    );
  }

  return changes;
}
