import {
  normalizeEgressHost,
  parseEgressPortSpec,
  type EffectiveEgressPolicy,
  type EgressMode,
  type NormalizedEgressHost,
} from './egress-policy';

/**
 * Agenstra's effective egress policy as Loadweaver policies (Loadweaver plan, section 4: the egress guard is replaced
 * by Envoy policies compiled from Agenstra's configuration, with identical semantics).
 *
 * Every policy selects the environment's deployment (`loadweaver.com/deployment`) in the workspace project:
 * - settings: `egressMode` (Agenstra's mode), `denyUrlPatterns` (as written; Loadweaver translates them to RE2 and
 *   refuses untranslatable ones as plan errors), `blockPrivateNetworks`, `blockIpLiterals`, `logAllowed`;
 * - allow / deny hosts: domains as hostname destinations (`example.com` = itself and its subdomains on both sides),
 *   IP / CIDR entries as address destinations on the web ports (explicit address allows lift the private-network and
 *   IP-literal blocks, exactly like Agenstra's explicit allow entries);
 * - `network_allow`: L3 / L4 exceptions as address policies with protocol and ports.
 *
 * What may reach the internet at all comes from standing project policies by label (set up once with the workspace,
 * approved like any internet exposure, {@link loadweaverWorkspacePolicies}): `open` environments (modes `off` /
 * `monitor`) on every protocol, `filtered` ones (`enforce` / `offline`) on the web ports only, where the node proxy
 * decides; `offline` then lets nothing leave.
 */

export const LOADWEAVER_API_VERSION = 'loadweaver.com/v1';
/** Compose label of an environment service: which standing internet policy applies. */
export const LOADWEAVER_EGRESS_NETWORK_LABEL = 'agenstra.io/egress-network';
/** Compose label of the services' role (`manager` / `environment`), for the manager → environment policy. */
export const LOADWEAVER_ROLE_LABEL = 'agenstra.io/role';
/** OpenCode server and VNC websockify inside an environment. */
export const LOADWEAVER_ENVIRONMENT_PORTS = [4096, 6080] as const;

export type LoadweaverEgressNetwork = 'open' | 'filtered';

export interface LoadweaverResourceDocument {
  apiVersion: typeof LOADWEAVER_API_VERSION;
  kind: string;
  metadata: { name: string; project?: string; labels?: Record<string, string> };
  spec: Record<string, unknown>;
}

export interface LoadweaverEgressCompilation {
  /** Policies of this environment (create or update). */
  documents: LoadweaverResourceDocument[];
  /** Name prefix of every policy this environment may own (to find the ones to delete). */
  prefix: string;
  /** Standing internet policy class the environment's service label selects. */
  network: LoadweaverEgressNetwork;
  /** Entries Loadweaver can't express (the policy is not applied while there are any). */
  issues: string[];
}

/** `off` and `monitor` let everything through (monitor records would-be blocks); the others filter. */
export function loadweaverEgressNetwork(mode: EgressMode): LoadweaverEgressNetwork {
  return mode === 'off' || mode === 'monitor' ? 'open' : 'filtered';
}

const WEB_RULES = [{ protocol: 'tcp', ports: [80, 443] }];
/** Loadweaver's hostname patterns (no underscores, unlike Agenstra's domain entries). */
const LOADWEAVER_HOSTNAME = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

function cidrOf(host: NormalizedEgressHost): string {
  return host.value.includes('/') ? host.value : `${host.value}/${host.kind === 'ipv4' ? 32 : 128}`;
}

/** Splits host entries into Loadweaver hostnames and CIDRs; unexpressible ones become issues. */
function splitHosts(
  entries: readonly { value: string }[],
  list: string,
  issues: string[],
): { hosts: string[]; cidrs: string[] } {
  const hosts = new Set<string>();
  const cidrs = new Set<string>();

  for (const entry of entries) {
    const host = normalizeEgressHost(entry.value);

    if (!host) {
      issues.push(`${list}: '${entry.value}' is not a host, IP or CIDR`);
      continue;
    }

    if (host.kind !== 'domain') cidrs.add(cidrOf(host));
    else if (LOADWEAVER_HOSTNAME.test(host.value) && host.value.length <= 253) hosts.add(host.value);
    else issues.push(`${list}: '${entry.value}' is not a valid hostname for Loadweaver (letters, digits, dashes)`);
  }

  return { hosts: [...hosts].sort(), cidrs: [...cidrs].sort() };
}

/**
 * The Loadweaver policies of one environment (deployment) for its effective egress policy. Pure; `issues` lists what
 * can't be expressed exactly (the caller refuses to apply then, like the guard refusing an invalid bundle).
 */
export function compileEgressPolicyForLoadweaver(
  policy: EffectiveEgressPolicy,
  target: { project: string; deployment: string },
): LoadweaverEgressCompilation {
  const issues: string[] = [];
  const prefix = `${target.deployment}-egress`;
  const from = [{ selector: { matchLabels: { 'loadweaver.com/deployment': target.deployment } } }];
  const doc = (name: string, spec: Record<string, unknown>): LoadweaverResourceDocument => ({
    apiVersion: LOADWEAVER_API_VERSION,
    kind: 'Policy',
    metadata: { name, project: target.project, labels: { 'agenstra.io/environment': target.deployment } },
    spec: { description: `Agenstra egress policy of ${target.deployment}`, from, ...spec },
  });
  const documents: LoadweaverResourceDocument[] = [
    doc(prefix, {
      egressMode: policy.mode,
      ...(policy.denyUrlPatterns.length > 0 ? { denyUrlPatterns: policy.denyUrlPatterns.map((p) => p.value) } : {}),
      blockPrivateNetworks: policy.blockPrivateNetworks,
      blockIpLiterals: policy.blockIpLiterals,
      logAllowed: policy.logAllowed,
    }),
  ];

  // Without filtering nothing else matters (and nothing is recorded), like an agent without a guard.
  if (policy.mode !== 'off') {
    const allow = splitHosts(policy.allowHosts, 'allow_hosts', issues);
    const deny = splitHosts(policy.denyHosts, 'deny_hosts', issues);

    if (allow.hosts.length > 0)
      documents.push(doc(`${prefix}-allow`, { to: allow.hosts.map((host) => ({ host })), rules: WEB_RULES }));

    if (allow.cidrs.length > 0)
      documents.push(doc(`${prefix}-allow-addr`, { to: allow.cidrs.map((cidr) => ({ cidr })), rules: WEB_RULES }));

    if (deny.hosts.length > 0)
      documents.push(
        doc(`${prefix}-deny`, { action: 'deny', to: deny.hosts.map((host) => ({ host })), rules: WEB_RULES }),
      );

    if (deny.cidrs.length > 0)
      documents.push(
        doc(`${prefix}-deny-addr`, { action: 'deny', to: deny.cidrs.map((cidr) => ({ cidr })), rules: WEB_RULES }),
      );

    policy.networkAllow.forEach((rule, i) => {
      const range = parseEgressPortSpec(rule.ports);
      const destinations = rule.destinations
        .map((d) => normalizeEgressHost(d))
        .filter((d): d is NormalizedEgressHost => !!d && d.kind !== 'domain')
        .map(cidrOf);

      if (!range || destinations.length === 0) {
        issues.push(`network_allow[${i}]: needs ports and IP / CIDR destinations`);

        return;
      }

      documents.push(
        doc(`${prefix}-net-${i}`, {
          to: [...new Set(destinations)].map((cidr) => ({ cidr })),
          rules: [
            { protocol: rule.protocol, ports: [range.from === range.to ? range.from : `${range.from}-${range.to}`] },
          ],
        }),
      );
    });
  }

  return { documents, prefix, network: loadweaverEgressNetwork(policy.mode), issues };
}

/**
 * The standing policies of a workspace project (applied once by an admin, see the Agenstra-on-Loadweaver guide):
 * the manager reaches its environments' OpenCode and VNC ports, and environments reach the internet by egress class.
 */
export function loadweaverWorkspacePolicies(project: string): LoadweaverResourceDocument[] {
  const role = (value: string) => ({ selector: { matchLabels: { [LOADWEAVER_ROLE_LABEL]: value } } });
  const network = (value: LoadweaverEgressNetwork) => ({
    selector: { matchLabels: { [LOADWEAVER_ROLE_LABEL]: 'environment', [LOADWEAVER_EGRESS_NETWORK_LABEL]: value } },
  });
  const doc = (name: string, description: string, spec: Record<string, unknown>): LoadweaverResourceDocument => ({
    apiVersion: LOADWEAVER_API_VERSION,
    kind: 'Policy',
    metadata: { name, project },
    spec: { description, ...spec },
  });

  return [
    doc('agenstra-manager-environments', 'Agenstra: the agent manager reaches OpenCode and VNC of its environments', {
      from: [role('manager')],
      to: [role('environment')],
      rules: [{ protocol: 'tcp', ports: [...LOADWEAVER_ENVIRONMENT_PORTS] }],
    }),
    doc('agenstra-environments-open', 'Agenstra: environments without filtering (off / monitor) reach the internet', {
      from: [network('open')],
      to: [{ builtin: 'internet' }],
      rules: [{ protocol: 'any' }],
    }),
    doc(
      'agenstra-environments-web',
      'Agenstra: filtered environments (enforce / offline) reach the web through the node proxy only',
      { from: [network('filtered')], to: [{ builtin: 'internet' }], rules: WEB_RULES },
    ),
  ];
}
