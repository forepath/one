import { createHash } from 'node:crypto';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
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
export function renderMeshBootstrap(nodeName: string): string {
  const source = (file: string) => ({
    path_config_source: { path: `${MESH_DIR}/dynamic/${file}`, watched_directory: { path: `${MESH_DIR}/dynamic` } },
    resource_api_version: 'V3',
  });

  return JSON.stringify(
    {
      node: { id: nodeName, cluster: 'loadweaver-mesh' },
      admin: { address: { pipe: { path: MESH_ADMIN_SOCKET, mode: 0o600 } } },
      dynamic_resources: { cds_config: source('cds.json'), lds_config: source('lds.json') },
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
/** RFC 1918, loopback, link-local, CGNAT, ULA: blocked unless explicitly allowed (Agenstra's default). */
const PRIVATE_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
  ['fc00::', 7],
  ['fe80::', 10],
  ['::1', 128],
] as const;

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
 * Egress decisions of one source on one web port (3.7): deny (deny-list hosts, private networks, IP literals, all of
 * it when `offline`) before allow (allow-list hosts and CIDR policies; nothing to check when unrestricted). Monitor
 * rules and the `monitor` mode only log (shadow).
 */
function egressRbac(filter: EgressFilter, source: EgressSource, port: 80 | 443) {
  const http = port === 80;
  const hostMatch = (host: string) =>
    http
      ? { header: { name: ':authority', string_match: { safe_regex: { regex: hostRegex(host, true) } } } }
      : { requested_server_name: { safe_regex: { regex: hostRegex(host, false) } } };
  const forPort = (rules: EgressSource['allow']) => rules.filter((r) => r.ports.includes(port));
  const deny = forPort(source.deny);
  const enforcedDenies: object[] = [];
  const monitoredDenies: object[] = [];
  const monitorAll = filter.mode === 'monitor';
  const push = (permission: object, monitor: boolean) =>
    (monitor || monitorAll ? monitoredDenies : enforcedDenies).push(permission);

  if (filter.mode === 'offline') enforcedDenies.push({ any: true });

  for (const rule of deny) push(hostMatch(rule.host), rule.monitor);

  // Private networks are blocked except for exactly the CIDRs a policy allows inside them.
  if (filter.blockPrivateNetworks)
    for (const [address, length] of PRIVATE_RANGES) {
      const range = mustParseCidr(`${address}/${length}`);
      const inside = source.allowCidrs.filter((c) => {
        const cidr = parseCidr(c, false);

        return !!cidr && cidr.family === range.family && cidrOverlaps(cidr, range);
      });
      const block = { destination_ip: { address_prefix: address, prefix_len: length } };

      push(
        inside.length === 0
          ? block
          : { and_rules: { rules: [block, { not_rule: { or_rules: { rules: inside.map(cidrPermission) } } }] } },
        false,
      );
    }

  if (filter.blockIpLiterals)
    push(
      http
        ? {
            header: {
              name: ':authority',
              string_match: { safe_regex: { regex: '^(\\[[0-9a-fA-F:.]+\\]|[0-9.]+)(:[0-9]+)?$' } },
            },
          }
        : { requested_server_name: { exact: '' } },
      false,
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

  if (enforcedDenies.length > 0 || monitoredDenies.length > 0)
    filters.push({
      name,
      typed_config: {
        '@type': type,
        ...prefix,
        ...(enforcedDenies.length > 0
          ? { rules: { action: 'DENY', policies: { deny: { permissions: enforcedDenies, principals: anyPrincipal } } } }
          : {}),
        // Shadow: every deny, enforced or monitored, so the decision is in the metadata for the access log (an
        // enforced network RBAC deny leaves no response flag). Own key, so later filters don't overwrite it.
        shadow_rules_stat_prefix: 'deny_',
        shadow_rules: {
          action: 'DENY',
          policies: {
            monitored: { permissions: [...enforcedDenies, ...monitoredDenies], principals: anyPrincipal },
          },
        },
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

const egressAccessLog = (kind: 'http' | 'tls', logAllowed: boolean) => [
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
              access_log: egressAccessLog('http', filter.logAllowed),
              route_config: {
                name: 'egress',
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
            access_log: egressAccessLog('tls', filter.logAllowed),
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
