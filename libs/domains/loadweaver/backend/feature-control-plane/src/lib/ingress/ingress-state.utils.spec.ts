import {
  collectExposures,
  ingressNodeSet,
  ingressPolicies,
  ingressState,
  RATE_LIMIT_PORT,
  renderRateLimitConfig,
  routeId,
  WAF_MODULE_SHA256,
} from './ingress-state.utils';

const service = (name: string, extra: Record<string, unknown> = {}) => ({ name, http: [], ports: [], ...extra });
const deployment = (project: string, name: string, services: ReturnType<typeof service>[]) =>
  ({ project, name, compose: { services } }) as never;

describe('ingress state', () => {
  const parsed = [
    deployment('shop', 'web', [
      service('api', {
        http: [{ host: 'shop.example.com', port: 8080, path: '/api' }],
        ports: [{ protocol: 'udp', publishedPort: 5353, targetPort: 53 }],
      }),
      service('ui', { http: [{ host: 'shop.example.com', port: 3000, path: '/' }] }),
      service('worker'),
    ]),
  ];

  it('collects hostnames, forwards and upstreams', () => {
    const exposures = collectExposures(parsed);

    expect(exposures.errors).toEqual([]);
    expect(exposures.sites).toEqual([
      {
        host: 'shop.example.com',
        routes: [
          { prefix: '/api', upstream: 'shop/web/api:8080' },
          { prefix: '/', upstream: 'shop/web/ui:3000' },
        ],
      },
    ]);
    expect(exposures.forwards).toEqual([{ protocol: 'udp', port: 5353, upstream: 'shop/web/api/udp:53' }]);

    const state = ingressState(exposures, ['203.0.113.10'], new Map([['shop/web/api', ['10.88.1.2', 'fd00::2']]]));

    expect(state?.upstreams.find((u) => u.name === 'shop/web/api:8080')?.endpoints).toEqual([
      { address: '10.88.1.2', port: 8080 },
      { address: 'fd00::2', port: 8080 },
    ]);
    expect(state?.upstreams.find((u) => u.name === 'shop/web/ui:3000')?.endpoints).toEqual([]);
    expect(ingressState(exposures, [], new Map())).toBeUndefined();
  });

  it('rejects double claims and the HTTP ports as L4 forwards', () => {
    const clash = collectExposures([
      ...parsed,
      deployment('blog', 'web', [
        service('x', {
          http: [{ host: 'shop.example.com', port: 80, path: '/' }],
          ports: [{ protocol: 'tcp', publishedPort: 443, targetPort: 8443 }],
        }),
      ]),
    ]);

    expect(clash.errors.sort()).toEqual([
      'blog/web/x: tcp ports 80 and 443 belong to the HTTP ingress; expose hostnames with x-loadweaver.exposure.http',
      'shop.example.com/ is exposed by both blog/web/x and shop/web/ui',
    ]);
  });

  it('opens exactly the exposed ports to the ingress', () => {
    const { groups, policies } = ingressPolicies(parsed);

    expect(groups.map((g) => g.name)).toEqual(['expose:web/api', 'expose:web/ui']);
    expect(policies[0].spec).toMatchObject({
      from: [{ builtin: 'ingress' }],
      to: [{ group: 'expose:web/api', project: 'shop' }],
      rules: [
        { protocol: 'tcp', ports: [8080] },
        { protocol: 'udp', ports: [53] },
      ],
    });
  });

  it('runs on the members of the ingress pool node group that take work', () => {
    const nodes = [
      { name: 'n1', site: 'fra1', labels: { role: 'ingress' }, lifecycle: 'active' },
      { name: 'n2', site: 'fra1', labels: { role: 'ingress' }, lifecycle: 'draining' },
      { name: 'n3', site: 'fra1', labels: null, lifecycle: 'cordoned' },
    ];
    const pools = new Map([['pub', { nodeGroup: 'edge' }]]);

    expect([
      ...ingressNodeSet('pub', pools, new Map([['edge', { selector: { matchLabels: { role: 'ingress' } } }]]), nodes),
    ]).toEqual(['n1']);
    expect(ingressNodeSet(undefined, pools, new Map(), nodes).size).toBe(0);
  });

  describe('protection', () => {
    const minute = (requests: number) => ({ requests, unit: 'minute' as const });
    const protectedParsed = [
      deployment('shop', 'web', [
        service('api', {
          http: [
            {
              host: 'shop.example.com',
              port: 8080,
              path: '/api',
              rateLimit: { perIp: minute(100), perKey: { header: 'x-api-key', rate: minute(10) }, total: minute(1000) },
              waf: 'monitor',
            },
          ],
        }),
        service('ui', { http: [{ host: 'shop.example.com', port: 3000, path: '/', waf: 'enforce' }] }),
      ]),
    ];

    it('carries limits per route and the strictest WAF mode per host', () => {
      const exposures = collectExposures(protectedParsed);
      const id = routeId('shop.example.com', '/api');

      expect(exposures.limits.map((l) => l.id)).toEqual([id]);
      expect(exposures.sites[0].waf).toBe('enforce');
      expect(exposures.sites[0].routes.find((r) => r.prefix === '/api')?.rateLimit).toEqual({
        id,
        perIp: true,
        perKeyHeader: 'x-api-key',
        total: true,
      });

      const state = ingressState(exposures, ['203.0.113.10'], new Map(), [], [], new Date(), ['10.99.0.1']);

      expect(state?.rateLimitService).toEqual({ endpoints: ['10.99.0.1'], port: RATE_LIMIT_PORT });
      expect(state?.wafModule).toEqual({ sha256: WAF_MODULE_SHA256 });
      // Without a reachable limiter, no limits (fail open) rather than a dangling filter.
      expect(ingressState(exposures, ['203.0.113.10'], new Map())?.rateLimitService).toBeUndefined();
    });

    it('renders the rate-limit service configuration', () => {
      const config = renderRateLimitConfig(collectExposures(protectedParsed).limits);
      const id = routeId('shop.example.com', '/api');

      expect(config).toContain('domain: loadweaver');
      expect(config).toContain(`value: ${id}`);
      expect(config).toMatch(/key: remote_address\n\s+rate_limit:\n\s+unit: minute\n\s+requests_per_unit: 100/);
      expect(config).toMatch(/key: api_key\n\s+rate_limit:\n\s+unit: minute\n\s+requests_per_unit: 10\n/);
    });
  });
});
