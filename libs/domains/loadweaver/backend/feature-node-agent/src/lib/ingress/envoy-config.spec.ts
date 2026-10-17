import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';

import { envoySpec, renderClusters, renderEnvoyBootstrap, renderListeners } from './envoy-config';

const ingress: Ingress = {
  addresses: ['203.0.113.10', '2001:db8::10'],
  sites: [
    {
      host: 'a.example.com',
      routes: [
        { prefix: '/', upstream: 'p/d/a:80' },
        { prefix: '/api', upstream: 'p/d/b:8080' },
      ],
    },
    { host: 'b.example.com', routes: [{ prefix: '/', upstream: 'p/d/a:80' }], certificate: 'pending' },
  ],
  // A certificate without its key (not pushed) must not produce an HTTPS chain.
  certificates: [{ id: 'pending', certificatePem: 'CERT' }],
  acmeChallenges: [],
  forwards: [{ protocol: 'tcp', port: 5432, upstream: 'p/d/db:5432', maxConnections: 50 }],
  upstreams: [{ name: 'p/d/a:80', endpoints: [{ address: '10.88.1.2', port: 80 }] }],
};

describe('envoy config', () => {
  it('keeps the admin API off the network and runs Envoy with minimal privileges', () => {
    const bootstrap = JSON.parse(renderEnvoyBootstrap('n1'));

    expect(bootstrap.admin.address).toEqual({ pipe: { path: '/etc/envoy/run/admin.sock', mode: 0o600 } });
    expect(envoySpec('/d', 'b', 'img').hardening).toEqual({
      capDrop: ['ALL'],
      capAdd: ['NET_BIND_SERVICE'],
      readOnlyRootfs: true,
      noNewPrivileges: true,
      tmpfs: ['/tmp'],
    });
  });

  it('renders listeners per address, longest prefixes first, and no HTTPS without a key', () => {
    const listeners = JSON.parse(renderListeners(ingress)).resources as {
      name: string;
      address: { socket_address: { address: string; port_value: number } };
      freebind: boolean;
      filter_chains: {
        filters: {
          typed_config: {
            route_config?: { virtual_hosts: { domains: string[]; routes: { match: { prefix?: string } }[] }[] };
          };
        }[];
      }[];
    }[];

    expect(listeners.map((l) => l.name)).toEqual([
      'http_203_0_113_10',
      'tcp_203_0_113_10_5432',
      'http_2001_db8__10',
      'tcp_2001_db8__10_5432',
    ]);
    expect(listeners.every((l) => l.freebind)).toBe(true);

    const hosts = listeners[0].filter_chains[0].filters[0].typed_config.route_config?.virtual_hosts ?? [];

    expect(hosts[0].routes.map((r) => r.match.prefix)).toEqual(['/api', '/']);
    // Not HTTPS-only yet: no key, so no redirect either.
    expect(JSON.stringify(hosts[1])).not.toContain('https_redirect');
    expect(JSON.stringify(listeners[1])).toContain('"max_connections":50');
  });

  it('renders static clusters with outlier detection', () => {
    expect(JSON.parse(renderClusters(ingress)).resources[0]).toMatchObject({
      name: 'p/d/a:80',
      type: 'STATIC',
      outlier_detection: { consecutive_5xx: 5 },
    });
  });

  it('bounds workers and sizes memory with them', () => {
    expect(envoySpec('/d', 'b', 'img', 32).cmd).toContain('8');
    expect(envoySpec('/d', 'b', 'img', 2).memoryBytes).toBe(512 * 1024 ** 2);
    expect(envoySpec('/d', 'b', 'img', 2).hash).not.toBe(envoySpec('/d', 'b', 'img', 4).hash);
  });

  describe('protection', () => {
    const protectedIngress: Ingress = {
      ...ingress,
      sites: [
        { host: 'open.example.com', routes: [{ prefix: '/', upstream: 'p/d/a:80' }] },
        {
          host: 'shop.example.com',
          routes: [
            {
              prefix: '/',
              upstream: 'p/d/a:80',
              rateLimit: { id: 'r1', perIp: true, total: true, perKeyHeader: 'x-api-key' },
            },
          ],
          waf: 'enforce',
        },
        { host: 'blog.example.com', routes: [{ prefix: '/', upstream: 'p/d/a:80' }], waf: 'monitor' },
      ],
      forwards: [],
      rateLimitService: { endpoints: ['10.99.0.1', '10.99.0.2'], port: 8081 },
      wafModule: { sha256: 'a'.repeat(64) },
    };
    type Hcm = {
      route_config: {
        virtual_hosts: {
          domains: string[];
          typed_per_filter_config?: Record<string, unknown>;
          routes: { route?: { rate_limits?: unknown[] }; direct_response?: { status: number } }[];
        }[];
      };
      http_filters: {
        name: string;
        disabled?: boolean;
        typed_config: {
          failure_mode_deny?: boolean;
          config?: { failure_policy: string; configuration: { value: string } };
        };
      }[];
    };
    const hcm = (wafModule: boolean): Hcm =>
      JSON.parse(renderListeners(protectedIngress, { wafModule })).resources[0].filter_chains[0].filters[0]
        .typed_config;
    const host = (h: Hcm, name: string) => h.route_config.virtual_hosts.find((v) => v.domains[0] === name);

    it('runs one WAF instance per mode, only on its hosts, reloading a crashed VM', () => {
      const h = hcm(true);
      const waf = h.http_filters.filter((f) => f.name.startsWith('coraza-'));

      expect(waf.map((f) => [f.name, f.disabled])).toEqual([
        ['coraza-monitor', true],
        ['coraza-enforce', true],
      ]);
      expect(waf.every((f) => f.typed_config.config?.failure_policy === 'FAIL_RELOAD')).toBe(true);
      expect(JSON.parse(waf[1].typed_config.config?.configuration.value ?? '{}').default_directives).toBe('enforce');
      expect(Object.keys(host(h, 'shop.example.com')?.typed_per_filter_config ?? {})).toEqual(['coraza-enforce']);
      expect(Object.keys(host(h, 'blog.example.com')?.typed_per_filter_config ?? {})).toEqual(['coraza-monitor']);
      expect(host(h, 'open.example.com')?.typed_per_filter_config).toBeUndefined();
    });

    it('refuses enforce hosts without the module instead of serving them unprotected', () => {
      const h = hcm(false);

      expect(h.http_filters.some((f) => f.name.startsWith('coraza-'))).toBe(false);
      expect(host(h, 'shop.example.com')?.routes.at(-1)?.direct_response?.status).toBe(503);
      expect(host(h, 'blog.example.com')?.routes.at(-1)?.direct_response).toBeUndefined();
    });

    it('limits through the cluster-wide service, failing open', () => {
      const h = hcm(true);

      expect(
        h.http_filters.find((f) => f.name === 'envoy.filters.http.ratelimit')?.typed_config.failure_mode_deny,
      ).toBe(false);
      expect(host(h, 'shop.example.com')?.routes.at(-1)?.route?.rate_limits).toHaveLength(3);
      expect(host(h, 'open.example.com')?.routes.at(-1)?.route?.rate_limits).toBeUndefined();
      expect(
        JSON.parse(renderClusters(protectedIngress)).resources.some((c: { name: string }) => c.name === 'lw_ratelimit'),
      ).toBe(true);
    });
  });
});
