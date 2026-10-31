import type { PolicyRule, PolicySpec } from '@forepath/loadweaver/shared/util-model';

import { policyKey, resolvePeer, type Endpoint } from './resolve';
import {
  DEFAULT_PLATFORM_PORTS,
  type CompilerDiagnostic,
  type CompilerInput,
  type Flow,
  type NamedPolicy,
  type PlatformPorts,
} from './types';

export const BUILTIN_POLICY_PREFIX = 'builtin:';

function builtinPolicy(name: string, spec: Omit<PolicySpec, 'mode' | 'action'>): NamedPolicy {
  return {
    name: `${BUILTIN_POLICY_PREFIX}${name}`,
    builtin: true,
    spec: { mode: 'enforce', action: 'allow', ...spec },
  };
}

/**
 * Control-plane traffic expressed as policies (3.3), so it shows up on the map and can't be broken by
 * user policies. BGP sessions are not listed here: they only exist on links other flows already need.
 */
export function builtinPolicies(ports: PlatformPorts, options: { statusPages?: boolean } = {}): NamedPolicy[] {
  return [
    builtinPolicy('agent-api', {
      description: 'Node agents stream to the control-plane API (3.19).',
      from: [{ builtin: 'cluster' }],
      to: [{ builtin: 'control-plane' }],
      rules: [{ protocol: 'tcp', ports: [ports.api] }],
    }),
    builtinPolicy('control-plane-quorum', {
      description:
        'etcd, Postgres streaming replication, Patroni and the log store between control-plane members (3.2, 3.14).',
      from: [{ builtin: 'control-plane' }],
      to: [{ builtin: 'control-plane' }],
      rules: [
        {
          protocol: 'tcp',
          ports: [ports.etcdClient, ports.etcdPeer, ports.postgres, ports.patroni, ...ports.logStore],
        },
      ],
    }),
    builtinPolicy('object-store', {
      description: 'Garage replication between object-store nodes, and the control plane managing it (3.20).',
      from: [{ builtin: 'object-store' }, { builtin: 'control-plane' }],
      to: [{ builtin: 'object-store' }],
      rules: [{ protocol: 'tcp', ports: ports.objectStore }],
    }),
    builtinPolicy('rate-limit', {
      description: 'The ingress asks the cluster-wide rate-limit service on the control-plane members (3.6).',
      from: [{ builtin: 'ingress' }],
      to: [{ builtin: 'control-plane' }],
      rules: [{ protocol: 'tcp', ports: [ports.rateLimit] }],
    }),
    builtinPolicy('backups', {
      description:
        'Nodes upload and restore backups through the repository servers on the control-plane members (3.20).',
      from: [{ builtin: 'cluster' }],
      to: [{ builtin: 'control-plane' }],
      rules: [{ protocol: 'tcp', ports: [`${ports.backups.from}-${ports.backups.to}`] }],
    }),
    builtinPolicy('registry', {
      description: 'Nodes pull images from the built-in registry and its mirrors on the control-plane members (3.22).',
      from: [{ builtin: 'cluster' }],
      to: [{ builtin: 'control-plane' }],
      rules: [{ protocol: 'tcp', ports: [`${ports.registry.from}-${ports.registry.to}`] }],
    }),
    ...(options.statusPages
      ? [
          builtinPolicy('status-pages', {
            description: "The ingress serves projects' public status pages from the control-plane API (3.25).",
            from: [{ builtin: 'ingress' }],
            to: [{ builtin: 'control-plane' }],
            rules: [{ protocol: 'tcp', ports: [ports.http] }],
          }),
        ]
      : []),
  ];
}

/** "Within a group: allowed by default" (3.3), as implicit policies so they are visible like any other edge. */
export function intraGroupPolicies(input: CompilerInput): NamedPolicy[] {
  const policies: NamedPolicy[] = [];
  const anyRule: PolicyRule = { protocol: 'any' };

  for (const group of input.workloadGroups) {
    if (group.spec.intraGroup !== 'allow') continue;

    policies.push({
      project: group.project,
      name: `group:${group.name}`,
      builtin: true,
      spec: {
        mode: 'enforce',
        action: 'allow',
        from: [{ group: group.name, project: group.project }],
        to: [{ group: group.name, project: group.project }],
        rules: [anyRule],
      },
    });
  }

  for (const group of input.nodeGroups) {
    if (group.spec.intraGroup !== 'allow') continue;

    policies.push({
      name: `group:${group.name}`,
      builtin: true,
      spec: {
        mode: 'enforce',
        action: 'allow',
        from: [{ group: group.name }],
        to: [{ group: group.name }],
        rules: [anyRule],
      },
    });
  }

  return policies;
}

function portStrings(rule: PolicyRule): string[] {
  return (rule.ports ?? []).map(String);
}

/** True if the policy is enforced at L3/L4 (hostname destinations and L7 denies belong to the proxy). */
export function isNetworkPolicy(policy: NamedPolicy): boolean {
  return policy.spec.action === 'allow' && policy.spec.to.length > 0 && !policy.spec.to.some((peer) => 'host' in peer);
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return (
    a.kind === b.kind &&
    a.node === b.node &&
    a.addresses.length === b.addresses.length &&
    a.addresses.every((x) => b.addresses.includes(x))
  );
}

/**
 * Expands every allow policy into flows between concrete endpoints, one per (rule, source node, destination node).
 * Only policies produce flows: nothing is transitive (3.3).
 */
export function buildFlows(
  input: CompilerInput,
  diagnostics: CompilerDiagnostic[],
): { flows: Flow[]; policies: NamedPolicy[] } {
  const ports = { ...DEFAULT_PLATFORM_PORTS, ...input.platformPorts };
  const policies = [
    ...builtinPolicies(ports, { statusPages: input.statusPages }),
    ...intraGroupPolicies(input),
    ...input.policies,
  ];
  const flows: Flow[] = [];

  for (const policy of policies) {
    if (!isNetworkPolicy(policy)) continue;

    const id = policyKey(policy);

    // Remote clients and office networks are cluster-level: only cluster-wide policies reach them (3.31).
    if (policy.project && policy.spec.to.some((peer) => 'clients' in peer)) {
      diagnostics.push({
        level: 'error',
        policy: id,
        message: 'remote clients can only be destinations of cluster-wide policies',
      });
      continue;
    }

    const sources = policy.spec.from.flatMap((peer) => resolvePeer(input, policy, peer, diagnostics));
    const destinations = policy.spec.to.flatMap((peer) => resolvePeer(input, policy, peer, diagnostics));

    if (!policy.builtin && (sources.length === 0 || destinations.length === 0)) {
      diagnostics.push({ level: 'warning', policy: id, message: 'policy currently matches no endpoints on one side' });
    }

    for (const rule of policy.spec.rules) {
      for (const src of sources) {
        for (const dst of destinations) {
          if (src.kind === 'external' && dst.kind === 'external') continue;

          // Client traffic doesn't pass a proxy that could check HTTP matches: fail closed (3.31).
          if (rule.http && (src.kind === 'client' || dst.kind === 'client')) {
            const message = 'http matches are not enforced for remote clients; the rule does not apply to them';

            if (!diagnostics.some((d) => d.policy === id && d.message === message))
              diagnostics.push({ level: 'warning', policy: id, message });

            continue;
          }

          // An endpoint talking to itself needs no rule; other members on the same node still do.
          if (sameEndpoint(src, dst) && src.addresses.length === 1) continue;

          flows.push({
            policy: id,
            mode: policy.spec.mode,
            srcNode: src.node,
            dstNode: dst.node,
            srcKind: src.kind,
            dstKind: dst.kind,
            src: src.addresses,
            dst: dst.addresses,
            protocol: rule.protocol,
            ports: portStrings(rule),
            ...(rule.http ? { l7: true } : {}),
          });
        }
      }
    }
  }

  return { flows, policies };
}
