import { createHash } from 'node:crypto';

import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { HttpExposure, Rate } from '@forepath/loadweaver/shared/util-compose';
import { stringify } from 'yaml';
import { matchesSelector, type Selector } from '@forepath/loadweaver/shared/util-model';
import type { NamedPolicy, NamedWorkloadGroup } from '@forepath/loadweaver/shared/util-policy-compiler';

import { pickCertificate, type StoredCertificate } from '../acme/certificates.utils';
import { serviceId, type ParsedDeployment } from '../utils/workload-planning.utils';

/** Workload group of a service's replicas that the ingress may reach (explicit membership, 3.3). */
export function exposeGroup(deployment: string, service: string): string {
  return `expose:${deployment}/${service}`;
}

export function upstreamName(
  project: string,
  deployment: string,
  service: string,
  port: number,
  protocol: 'tcp' | 'udp' = 'tcp',
): string {
  return `${serviceId(project, deployment, service)}${protocol === 'udp' ? '/udp' : ''}:${port}`;
}

/** Coraza proxy-wasm 0.6.0 (OWASP CRS included), the only WAF module agents accept (pinned, 3.6). */
export const WAF_MODULE_SHA256 = 'f36e710529167482df820b790981230092da098d26d21aebb16f1d9c8c4e26d5';
export const RATE_LIMIT_PORT = 8081;

/** Stable id of a route for the rate-limit service. */
export function routeId(host: string, prefix: string): string {
  return createHash('sha256').update(`${host}${prefix}`).digest('hex').slice(0, 16);
}

export interface RouteLimit {
  id: string;
  limits: NonNullable<HttpExposure['rateLimit']>;
}

const WAF_ORDER = ['off', 'monitor', 'enforce'] as const;

export interface Exposures {
  /** Limits per route, for the rate-limit service's configuration. */
  limits: RouteLimit[];
  sites: Ingress['sites'];
  forwards: Ingress['forwards'];
  /** Upstreams without endpoints; endpoints come from the placements. */
  upstreams: { name: string; service: string; port: number }[];
  errors: string[];
}

/** Public status pages (3.25) are served by the control-plane API on the members, through the ingress. */
export const STATUS_PAGE_SERVICE = 'lw/_platform/status';
export const STATUS_PAGE_PATH = '/api/public/status/';

export interface StatusPageHost {
  project: string;
  name: string;
  host: string;
}

/** The members' HTTP API port (the same on every member). */
export function platformHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  return parseInt(env['PORT'] || '3400', 10);
}

export function statusPageHosts(
  resources: readonly { kind: string; name: string; project: string | null; spec: Record<string, unknown> }[],
): StatusPageHost[] {
  return resources
    .filter((r) => r.kind === 'StatusPage' && r.project)
    .map((r) => ({ project: r.project as string, name: r.name, host: String(r.spec['host']).toLowerCase() }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * What the deployments expose (3.6): `x-loadweaver.exposure.http` hostnames and published `ports`, plus the status
 * pages' hostnames. A hostname + path or a public port belongs to exactly one service; a second claim is an error in
 * the plan.
 */
export function collectExposures(
  parsed: readonly ParsedDeployment[],
  statusPages: readonly StatusPageHost[] = [],
  httpPort = platformHttpPort(),
): Exposures {
  const sites = new Map<string, Ingress['sites'][number]>();
  const routeOwners = new Map<string, string>();
  const forwards: Ingress['forwards'] = [];
  const forwardOwners = new Map<string, string>();
  const upstreams = new Map<string, { name: string; service: string; port: number }>();
  const errors: string[] = [];
  const limits: RouteLimit[] = [];

  for (const d of [...parsed].sort((a, b) => `${a.project}/${a.name}`.localeCompare(`${b.project}/${b.name}`))) {
    for (const s of d.compose.services) {
      const owner = serviceId(d.project, d.name, s.name);

      for (const http of s.http) {
        const key = `${http.host}${http.path}`;
        const existing = routeOwners.get(key);

        if (existing && existing !== owner) {
          errors.push(`${http.host}${http.path} is exposed by both ${existing} and ${owner}`);
          continue;
        }

        routeOwners.set(key, owner);

        const upstream = upstreamName(d.project, d.name, s.name, http.port);

        upstreams.set(upstream, { name: upstream, service: owner, port: http.port });

        const site = sites.get(http.host) ?? { host: http.host, routes: [] };

        const id = routeId(http.host, http.path);

        site.routes.push({
          prefix: http.path,
          upstream,
          ...(http.rateLimit
            ? {
                rateLimit: {
                  id,
                  perIp: !!http.rateLimit.perIp,
                  ...(http.rateLimit.perKey ? { perKeyHeader: http.rateLimit.perKey.header } : {}),
                  total: !!http.rateLimit.total,
                },
              }
            : {}),
        });

        if (http.rateLimit) limits.push({ id, limits: http.rateLimit });

        // The strictest WAF mode of a host's routes applies to the host (the ingress runs the WAF per virtual host).
        if (http.waf && WAF_ORDER.indexOf(http.waf) > WAF_ORDER.indexOf(site.waf ?? 'off')) site.waf = http.waf;

        sites.set(http.host, site);
      }

      for (const port of s.ports) {
        const key = `${port.protocol}/${port.publishedPort}`;
        const existing = forwardOwners.get(key);

        if (existing && existing !== owner) {
          errors.push(`${port.protocol} port ${port.publishedPort} is forwarded by both ${existing} and ${owner}`);
          continue;
        }

        if (port.protocol === 'tcp' && (port.publishedPort === 80 || port.publishedPort === 443)) {
          errors.push(
            `${owner}: tcp ports 80 and 443 belong to the HTTP ingress; expose hostnames with x-loadweaver.exposure.http`,
          );
          continue;
        }

        forwardOwners.set(key, owner);

        const upstream = upstreamName(d.project, d.name, s.name, port.targetPort, port.protocol);

        upstreams.set(upstream, { name: upstream, service: owner, port: port.targetPort });
        forwards.push({ protocol: port.protocol, port: port.publishedPort, upstream });
      }
    }
  }

  // A status page owns its whole hostname; the API finds the project by the Host header.
  const statusUpstream = `${STATUS_PAGE_SERVICE}:${httpPort}`;

  for (const page of statusPages) {
    const owner = `status page ${page.project}/${page.name}`;
    const taken = sites.has(page.host) ? (routeOwners.get(`${page.host}/`) ?? 'a service') : null;

    if (taken) {
      errors.push(`${page.host} is used by both ${taken} and ${owner}`);
      continue;
    }

    routeOwners.set(`${page.host}/`, owner);
    sites.set(page.host, {
      host: page.host,
      routes: [{ prefix: '/', upstream: statusUpstream, rewrite: STATUS_PAGE_PATH }],
    });
    upstreams.set(statusUpstream, { name: statusUpstream, service: STATUS_PAGE_SERVICE, port: httpPort });
  }

  return {
    limits,
    sites: [...sites.values()].sort((a, b) => a.host.localeCompare(b.host)),
    forwards: forwards.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol)),
    upstreams: [...upstreams.values()],
    errors,
  };
}

/** The ingress may reach exactly the exposed ports of the exposed services (built-in policies, 3.3). */
export function ingressPolicies(parsed: readonly ParsedDeployment[]): {
  groups: NamedWorkloadGroup[];
  policies: NamedPolicy[];
} {
  const groups: NamedWorkloadGroup[] = [];
  const policies: NamedPolicy[] = [];

  for (const d of parsed) {
    for (const s of d.compose.services) {
      const tcp = [
        ...new Set([
          ...s.http.map((h) => h.port),
          ...s.ports.filter((p) => p.protocol === 'tcp').map((p) => p.targetPort),
        ]),
      ].sort((a, b) => a - b);
      const udp = [...new Set(s.ports.filter((p) => p.protocol === 'udp').map((p) => p.targetPort))].sort(
        (a, b) => a - b,
      );

      if (tcp.length === 0 && udp.length === 0) continue;

      const group = exposeGroup(d.name, s.name);

      groups.push({
        project: d.project,
        name: group,
        spec: { selector: { names: [] }, intraGroup: 'isolate', exposed: false },
      });
      policies.push({
        project: d.project,
        name: `ingress:${d.name}/${s.name}`,
        builtin: true,
        spec: {
          mode: 'enforce',
          action: 'allow',
          description: `The ingress reaches ${d.name}/${s.name} (3.6).`,
          from: [{ builtin: 'ingress' }],
          to: [{ group, project: d.project }],
          rules: [
            ...(tcp.length ? [{ protocol: 'tcp' as const, ports: tcp }] : []),
            ...(udp.length ? [{ protocol: 'udp' as const, ports: udp }] : []),
          ],
        },
      });
    }
  }

  return { groups, policies };
}

/**
 * The ingress section of an ingress node's desired state; endpoints are the running copies of each service. Sites
 * get the best valid certificate covering them; private keys are added at push time, never stored here.
 */
export function ingressState(
  exposures: Exposures,
  addresses: string[],
  endpoints: ReadonlyMap<string, string[]>,
  certificates: readonly StoredCertificate[] = [],
  challenges: readonly { token: string; keyAuthorization: string }[] = [],
  now = new Date(),
  rateLimitEndpoints: readonly string[] = [],
): Ingress | undefined {
  if (addresses.length === 0) return undefined;

  const limited = exposures.limits.length > 0 && rateLimitEndpoints.length > 0;
  const waf = exposures.sites.some((site) => site.waf && site.waf !== 'off');

  const picked = new Map(exposures.sites.map((site) => [site.host, pickCertificate(site.host, certificates, now)]));
  const used = [
    ...new Map([...picked.values()].filter((c): c is StoredCertificate => !!c).map((c) => [c.id, c])).values(),
  ];

  return {
    addresses: [...addresses].sort(),
    sites: exposures.sites.map((site) => ({
      ...site,
      ...(picked.get(site.host) ? { certificate: picked.get(site.host)?.id } : {}),
    })),
    certificates: used
      .map((c) => ({ id: c.id, certificatePem: c.certificatePem as string }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    acmeChallenges: challenges
      .map((c) => ({ token: c.token, keyAuthorization: c.keyAuthorization }))
      .sort((a, b) => a.token.localeCompare(b.token)),
    forwards: exposures.forwards,
    upstreams: exposures.upstreams.map((u) => ({
      name: u.name,
      endpoints: (endpoints.get(u.service) ?? []).map((address) => ({ address, port: u.port })),
    })),

    ...(limited ? { rateLimitService: { endpoints: [...rateLimitEndpoints], port: RATE_LIMIT_PORT } } : {}),
    ...(waf ? { wafModule: { sha256: WAF_MODULE_SHA256 } } : {}),
  };
}

/**
 * Nodes that run the ingress: members of the ingress pool's node group that take work (active or cordoned), so the
 * configuration is already there when one becomes the holder of an address.
 */
export function ingressNodeSet(
  ingressPool: string | undefined,
  pools: ReadonlyMap<string, { nodeGroup: string }>,
  groups: ReadonlyMap<string, { selector: Selector }>,
  nodes: readonly { name: string; site: string; labels: Record<string, string> | null; lifecycle: string }[],
): Set<string> {
  const pool = ingressPool ? pools.get(ingressPool) : undefined;
  const group = pool ? groups.get(pool.nodeGroup) : undefined;

  if (!group) return new Set();

  return new Set(
    nodes
      .filter(
        (n) =>
          (n.lifecycle === 'active' || n.lifecycle === 'cordoned') &&
          matchesSelector(group.selector, {
            name: n.name,
            labels: { ...(n.labels ?? {}), 'loadweaver.com/site': n.site, 'loadweaver.com/node': n.name },
          }),
      )
      .map((n) => n.name),
  );
}

const UNITS: Record<Rate['unit'], string> = { second: 'second', minute: 'minute', hour: 'hour', day: 'day' };

/** Configuration of the rate-limit service (3.6): one descriptor tree per limited route. */
export function renderRateLimitConfig(limits: readonly RouteLimit[]): string {
  const limit = (rate: Rate) => ({ unit: UNITS[rate.unit], requests_per_unit: rate.requests });

  return stringify({
    domain: 'loadweaver',
    descriptors: [...limits]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        key: 'route',
        value: r.id,
        ...(r.limits.total ? { rate_limit: limit(r.limits.total) } : {}),
        descriptors: [
          ...(r.limits.perIp ? [{ key: 'remote_address', rate_limit: limit(r.limits.perIp) }] : []),
          ...(r.limits.perKey ? [{ key: 'api_key', rate_limit: limit(r.limits.perKey.rate) }] : []),
        ],
      })),
  });
}
