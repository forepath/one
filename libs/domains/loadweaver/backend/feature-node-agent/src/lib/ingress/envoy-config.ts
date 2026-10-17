import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';

import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { ManagedContainerSpec } from '../host/managed-containers';

/** Pinned by digest (section 6); overridden by the release bundle (3.26). */
export const DEFAULT_ENVOY_IMAGE =
  'docker.io/envoyproxy/envoy:v1.40.0@sha256:459f2a6404c340fe6afccd69d85527012d47f3c036765493e6f8f3113fa384de';
export const INGRESS_COMPONENT = 'ingress';
export const INGRESS_CONTAINER = 'lw-ingress';
/** Inside the container. */
export const ENVOY_DIR = '/etc/envoy';
export const ENVOY_ADMIN_SOCKET = `${ENVOY_DIR}/run/admin.sock`;

export function envoyImage(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_ENVOY_IMAGE'] || DEFAULT_ENVOY_IMAGE;
}

const T = {
  listener: 'type.googleapis.com/envoy.config.listener.v3.Listener',
  cluster: 'type.googleapis.com/envoy.config.cluster.v3.Cluster',
  hcm: 'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
  router: 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router',
  tcpProxy: 'type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy',
  connectionLimit: 'type.googleapis.com/envoy.extensions.filters.network.connection_limit.v3.ConnectionLimit',
  udpProxy: 'type.googleapis.com/envoy.extensions.filters.udp.udp_proxy.v3.UdpProxyConfig',
  udpRoute: 'type.googleapis.com/envoy.extensions.filters.udp.udp_proxy.v3.Route',
  tlsInspector: 'type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector',
  downstreamTls: 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
  rateLimit: 'type.googleapis.com/envoy.extensions.filters.http.ratelimit.v3.RateLimit',
  wasm: 'type.googleapis.com/envoy.extensions.filters.http.wasm.v3.Wasm',
  stringValue: 'type.googleapis.com/google.protobuf.StringValue',
  filterConfig: 'type.googleapis.com/envoy.config.route.v3.FilterConfig',
  httpProtocolOptions: 'type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions',
} as const;

export const RATE_LIMIT_CLUSTER = 'lw_ratelimit';
export const RATE_LIMIT_DOMAIN = 'loadweaver';
/** Inside the container. */
export const WAF_MODULE_PATH = `${ENVOY_DIR}/waf/coraza.wasm`;

export interface RenderOptions {
  /** Whether the verified WAF module is in place; without it, `enforce` hosts answer 503 instead of running unprotected. */
  wafModule: boolean;
}

/** Coraza with the OWASP Core Rule Set, per host (3.6). */
const WAF_DIRECTIVES = {
  monitor: [
    'Include @recommended-conf',
    'SecRuleEngine DetectionOnly',
    'Include @crs-setup-conf',
    'Include @owasp_crs/*.conf',
  ],
  enforce: ['Include @recommended-conf', 'SecRuleEngine On', 'Include @crs-setup-conf', 'Include @owasp_crs/*.conf'],
};
type WafMode = keyof typeof WAF_DIRECTIVES;
const wafFilter = (mode: WafMode) => `coraza-${mode}`;

function rateLimitActions(limit: NonNullable<Ingress['sites'][number]['routes'][number]['rateLimit']>) {
  const route = { generic_key: { descriptor_key: 'route', descriptor_value: limit.id } };

  return [
    ...(limit.total ? [{ actions: [route] }] : []),
    ...(limit.perIp ? [{ actions: [route, { remote_address: {} }] }] : []),
    ...(limit.perKeyHeader
      ? [
          {
            actions: [
              route,
              { request_headers: { header_name: limit.perKeyHeader, descriptor_key: 'api_key', skip_if_absent: true } },
            ],
          },
        ]
      : []),
  ];
}

function id(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '_');
}

function socket(address: string, port: number) {
  return { socket_address: { address, port_value: port } };
}

/** Static bootstrap: listeners and clusters come from files the agent swaps atomically (filesystem xDS). */
export function renderEnvoyBootstrap(nodeName: string): string {
  const source = (file: string) => ({
    path_config_source: { path: `${ENVOY_DIR}/dynamic/${file}`, watched_directory: { path: `${ENVOY_DIR}/dynamic` } },
    resource_api_version: 'V3',
  });

  return JSON.stringify(
    {
      node: { id: nodeName, cluster: 'loadweaver-ingress' },
      // Admin only on a unix socket: nothing on the network can reach it.
      admin: { address: { pipe: { path: ENVOY_ADMIN_SOCKET, mode: 0o600 } } },
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

/** Certificates the ingress can serve: with their private key. */
function usableCertificates(ingress: Ingress): Set<string> {
  return new Set(ingress.certificates.filter((c) => !!c.privateKeyPem).map((c) => c.id));
}

function httpConnectionManager(
  name: string,
  ingress: Ingress,
  sites: Ingress['sites'],
  https: boolean,
  options: RenderOptions,
) {
  const usable = usableCertificates(ingress);
  const unprotected = (site: Ingress['sites'][number]) => site.waf === 'enforce' && !options.wafModule;
  const limited = !!ingress.rateLimitService && sites.some((s) => s.routes.some((r) => r.rateLimit));
  // One WAF instance per mode in use, each enabled only on its hosts: everything else never enters the VM.
  const wafModes = options.wafModule
    ? (Object.keys(WAF_DIRECTIVES) as WafMode[]).filter((m) => sites.some((s) => s.waf === m))
    : [];
  const challenges = ingress.acmeChallenges.map((c) => ({
    match: { path: `/.well-known/acme-challenge/${c.token}` },
    direct_response: { status: 200, body: { inline_string: c.keyAuthorization } },
  }));
  const hosts = sites.map((site) => ({
    name: id(`${https ? 'tls' : 'plain'}_${site.host}`),
    domains: [site.host],
    ...(options.wafModule && (site.waf === 'monitor' || site.waf === 'enforce')
      ? { typed_per_filter_config: { [wafFilter(site.waf)]: { '@type': T.filterConfig, config: {} } } }
      : {}),
    routes: [
      ...(https ? [] : challenges),
      // Hosts with a certificate are HTTPS only (HTTP redirects); ACME challenges stay reachable on HTTP.
      ...(!https && site.certificate && usable.has(site.certificate)
        ? [{ match: { prefix: '/' }, redirect: { https_redirect: true } }]
        : unprotected(site)
          ? // `enforce` without the WAF module: refuse rather than serve unprotected.
            [
              {
                match: { prefix: '/' },
                direct_response: { status: 503, body: { inline_string: 'web application firewall unavailable' } },
              },
            ]
          : [...site.routes]
              .sort((a, b) => b.prefix.length - a.prefix.length)
              .map((r) => ({
                match: { prefix: r.prefix },
                route: {
                  cluster: r.upstream,
                  timeout: '60s',
                  ...(limited && r.rateLimit ? { rate_limits: rateLimitActions(r.rateLimit) } : {}),
                },
              }))),
    ],
  }));

  return {
    name: 'envoy.filters.network.http_connection_manager',
    typed_config: {
      '@type': T.hcm,
      stat_prefix: name,
      codec_type: 'AUTO',
      use_remote_address: true,
      normalize_path: true,
      merge_slashes: true,
      path_with_escaped_slashes_action: 'UNESCAPE_AND_REDIRECT',
      common_http_protocol_options: { idle_timeout: '300s', headers_with_underscores_action: 'REJECT_REQUEST' },
      request_headers_timeout: '30s',
      route_config: {
        name,
        virtual_hosts: [
          ...hosts,
          {
            name: 'fallback',
            domains: ['*'],
            routes: [...(https ? [] : challenges), { match: { prefix: '/' }, direct_response: { status: 404 } }],
          },
        ],
      },
      http_filters: [
        ...wafModes.map((mode) => ({
          name: wafFilter(mode),
          disabled: true,
          typed_config: {
            '@type': T.wasm,
            config: {
              name: wafFilter(mode),
              // A crashed VM is replaced instead of failing every following request.
              failure_policy: 'FAIL_RELOAD',
              vm_config: {
                vm_id: 'coraza',
                runtime: 'envoy.wasm.runtime.v8',
                code: { local: { filename: WAF_MODULE_PATH } },
              },
              configuration: {
                '@type': T.stringValue,
                value: JSON.stringify({ directives_map: { [mode]: WAF_DIRECTIVES[mode] }, default_directives: mode }),
              },
            },
          },
        })),
        ...(limited
          ? [
              {
                name: 'envoy.filters.http.ratelimit',
                typed_config: {
                  '@type': T.rateLimit,
                  domain: RATE_LIMIT_DOMAIN,
                  // The limiter being down must not take the sites down (fail open), nor add latency.
                  failure_mode_deny: false,
                  timeout: '0.2s',
                  enable_x_ratelimit_headers: 'DRAFT_VERSION_03',
                  rate_limit_service: {
                    grpc_service: { envoy_grpc: { cluster_name: RATE_LIMIT_CLUSTER } },
                    transport_api_version: 'V3',
                  },
                },
              },
            ]
          : []),
        { name: 'envoy.filters.http.router', typed_config: { '@type': T.router } },
      ],
    },
  };
}

/** Listener discovery file: HTTP and HTTPS per ingress address, plus L4 forwards. */
export function renderListeners(ingress: Ingress, options: RenderOptions = { wafModule: false }): string {
  const certificates = new Map(ingress.certificates.map((c) => [c.id, c]));
  const listeners: Record<string, unknown>[] = [];

  for (const address of ingress.addresses) {
    // `freebind`: listen on failover addresses this node doesn't hold right now (3.6).
    listeners.push({
      '@type': T.listener,
      name: id(`http_${address}`),
      address: socket(address, 80),
      freebind: true,
      filter_chains: [
        { filters: [httpConnectionManager(id(`http_${address}`), ingress, ingress.sites, false, options)] },
      ],
    });

    const usable = usableCertificates(ingress);
    const tls = [...new Set(ingress.sites.map((s) => s.certificate).filter((c): c is string => !!c && usable.has(c)))];

    if (tls.length > 0) {
      listeners.push({
        '@type': T.listener,
        name: id(`https_${address}`),
        address: socket(address, 443),
        freebind: true,
        listener_filters: [{ name: 'envoy.filters.listener.tls_inspector', typed_config: { '@type': T.tlsInspector } }],
        filter_chains: tls.map((cert) => {
          const sites = ingress.sites.filter((s) => s.certificate === cert);
          const material = certificates.get(cert) as NonNullable<ReturnType<typeof certificates.get>>;

          return {
            filter_chain_match: { server_names: sites.map((s) => s.host) },
            transport_socket: {
              name: 'envoy.transport_sockets.tls',
              typed_config: {
                '@type': T.downstreamTls,
                common_tls_context: {
                  alpn_protocols: ['h2', 'http/1.1'],
                  tls_params: { tls_minimum_protocol_version: 'TLSv1_2' },
                  tls_certificates: [
                    {
                      certificate_chain: { inline_string: material.certificatePem },
                      private_key: { inline_string: material.privateKeyPem },
                    },
                  ],
                },
              },
            },
            filters: [httpConnectionManager(id(`https_${address}_${cert}`), ingress, sites, true, options)],
          };
        }),
      });
    }

    for (const forward of ingress.forwards) {
      const name = id(`${forward.protocol}_${address}_${forward.port}`);

      listeners.push(
        forward.protocol === 'tcp'
          ? {
              '@type': T.listener,
              name,
              address: socket(address, forward.port),
              freebind: true,
              filter_chains: [
                {
                  filters: [
                    ...(forward.maxConnections
                      ? [
                          {
                            name: 'envoy.filters.network.connection_limit',
                            typed_config: {
                              '@type': T.connectionLimit,
                              stat_prefix: name,
                              max_connections: forward.maxConnections,
                            },
                          },
                        ]
                      : []),
                    {
                      name: 'envoy.filters.network.tcp_proxy',
                      typed_config: {
                        '@type': T.tcpProxy,
                        stat_prefix: name,
                        cluster: forward.upstream,
                        idle_timeout: '3600s',
                      },
                    },
                  ],
                },
              ],
            }
          : {
              '@type': T.listener,
              name,
              address: { socket_address: { address, port_value: forward.port, protocol: 'UDP' } },
              freebind: true,
              udp_listener_config: {},
              listener_filters: [
                {
                  name: 'envoy.filters.udp_listener.udp_proxy',
                  typed_config: {
                    '@type': T.udpProxy,
                    stat_prefix: name,
                    matcher: {
                      on_no_match: {
                        action: { name: 'route', typed_config: { '@type': T.udpRoute, cluster: forward.upstream } },
                      },
                    },
                  },
                },
              ],
            },
      );
    }
  }

  return JSON.stringify({ resources: listeners }, null, 2);
}

/** Cluster discovery file: one static cluster per upstream, endpoints are replica addresses over the overlay. */
export function renderClusters(ingress: Ingress): string {
  const service = ingress.rateLimitService;
  const rateLimit = service
    ? [
        {
          '@type': T.cluster,
          name: RATE_LIMIT_CLUSTER,
          type: 'STATIC',
          connect_timeout: '1s',
          typed_extension_protocol_options: {
            'envoy.extensions.upstreams.http.v3.HttpProtocolOptions': {
              '@type': T.httpProtocolOptions,
              explicit_http_config: { http2_protocol_options: {} },
            },
          },
          // One priority per member: every ingress talks to the same healthy one, so counters are cluster-wide.
          load_assignment: {
            cluster_name: RATE_LIMIT_CLUSTER,
            endpoints: service.endpoints.map((address, priority) => ({
              priority,
              lb_endpoints: [{ endpoint: { address: socket(address, service.port) } }],
            })),
          },
          health_checks: [
            { timeout: '1s', interval: '5s', unhealthy_threshold: 2, healthy_threshold: 2, tcp_health_check: {} },
          ],
        },
      ]
    : [];

  return JSON.stringify(
    {
      resources: [
        ...rateLimit,
        ...ingress.upstreams.map((u) => ({
          '@type': T.cluster,
          name: u.name,
          type: 'STATIC',
          connect_timeout: '5s',
          lb_policy: 'ROUND_ROBIN',
          load_assignment: {
            cluster_name: u.name,
            endpoints: [
              { lb_endpoints: u.endpoints.map((e) => ({ endpoint: { address: socket(e.address, e.port) } })) },
            ],
          },
          outlier_detection: {
            consecutive_5xx: 5,
            interval: '10s',
            base_ejection_time: '30s',
            max_ejection_percent: 50,
          },
        })),
      ],
    },
    null,
    2,
  );
}

/** Workers per Envoy: each holds its own WAF VM, so memory grows with them. */
export const MAX_ENVOY_WORKERS = 8;

export function envoySpec(
  dir: string,
  bootstrap: string,
  image: string,
  cpus = availableParallelism(),
): ManagedContainerSpec {
  const workers = Math.max(1, Math.min(cpus, MAX_ENVOY_WORKERS));
  const cmd = ['envoy', '-c', `${ENVOY_DIR}/bootstrap.json`, '--log-level', 'warn', '--concurrency', String(workers)];
  // Measured with the WAF on (both modes): ~270 MiB plus ~40 MiB per worker. Budgeted for the WAF always, so
  // switching it on never needs a restart; the limit is a ceiling, not a reservation.
  const memoryBytes = (384 + 64 * workers) * 1024 ** 2;

  return {
    name: INGRESS_CONTAINER,
    image,
    cmd,
    // The image's entrypoint would switch to its own user, which can't bind ports < 1024 with host networking;
    // instead root inside, with every capability dropped except binding low ports.
    env: { ENVOY_UID: '0' },
    binds: [
      `${dir}/bootstrap.json:${ENVOY_DIR}/bootstrap.json:ro`,
      `${dir}/dynamic:${ENVOY_DIR}/dynamic:ro`,
      `${dir}/run:${ENVOY_DIR}/run`,
      `${dir}/waf:${ENVOY_DIR}/waf:ro`,
    ],
    memoryBytes,
    hash: createHash('sha256')
      .update(JSON.stringify({ image, bootstrap, cmd, memoryBytes }))
      .digest('hex')
      .slice(0, 16),
    component: INGRESS_COMPONENT,
    hardening: {
      capDrop: ['ALL'],
      capAdd: ['NET_BIND_SERVICE'],
      readOnlyRootfs: true,
      noNewPrivileges: true,
      tmpfs: ['/tmp'],
    },
  };
}
