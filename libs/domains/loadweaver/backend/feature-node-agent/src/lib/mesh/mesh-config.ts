import { createHash } from 'node:crypto';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { EGRESS_RE2_PROGRAM_LIMIT } from '@forepath/loadweaver/shared/util-model';
import { cidrOverlaps, mustParseCidr, parseCidr } from '@forepath/loadweaver/shared/util-network';

import type { ManagedContainerSpec } from '../host/managed-containers';

type Mesh = NonNullable<NodeNetworkConfig['mesh']>;
type Inbound = Mesh['inbound'][number];
type Rule = Inbound['rules'][number];

export const MESH_CONTAINER = 'lw-mesh';
export const MESH_COMPONENT = 'mesh';
/** Inside the container. */
export const MESH_DIR = '/etc/envoy';
export const MESH_ADMIN_SOCKET = `${MESH_DIR}/run/admin.sock`;
export const MESH_OUTBOUND_PORT = 15001;
export const MESH_INBOUND_PORT = 15443;
/** TLS secrets, one file each (file-based SDS takes one secret per file); rotation needs no listener drain. */
const SECRETS_DIR = `${MESH_DIR}/secrets`;
const CA_SECRET = 'cluster-ca';

const T = {
  listener: 'type.googleapis.com/envoy.config.listener.v3.Listener',
  cluster: 'type.googleapis.com/envoy.config.cluster.v3.Cluster',
  secret: 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
  hcm: 'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
  router: 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router',
  tcpProxy: 'type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy',
  originalDst: 'type.googleapis.com/envoy.extensions.filters.listener.original_dst.v3.OriginalDst',
  tlsInspector: 'type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector',
  downstreamTls: 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
  upstreamTls: 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext',
  networkRbac: 'type.googleapis.com/envoy.extensions.filters.network.rbac.v3.RBAC',
  httpRbac: 'type.googleapis.com/envoy.extensions.filters.http.rbac.v3.RBAC',
  dfpCluster: 'type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig',
  dfpHttp: 'type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig',
  dfpSni: 'type.googleapis.com/envoy.extensions.filters.network.sni_dynamic_forward_proxy.v3.FilterConfig',
  getaddrinfo: 'type.googleapis.com/envoy.extensions.network.dns_resolver.getaddrinfo.v3.GetAddrInfoDnsResolverConfig',
  headerMutation: 'type.googleapis.com/envoy.extensions.filters.http.header_mutation.v3.HeaderMutation',
} as const;

/** `spiffe://<cluster>.loadweaver/workload/<project>/<deployment>/<service>` (util-pki `identityUri`). */
export function workloadUri(clusterId: string, identity: string): string {
  return `spiffe://${clusterId}.loadweaver/workload/${identity}`;
}

/** Secret name of an identity's certificate in the SDS file. */
export function identitySecret(identity: string): string {
  return `id:${identity}`;
}

function socket(address: string, port: number) {
  return { socket_address: { address, port_value: port } };
}

/** File of a secret below the secrets directory: names contain `/` and `:`, so they're hashed. */
export function secretFile(name: string): string {
  return `${createHash('sha256').update(name).digest('hex').slice(0, 32)}.json`;
}

const sds = (name: string) => ({
  name,
  sds_config: {
    path_config_source: { path: `${SECRETS_DIR}/${secretFile(name)}`, watched_directory: { path: SECRETS_DIR } },
    resource_api_version: 'V3',
  },
});
// Envoy's client default tops out at TLS 1.2: both bounds explicit.
const tlsParams = { tls_minimum_protocol_version: 'TLSv1_3', tls_maximum_protocol_version: 'TLSv1_3' };

/** Bootstrap: listeners, clusters and secrets from files the agent swaps atomically (filesystem xDS). */
export function renderMeshBootstrap(nodeName: string, adminSocket: string = MESH_ADMIN_SOCKET): string {
  const source = (file: string) => ({
    path_config_source: { path: `${MESH_DIR}/dynamic/${file}`, watched_directory: { path: `${MESH_DIR}/dynamic` } },
    resource_api_version: 'V3',
  });

  return JSON.stringify(
    {
      node: { id: nodeName, cluster: 'loadweaver-mesh' },
      admin: { address: { pipe: { path: adminSocket, mode: 0o600 } } },
      dynamic_resources: { cds_config: source('cds.json'), lds_config: source('lds.json') },
      // URL deny patterns of egress filtering are RE2 programs bigger than Envoy's default limit (100); the control
      // plane bounds each pattern's size (util-model `EGRESS_URL_PATTERN_MAX_PROGRAM`).
      layered_runtime: {
        layers: [
          {
            name: 'static',
            static_layer: {
              're2.max_program_size.error_level': EGRESS_RE2_PROGRAM_LIMIT,
              're2.max_program_size.warn_level': EGRESS_RE2_PROGRAM_LIMIT,
            },
          },
        ],
      },
      overload_manager: {
        resource_monitors: [
          {
            name: 'envoy.resource_monitors.global_downstream_max_connections',
            typed_config: {
              '@type':
                'type.googleapis.com/envoy.extensions.resource_monitors.downstream_connections.v3.DownstreamConnectionsConfig',
              max_active_downstream_connections: 50_000,
            },
          },
        ],
      },
    },
    null,
    2,
  );
}

/** Certificates and keys of the local identities plus the cluster CA: secret file name → SDS content. */
export function renderMeshSecrets(
  identities: readonly { identity: string; certificatePem: string; privateKeyPem: string }[],
  caCertificatePem: string,
): Map<string, string> {
  const file = (resource: { name: string } & Record<string, unknown>) =>
    [secretFile(resource.name), JSON.stringify({ resources: [{ '@type': T.secret, ...resource }] }, null, 2)] as const;

  return new Map([
    file({ name: CA_SECRET, validation_context: { trusted_ca: { inline_string: caCertificatePem } } }),
    ...identities.map((i) =>
      file({
        name: identitySecret(i.identity),
        tls_certificate: {
          certificate_chain: { inline_string: i.certificatePem },
          private_key: { inline_string: i.privateKeyPem },
        },
      }),
    ),
  ]);
}

const principal = (clusterId: string, identity: string) => ({
  authenticated: { principal_name: { exact: workloadUri(clusterId, identity) } },
});

/** HTTP match of a rule as an RBAC permission: every given dimension must match (any of its values). */
function httpPermission(http: Rule['http']) {
  if (!http) return { any: true };

  const anyOf = (rules: object[]) => (rules.length === 1 ? rules[0] : { or_rules: { rules } });
  const parts: object[] = [];

  if (http.paths?.length) parts.push(anyOf(http.paths.map((p) => ({ url_path: { path: { prefix: p } } }))));

  if (http.methods?.length)
    parts.push(anyOf(http.methods.map((m) => ({ header: { name: ':method', string_match: { exact: m } } }))));

  if (http.hosts?.length)
    parts.push(
      anyOf(
        http.hosts.map((h) => ({
          header: {
            name: ':authority',
            string_match: h.startsWith('*.')
              ? { suffix: h.slice(1), ignore_case: true }
              : { exact: h, ignore_case: true },
          },
        })),
      ),
    );

  return parts.length === 0 ? { any: true } : parts.length === 1 ? parts[0] : { and_rules: { rules: parts } };
}

/** RBAC policies of a set of rules, one per rule (names show up in logs and stats). */
function policies(clusterId: string, rules: readonly Rule[], http: boolean) {
  return Object.fromEntries(
    rules.map((r, i) => [
      `${i}:${r.policy}`,
      {
        permissions: [http ? httpPermission(r.http) : { any: true }],
        principals: [principal(clusterId, r.identity)],
      },
    ]),
  );
}

/**
 * The RBAC filters of an inbound service port (3.7): denies first (deny wins), then allows; `monitor` rules only log
 * (shadow) — a monitor deny never blocks, a monitor allow lets through like an allow.
 */
function rbacFilters(clusterId: string, inbound: Inbound, kind: 'network' | 'http') {
  const http = kind === 'http';
  const type = http ? T.httpRbac : T.networkRbac;
  const name = http ? 'envoy.filters.http.rbac' : 'envoy.filters.network.rbac';
  const prefix = { stat_prefix: `mesh_${inbound.port}_` };
  const denies = inbound.rules.filter((r) => r.action === 'deny');
  const filters: object[] = [];

  if (denies.length > 0)
    filters.push({
      name,
      typed_config: {
        '@type': type,
        ...(http ? {} : prefix),
        rules: {
          action: 'DENY',
          policies: policies(
            clusterId,
            denies.filter((r) => r.mode === 'enforce'),
            http,
          ),
        },
        ...(denies.some((r) => r.mode === 'monitor')
          ? {
              shadow_rules: {
                action: 'DENY',
                policies: policies(
                  clusterId,
                  denies.filter((r) => r.mode === 'monitor'),
                  http,
                ),
              },
            }
          : {}),
      },
    });

  filters.push({
    name,
    typed_config: {
      '@type': type,
      ...(http ? {} : prefix),
      rules: {
        action: 'ALLOW',
        policies: policies(
          clusterId,
          inbound.rules.filter((r) => r.action === 'allow'),
          http,
        ),
      },
    },
  });

  return filters;
}

const inboundCluster = (inbound: Inbound) => `in|${inbound.sni}`;
const outboundCluster = (upstream: string, identity: string) => `out|${upstream}|${identity}`;

/**
 * Listeners of the node proxy (3.7): outbound on the pod gateways (local workloads' service traffic, redirected by
 * nftables; the original destination picks the filter chain, the source the client identity) and inbound on the
 * overlay addresses (mTLS with workload identities, then RBAC, then the local replicas).
 */
export function meshListeners(
  mesh: Mesh,
  options: { clusterId: string; gateways: readonly string[]; overlay: readonly string[]; ready: ReadonlySet<string> },
): object[] {
  const outbound = mesh.outbound.filter((o) => options.ready.has(o.identity));
  const inbound = mesh.inbound.filter((i) => options.ready.has(i.identity));
  const listeners: object[] = [];

  for (const gateway of options.gateways) {
    const v6 = gateway.includes(':');
    const chains = outbound
      .filter((o) => o.source.includes(':') === v6)
      .map((o) => ({
        filter_chain_match: {
          prefix_ranges: [{ address_prefix: o.serviceIp, prefix_len: v6 ? 128 : 32 }],
          source_prefix_ranges: [{ address_prefix: o.source, prefix_len: v6 ? 128 : 32 }],
          destination_port: o.port,
        },
        filters: [
          {
            name: 'envoy.filters.network.tcp_proxy',
            typed_config: {
              '@type': T.tcpProxy,
              stat_prefix: `out_${o.port}`,
              cluster: outboundCluster(o.upstream, o.identity),
            },
          },
        ],
      }));

    if (chains.length === 0) continue;

    listeners.push({
      '@type': T.listener,
      name: `mesh_out_${gateway}`,
      address: socket(gateway, MESH_OUTBOUND_PORT),
      listener_filters: [{ name: 'envoy.filters.listener.original_dst', typed_config: { '@type': T.originalDst } }],
      filter_chains: chains,
    });
  }

  const inboundChains = inbound.map((i) => {
    const tls = {
      name: 'envoy.transport_sockets.tls',
      typed_config: {
        '@type': T.downstreamTls,
        require_client_certificate: true,
        common_tls_context: {
          tls_params: tlsParams,
          tls_certificate_sds_secret_configs: [sds(identitySecret(i.identity))],
          // Only workload identities of this cluster; RBAC then decides which ones.
          combined_validation_context: {
            default_validation_context: {
              match_typed_subject_alt_names: [
                {
                  san_type: 'URI',
                  matcher: { prefix: `spiffe://${options.clusterId}.loadweaver/workload/` },
                },
              ],
            },
            validation_context_sds_secret_config: sds(CA_SECRET),
          },
        },
      },
    };
    const terminal = i.http
      ? {
          name: 'envoy.filters.network.http_connection_manager',
          typed_config: {
            '@type': T.hcm,
            stat_prefix: `in_${i.port}`,
            codec_type: 'AUTO',
            // Normalized before RBAC sees the path: no bypass through `//`, `/./` or encoded slashes.
            normalize_path: true,
            merge_slashes: true,
            path_with_escaped_slashes_action: 'UNESCAPE_AND_FORWARD',
            route_config: {
              name: `in_${i.sni}`,
              virtual_hosts: [
                {
                  name: 'service',
                  domains: ['*'],
                  routes: [{ match: { prefix: '/' }, route: { cluster: inboundCluster(i), timeout: '0s' } }],
                },
              ],
            },
            http_filters: [
              ...rbacFilters(options.clusterId, i, 'http'),
              { name: 'envoy.filters.http.router', typed_config: { '@type': T.router } },
            ],
          },
        }
      : {
          name: 'envoy.filters.network.tcp_proxy',
          typed_config: { '@type': T.tcpProxy, stat_prefix: `in_${i.port}`, cluster: inboundCluster(i) },
        };

    return {
      filter_chain_match: { server_names: [i.sni] },
      transport_socket: tls,
      filters: [...(i.http ? [] : rbacFilters(options.clusterId, i, 'network')), terminal],
    };
  });

  if (inboundChains.length > 0)
    for (const address of options.overlay)
      listeners.push({
        '@type': T.listener,
        name: `mesh_in_${address}`,
        address: socket(address, MESH_INBOUND_PORT),
        listener_filters: [{ name: 'envoy.filters.listener.tls_inspector', typed_config: { '@type': T.tlsInspector } }],
        filter_chains: inboundChains,
      });

  return listeners;
}

/** Listeners of mesh and egress filtering, as the `lds.json` file. */
export function renderMeshListeners(
  mesh: Mesh | undefined,
  options: {
    clusterId: string;
    gateways: readonly string[];
    overlay: readonly string[];
    ready: ReadonlySet<string>;
    egressFilter?: EgressFilter;
    /** Further addresses the egress listeners take traffic on: the active remote access gateway's (3.31). */
    egressAddresses?: readonly string[];
  },
): string {
  return JSON.stringify(
    {
      resources: [
        ...(mesh ? meshListeners(mesh, options) : []),
        ...(options.egressFilter
          ? renderEgressListeners(options.egressFilter, [...options.gateways, ...(options.egressAddresses ?? [])])
          : []),
      ],
    },
    null,
    2,
  );
}

/** Clusters: per (destination, local client identity) with mTLS to the destination's proxies; local replicas. */
export function renderMeshClusters(
  mesh: Mesh | undefined,
  options: { clusterId: string; ready: ReadonlySet<string>; egressFilter?: EgressFilter },
): string {
  const clusters: object[] = renderEgressClusters(options.egressFilter);

  if (!mesh) return JSON.stringify({ resources: clusters }, null, 2);

  const outbound = mesh.outbound.filter((o) => options.ready.has(o.identity));
  const pairs = [...new Map(outbound.map((o) => [outboundCluster(o.upstream, o.identity), o])).values()];

  for (const o of pairs) {
    const upstream = mesh.upstreams.find((u) => u.name === o.upstream);

    if (!upstream) continue;

    clusters.push({
      '@type': T.cluster,
      name: outboundCluster(o.upstream, o.identity),
      type: 'STATIC',
      connect_timeout: '5s',
      load_assignment: {
        cluster_name: outboundCluster(o.upstream, o.identity),
        endpoints: [
          { lb_endpoints: upstream.endpoints.map((e) => ({ endpoint: { address: socket(e, MESH_INBOUND_PORT) } })) },
        ],
      },
      outlier_detection: { consecutive_5xx: 5, interval: '10s', base_ejection_time: '30s', max_ejection_percent: 50 },
      transport_socket: {
        name: 'envoy.transport_sockets.tls',
        typed_config: {
          '@type': T.upstreamTls,
          sni: upstream.sni,
          common_tls_context: {
            tls_params: tlsParams,
            tls_certificate_sds_secret_configs: [sds(identitySecret(o.identity))],
            // The server must be the destination service itself.
            combined_validation_context: {
              default_validation_context: {
                match_typed_subject_alt_names: [
                  { san_type: 'URI', matcher: { exact: workloadUri(options.clusterId, upstream.identity) } },
                ],
              },
              validation_context_sds_secret_config: sds(CA_SECRET),
            },
          },
        },
      },
    });
  }

  for (const i of mesh.inbound.filter((x) => options.ready.has(x.identity)))
    clusters.push({
      '@type': T.cluster,
      name: inboundCluster(i),
      type: 'STATIC',
      connect_timeout: '5s',
      load_assignment: {
        cluster_name: inboundCluster(i),
        endpoints: [{ lb_endpoints: i.backends.map((b) => ({ endpoint: { address: socket(b, i.port) } })) }],
      },
    });

  return JSON.stringify({ resources: clusters }, null, 2);
}

export function meshSpec(dir: string, bootstrap: string, image: string): ManagedContainerSpec {
  return {
    name: MESH_CONTAINER,
    image,
    cmd: ['envoy', '-c', `${MESH_DIR}/bootstrap.json`, '--log-level', 'warn', '--concurrency', '2'],
    // Unprivileged ports only, but root inside to read the root-owned key material without any capability.
    env: { ENVOY_UID: '0' },
    binds: [
      `${dir}/bootstrap.json:${MESH_DIR}/bootstrap.json:ro`,
      `${dir}/dynamic:${MESH_DIR}/dynamic:ro`,
      `${dir}/secrets:${MESH_DIR}/secrets:ro`,
      `${dir}/run:${MESH_DIR}/run`,
    ],
    memoryBytes: 256 * 1024 ** 2,
    hash: createHash('sha256').update(JSON.stringify({ image, bootstrap })).digest('hex').slice(0, 16),
    component: MESH_COMPONENT,
    hardening: { capDrop: ['ALL'], readOnlyRootfs: true, noNewPrivileges: true, tmpfs: ['/tmp'] },
  };
}

type EgressFilter = NonNullable<NodeNetworkConfig['egressFilter']>;
type EgressSource = EgressFilter['sources'][number];

export const EGRESS_HTTP_PORT = 15080;
export const EGRESS_TLS_PORT = 15444;
const EGRESS_CLUSTER = 'egress_original_dst';
/**
 * Allowed hostnames go to the host itself, resolved by the proxy like the node resolves (3.7): a workload sending an
 * allowed SNI / Host to another address still reaches the allowed host, never that address.
 */
const EGRESS_DFP_HTTP = 'egress_dfp_http';
const EGRESS_DFP_TLS = 'egress_dfp_tls';
/** ClientHello buffered before the egress TLS upstream is dialled (large hellos with post-quantum key shares fit). */
const EGRESS_TLS_EARLY_DATA_BYTES = 65_536;
const EGRESS_DNS_CACHE = {
  name: 'egress_dns',
  dns_lookup_family: 'V4_PREFERRED',
  max_hosts: 4096,
  typed_dns_resolver_config: {
    name: 'envoy.network.dns_resolver.getaddrinfo',
    typed_config: { '@type': T.getaddrinfo },
  },
};

/** Envoy name patterns for a host rule: `example.com` is itself and its subdomains, `*.example.com` only these. */
function hostPatterns(rules: readonly { host: string }[]): string[] {
  return [
    ...new Set(
      rules.flatMap((r) =>
        r.host.startsWith('*.') ? [r.host.toLowerCase()] : [r.host.toLowerCase(), `*.${r.host.toLowerCase()}`],
      ),
    ),
  ].sort();
}
/**
 * Private and reserved ranges, blocked unless explicitly allowed: exactly Agenstra's list (`EGRESS_PRIVATE_NETWORK_CIDRS`):
 * RFC 1918, loopback, link-local, CGNAT, "this network", IETF protocol assignments, benchmarking, multicast,
 * reserved, ULA, unspecified.
 */
const PRIVATE_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const;

/** Header carrying the plain-HTTP URL for URL deny patterns; set by the proxy, removed before forwarding. */
export const EGRESS_URL_HEADER = 'x-loadweaver-egress-url';

/**
 * RBAC policy names, one per Agenstra rule; Envoy evaluates policies in name order, so the reported (effective) policy
 * follows Agenstra's precedence. The access log carries it, the log collector maps it back to the rule.
 */
export const EGRESS_RULE_POLICIES = {
  offline: 'r1_offline',
  deny_host: 'r2_deny_host',
  private_network: 'r3_private_network',
  ip_literal: 'r4_ip_literal',
  deny_url: 'r5_deny_url',
} as const;

/** A source's settings: its own (from policies) where set, otherwise the node level. */
function sourceSettings(filter: EgressFilter, source: EgressSource) {
  return {
    mode: source.mode ?? filter.mode,
    blockPrivateNetworks: source.blockPrivateNetworks ?? filter.blockPrivateNetworks,
    blockIpLiterals: source.blockIpLiterals ?? filter.blockIpLiterals,
    logAllowed: source.logAllowed ?? filter.logAllowed,
    denyUrlRegexes: source.denyUrlRegexes ?? [],
  };
}

/** `example.com` matches itself and its subdomains, `*.example.com` only subdomains (Agenstra's semantics). */
function hostRegex(host: string, withPort: boolean): string {
  const wildcard = host.startsWith('*.');
  const base = (wildcard ? host.slice(2) : host).toLowerCase().replace(/\./g, '\\.');

  return `(?i)^([^.:]+\\.)${wildcard ? '+' : '*'}${base}${withPort ? '(:[0-9]+)?' : ''}$`;
}

const cidrPermission = (cidr: string) => {
  const [address, length] = cidr.split('/');

  return {
    destination_ip: { address_prefix: address, prefix_len: Number(length ?? (address.includes(':') ? 128 : 32)) },
  };
};

/**
 * Egress decisions of one source on one web port (3.7, Agenstra's precedence): deny (offline, deny-list hosts and
 * addresses, private networks, IP literals, URL patterns) before allow (allow-list hosts and CIDR policies; nothing to
 * check when unrestricted). Explicit allows lift the private-network and IP-literal blocks. Monitor rules and the
 * `monitor` mode only log (shadow).
 */
function egressRbac(filter: EgressFilter, source: EgressSource, port: 80 | 443) {
  const http = port === 80;
  const settings = sourceSettings(filter, source);
  const hostMatch = (host: string) =>
    http
      ? { header: { name: ':authority', string_match: { safe_regex: { regex: hostRegex(host, true) } } } }
      : { requested_server_name: { safe_regex: { regex: hostRegex(host, false) } } };
  const forPort = <R extends { ports: number[] }>(rules: readonly R[]) => rules.filter((r) => r.ports.includes(port));
  const monitorAll = settings.mode === 'monitor';
  const enforced = new Map<string, object[]>();
  const shadowed = new Map<string, object[]>();
  const push = (rule: keyof typeof EGRESS_RULE_POLICIES, permission: object, monitor: boolean) => {
    const name = EGRESS_RULE_POLICIES[rule];

    shadowed.set(name, [...(shadowed.get(name) ?? []), permission]);

    if (!monitor && !monitorAll) enforced.set(name, [...(enforced.get(name) ?? []), permission]);
  };
  // Explicitly allowed addresses: the private-network and IP-literal blocks don't apply to them.
  const allowedAddresses = source.allowCidrs.map(cidrPermission);
  const unlessAllowed = (block: object, inside: readonly object[] = allowedAddresses) =>
    inside.length === 0 ? block : { and_rules: { rules: [block, { not_rule: { or_rules: { rules: inside } } }] } };

  if (settings.mode === 'offline') push('offline', { any: true }, false);

  for (const rule of forPort(source.deny)) push('deny_host', hostMatch(rule.host), rule.monitor);

  for (const rule of forPort(source.denyCidrs ?? [])) push('deny_host', cidrPermission(rule.cidr), rule.monitor);

  // Private networks are blocked except for exactly the CIDRs a policy allows inside them.
  if (settings.blockPrivateNetworks)
    for (const [address, length] of PRIVATE_RANGES) {
      const range = mustParseCidr(`${address}/${length}`);
      const inside = source.allowCidrs.filter((c) => {
        const cidr = parseCidr(c, false);

        return !!cidr && cidr.family === range.family && cidrOverlaps(cidr, range);
      });

      push(
        'private_network',
        unlessAllowed({ destination_ip: { address_prefix: address, prefix_len: length } }, inside.map(cidrPermission)),
        false,
      );
    }

  if (settings.blockIpLiterals)
    push(
      'ip_literal',
      unlessAllowed(
        http
          ? {
              header: {
                name: ':authority',
                string_match: { safe_regex: { regex: '^(\\[[0-9a-fA-F:.]+\\]|[0-9.]+)(:[0-9]+)?$' } },
              },
            }
          : // No SNI (RFC 6066 forbids literals there) or a literal sent anyway (some clients do; Squid's
            // `ssl::server_name_regex` in Agenstra's guard catches both).
            {
              or_rules: {
                rules: [
                  { requested_server_name: { exact: '' } },
                  {
                    requested_server_name: {
                      safe_regex: { regex: '^(\\[?[0-9a-fA-F:.]*:[0-9a-fA-F:.]*\\]?|[0-9.]+)$' },
                    },
                  },
                ],
              },
            },
      ),
      false,
    );

  // URL patterns apply to plain HTTP only (TLS is never decrypted).
  if (http)
    for (const regex of settings.denyUrlRegexes)
      push('deny_url', { header: { name: EGRESS_URL_HEADER, string_match: { safe_regex: { regex } } } }, false);

  const policies = (rules: Map<string, object[]>) =>
    Object.fromEntries(
      [...rules]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, permissions]) => [name, { permissions, principals: [{ any: true }] }]),
    );
  const allow = forPort(source.allow);
  const allowPermissions = source.unrestricted
    ? [{ any: true }]
    : [...allow.filter((r) => !r.monitor).map((r) => hostMatch(r.host)), ...source.allowCidrs.map(cidrPermission)];
  const anyPrincipal = [{ any: true }];
  const type = http ? T.httpRbac : T.networkRbac;
  const name = http ? 'envoy.filters.http.rbac' : 'envoy.filters.network.rbac';
  const prefix = http ? {} : { stat_prefix: `egress_${port}_` };
  const filters: object[] = [];

  if (shadowed.size > 0)
    filters.push({
      name,
      typed_config: {
        '@type': type,
        ...prefix,
        ...(enforced.size > 0 ? { rules: { action: 'DENY', policies: policies(enforced) } } : {}),
        // Shadow: every deny, enforced or monitored, so the decision and its rule are in the metadata for the access
        // log (an enforced network RBAC deny leaves no response flag). Own key, so later filters don't overwrite it.
        shadow_rules_stat_prefix: 'deny_',
        shadow_rules: { action: 'DENY', policies: policies(shadowed) },
      },
    });

  // Monitor allows record what an allow list including them would decide; they never open anything.
  const monitored = allow.filter((r) => r.monitor);
  const shadowPermissions = [...allow.map((r) => hostMatch(r.host)), ...source.allowCidrs.map(cidrPermission)];

  // The enforced allow list once more as shadow only, for the access log (`allow_shadow_engine_result`).
  if (!monitorAll)
    filters.push({
      name,
      typed_config: {
        '@type': type,
        ...(http ? {} : { stat_prefix: `egress_${port}_log_` }),
        shadow_rules_stat_prefix: 'allow_',
        shadow_rules: {
          action: 'ALLOW',
          policies:
            allowPermissions.length > 0 ? { allow: { permissions: allowPermissions, principals: anyPrincipal } } : {},
        },
      },
    });

  // In `monitor` mode, not being on the allow list is recorded only.
  filters.push({
    name,
    typed_config: {
      '@type': type,
      ...prefix,
      [monitorAll ? 'shadow_rules' : 'rules']: {
        action: 'ALLOW',
        policies:
          allowPermissions.length > 0 ? { allow: { permissions: allowPermissions, principals: anyPrincipal } } : {},
      },
      ...(!monitorAll && monitored.length > 0
        ? {
            shadow_rules: {
              action: 'ALLOW',
              policies: { monitored: { permissions: shadowPermissions, principals: anyPrincipal } },
            },
          }
        : {}),
    },
  });

  return filters;
}

/** Without `logAllowed`, only decisions that deny (enforced, or recorded by monitor rules) are logged. */
const deniedOnly = (kind: 'http' | 'tls') => {
  const namespace = kind === 'http' ? 'envoy.filters.http.rbac' : 'envoy.filters.network.rbac';
  const shadowDenied = (key: string) => ({
    metadata_filter: {
      matcher: { filter: namespace, path: [{ key }], value: { string_match: { exact: 'denied' } } },
      match_if_key_not_found: false,
    },
  });

  return {
    or_filter: {
      filters: [
        { response_flag_filter: {} },
        ...(kind === 'http'
          ? [
              {
                status_code_filter: {
                  comparison: { op: 'GE', value: { default_value: 400, runtime_key: 'egress_log_status' } },
                },
              },
            ]
          : []),
        shadowDenied('shadow_engine_result'),
        shadowDenied('deny_shadow_engine_result'),
        shadowDenied('allow_shadow_engine_result'),
      ],
    },
  };
};

/**
 * One JSON line per decision. Besides what was asked for, the line says how it was decided, so the log collector can
 * attribute it (3.14) and report Agenstra-style decisions: `mode` of the source, `rule` (the deny RBAC policy that
 * matched, `EGRESS_RULE_POLICIES`), `allow` / `shadow` (the allow list's shadow results) and `details` (an enforced
 * RBAC denial).
 */
const egressAccessLog = (kind: 'http' | 'tls', settings: { mode: string; logAllowed: boolean }) => {
  const rbac = kind === 'http' ? 'envoy.filters.http.rbac' : 'envoy.filters.network.rbac';

  return egressAccessLogFor(kind, settings.logAllowed, {
    mode: settings.mode,
    rule: `%DYNAMIC_METADATA(${rbac}:deny_shadow_effective_policy_id)%`,
    allow: `%DYNAMIC_METADATA(${rbac}:allow_shadow_engine_result)%`,
    shadow: `%DYNAMIC_METADATA(${rbac}:shadow_engine_result)%`,
    details: kind === 'http' ? '%RESPONSE_CODE_DETAILS%' : '%CONNECTION_TERMINATION_DETAILS%',
    ...(kind === 'http' ? { method: '%REQ(:METHOD)%' } : {}),
  });
};

const egressAccessLogFor = (kind: 'http' | 'tls', logAllowed: boolean, decision: Record<string, string>) => [
  {
    name: 'envoy.access_loggers.stdout',
    ...(logAllowed ? {} : { filter: deniedOnly(kind) }),
    typed_config: {
      '@type': 'type.googleapis.com/envoy.extensions.access_loggers.stream.v3.StdoutAccessLog',
      log_format: {
        json_format: {
          kind: `egress-${kind}`,
          source: '%DOWNSTREAM_REMOTE_ADDRESS_WITHOUT_PORT%',
          host: kind === 'http' ? '%REQ(:AUTHORITY)%' : '%REQUESTED_SERVER_NAME%',
          destination: '%DOWNSTREAM_LOCAL_ADDRESS%',
          flags: '%RESPONSE_FLAGS%',
          status: kind === 'http' ? '%RESPONSE_CODE%' : '-',
          ...decision,
        },
      },
    },
  },
];

const allowedHosts = (s: EgressSource, port: 80 | 443) =>
  hostPatterns(s.allow.filter((r) => !r.monitor && r.ports.includes(port)));

/** Egress listeners on the pod gateways: HTTP decided by Host, TLS by SNI (never decrypted), per source. */
export function renderEgressListeners(filter: EgressFilter, gateways: readonly string[]): object[] {
  const listeners: object[] = [];

  for (const gateway of gateways) {
    const v6 = gateway.includes(':');
    const sources = filter.sources.filter((s) => s.address.includes(':') === v6);
    // Sources are workload / client addresses or office networks behind a machine client (3.31).
    const match = (s: EgressSource) => {
      const [address, length] = s.address.split('/');

      return {
        source_prefix_ranges: [{ address_prefix: address, prefix_len: Number(length ?? (v6 ? 128 : 32)) }],
      };
    };
    const http = sources
      .filter((s) => s.ports.some((p) => p.port === 80))
      .map((s) => ({
        filter_chain_match: match(s),
        filters: [
          {
            name: 'envoy.filters.network.http_connection_manager',
            typed_config: {
              '@type': T.hcm,
              stat_prefix: 'egress_http',
              normalize_path: true,
              merge_slashes: true,
              access_log: egressAccessLog('http', sourceSettings(filter, s)),
              route_config: {
                name: 'egress',
                // The URL header is for the proxy's own decision only.
                ...(sourceSettings(filter, s).denyUrlRegexes.length > 0
                  ? { request_headers_to_remove: [EGRESS_URL_HEADER] }
                  : {}),
                virtual_hosts: [
                  ...(allowedHosts(s, 80).length > 0
                    ? [
                        {
                          name: 'allowed',
                          domains: allowedHosts(s, 80),
                          routes: [{ match: { prefix: '/' }, route: { cluster: EGRESS_DFP_HTTP, timeout: '0s' } }],
                        },
                      ]
                    : []),
                  {
                    name: 'any',
                    domains: ['*'],
                    routes: [{ match: { prefix: '/' }, route: { cluster: EGRESS_CLUSTER, timeout: '0s' } }],
                  },
                ],
              },
              // Host matched without its port (`github.com:80` is `github.com`).
              strip_any_host_port: true,
              http_filters: [
                // URL deny patterns match the whole plain-HTTP URL, like Agenstra's guard: the proxy writes it into
                // a header first (overwriting anything the workload sent).
                ...(sourceSettings(filter, s).denyUrlRegexes.length > 0
                  ? [
                      {
                        name: 'envoy.filters.http.header_mutation',
                        typed_config: {
                          '@type': T.headerMutation,
                          mutations: {
                            request_mutations: [
                              {
                                append: {
                                  header: { key: EGRESS_URL_HEADER, value: 'http://%REQ(:AUTHORITY)%%REQ(:PATH)%' },
                                  append_action: 'OVERWRITE_IF_EXISTS_OR_ADD',
                                },
                              },
                            ],
                          },
                        },
                      },
                    ]
                  : []),
                ...egressRbac(filter, s, 80),
                {
                  name: 'envoy.filters.http.dynamic_forward_proxy',
                  typed_config: { '@type': T.dfpHttp, dns_cache_config: EGRESS_DNS_CACHE },
                },
                { name: 'envoy.filters.http.router', typed_config: { '@type': T.router } },
              ],
            },
          },
        ],
      }));
    const tlsChain = (s: EgressSource, names: string[]) => ({
      filter_chain_match: { ...match(s), ...(names.length > 0 ? { server_names: names } : {}) },
      filters: [
        ...egressRbac(filter, s, 443),
        ...(names.length > 0
          ? [
              {
                name: 'envoy.filters.network.sni_dynamic_forward_proxy',
                typed_config: { '@type': T.dfpSni, dns_cache_config: EGRESS_DNS_CACHE, port_value: 443 },
              },
            ]
          : []),
        {
          name: 'envoy.filters.network.tcp_proxy',
          typed_config: {
            '@type': T.tcpProxy,
            stat_prefix: 'egress_tls',
            cluster: names.length > 0 ? EGRESS_DFP_TLS : EGRESS_CLUSTER,
            // Decide before connecting: by default tcp_proxy dials the upstream on accept and holds the client's
            // ClientHello until connected, so the RBAC filters above only ran after a TCP connection to a denied
            // (or unreachable) destination — denied destinations still got a SYN, unreachable ones logged an
            // upstream failure instead of the denial. Buffer the ClientHello and connect on downstream data.
            max_early_data_bytes: EGRESS_TLS_EARLY_DATA_BYTES,
            upstream_connect_mode: 'ON_DOWNSTREAM_DATA',
            access_log: egressAccessLog('tls', sourceSettings(filter, s)),
          },
        },
      ],
    });
    // Allowed names to the host itself, everything else (CIDR policies, unrestricted) to the original destination.
    const tls = sources
      .filter((s) => s.ports.some((p) => p.port === 443))
      .flatMap((s) => [
        ...(allowedHosts(s, 443).length > 0 ? [tlsChain(s, allowedHosts(s, 443))] : []),
        tlsChain(s, []),
      ]);

    if (http.length > 0)
      listeners.push({
        '@type': T.listener,
        name: `egress_http_${gateway}`,
        address: socket(gateway, EGRESS_HTTP_PORT),
        listener_filters: [{ name: 'envoy.filters.listener.original_dst', typed_config: { '@type': T.originalDst } }],
        filter_chains: http,
      });

    if (tls.length > 0)
      listeners.push({
        '@type': T.listener,
        name: `egress_tls_${gateway}`,
        address: socket(gateway, EGRESS_TLS_PORT),
        listener_filters: [
          { name: 'envoy.filters.listener.original_dst', typed_config: { '@type': T.originalDst } },
          { name: 'envoy.filters.listener.tls_inspector', typed_config: { '@type': T.tlsInspector } },
        ],
        filter_chains: tls,
      });
  }

  return listeners;
}

/** Upstreams of egress: allowed hostnames resolved by the proxy, everything else the destination the workload connected to. */
export function renderEgressClusters(filter: EgressFilter | undefined): object[] {
  return filter
    ? [
        {
          '@type': T.cluster,
          name: EGRESS_CLUSTER,
          type: 'ORIGINAL_DST',
          lb_policy: 'CLUSTER_PROVIDED',
          connect_timeout: '10s',
        },
        ...[EGRESS_DFP_HTTP, EGRESS_DFP_TLS].map((name) => ({
          '@type': T.cluster,
          name,
          lb_policy: 'CLUSTER_PROVIDED',
          connect_timeout: '10s',
          cluster_type: {
            name: 'envoy.clusters.dynamic_forward_proxy',
            typed_config: { '@type': T.dfpCluster, dns_cache_config: EGRESS_DNS_CACHE },
          },
        })),
      ]
    : [];
}
