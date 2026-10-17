import { interpolate, parseCompose, splitCommand, startOrder, type ComposeParseOptions } from './parse-compose';
import { parseBytes, parseCpus, parseDuration } from './units';

const options: ComposeParseOptions = {
  name: 'shop',
  project: 'shop',
  defaultRequests: { cpuMillis: 250, memoryBytes: 256 * 1024 ** 2 },
  variables: { TAG: '1.4.2' },
};

const COMPOSE = `
x-common: &common
  restart: unless-stopped
  labels: { team: web }
services:
  db:
    <<: *common
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password
    volumes: [db-data:/var/lib/postgresql/data]
    secrets: [db-password]
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 5s
      retries: 10
    deploy:
      resources:
        reservations: { cpus: '0.5', memory: 512m }
        limits: { cpus: '2', memory: 2g }
    networks: [backend]
  api:
    image: ghcr.io/acme/api:\${TAG}
    command: node server.js --port "8080"
    depends_on:
      db: { condition: service_healthy }
    networks: [backend, frontend]
    ports: ["9090:8080", "5000-5001:6000-6001/udp"]
    x-loadweaver:
      replicas: 3
      groups: [public-api]
      exposure:
        http: [{ host: api.example.com, port: 8080 }]
  migrate:
    image: ghcr.io/acme/api:\${TAG}
    command: ["node", "migrate.js"]
    depends_on: [db]
    networks: [backend]
    x-loadweaver: { job: { phase: before } }
  report:
    image: ghcr.io/acme/report:1
    x-loadweaver:
      cron: { schedule: "0 3 * * *", timezone: Europe/Berlin, timeout: 30m }
volumes:
  db-data:
    x-loadweaver: { size: 20g, replicas: 2, crossSite: async }
networks:
  backend: {}
  frontend: {}
secrets:
  db-password:
    external: true
`;

describe('parseCompose', () => {
  const result = parseCompose(COMPOSE, options);

  it('parses a realistic project', () => {
    expect(result.ok).toBe(true);
  });

  if (result.ok !== true) return;

  const { deployment, warnings } = result;
  const svc = (name: string) => deployment.services.find((s) => s.name === name)!;

  it('applies anchors, interpolation and both command syntaxes', () => {
    expect(svc('db').restart).toBe('unless-stopped');
    expect(svc('db').labels).toEqual({ team: 'web' });
    expect(svc('api').image).toBe('ghcr.io/acme/api:1.4.2');
    expect(svc('api').command).toEqual(['node', 'server.js', '--port', '8080']);
    expect(svc('migrate').command).toEqual(['node', 'migrate.js']);
  });

  it('maps resources with requests, limits and project defaults', () => {
    expect(svc('db').resources).toEqual({
      requests: { cpuMillis: 500, memoryBytes: 512 * 1024 ** 2 },
      limits: { cpuMillis: 2000, memoryBytes: 2 * 1024 ** 3 },
      source: 'compose',
    });
    expect(svc('api').resources).toEqual({
      requests: { cpuMillis: 250, memoryBytes: 256 * 1024 ** 2 },
      limits: {},
      source: 'project-default',
    });
    expect(warnings).toContainEqual(
      expect.objectContaining({
        path: 'services.api.deploy.resources',
        message: 'no resource requests; the project defaults apply',
      }),
    );
  });

  it('turns ports into exposures instead of host bindings', () => {
    expect(svc('api').ports).toEqual([
      { protocol: 'tcp', publishedPort: 9090, targetPort: 8080 },
      { protocol: 'udp', publishedPort: 5000, targetPort: 6000 },
      { protocol: 'udp', publishedPort: 5001, targetPort: 6001 },
    ]);
    expect(svc('api').http).toEqual([{ host: 'api.example.com', port: 8080, path: '/' }]);
  });

  it('reads dependencies, health checks, networks, groups, jobs and cron', () => {
    expect(svc('api').dependsOn).toEqual([{ service: 'db', condition: 'healthy' }]);
    expect(svc('db').healthcheck).toEqual({
      test: ['CMD', 'pg_isready'],
      intervalMs: 5000,
      timeoutMs: 30000,
      retries: 10,
      startPeriodMs: 0,
    });
    expect(svc('api').networks).toEqual(['backend', 'frontend']);
    expect(svc('api').groups).toEqual(['public-api']);
    expect(svc('api').replicas).toBe(3);
    expect(svc('migrate')).toMatchObject({ kind: 'job', jobPhase: 'before' });
    expect(svc('report')).toMatchObject({
      kind: 'cron',
      cron: { schedule: '0 3 * * *', timezone: 'Europe/Berlin', concurrency: 'forbid', timeoutSeconds: 1800 },
      networks: ['default'],
    });
    expect(deployment.networks.map((n) => n.name)).toEqual(['default', 'backend', 'frontend']);
  });

  it('keeps secrets as references and volumes replicated', () => {
    expect(deployment.secrets).toEqual([{ name: 'db-password', ref: 'secret://shop/db-password' }]);
    expect(svc('db').secrets).toEqual([{ source: 'db-password', target: '/run/secrets/db-password' }]);
    expect(deployment.volumes).toEqual([
      { name: 'db-data', external: false, sizeBytes: 20 * 1024 ** 3, replicas: 2, crossSite: 'async', pins: [] },
    ]);
  });

  it('computes the start order from depends_on', () => {
    expect(startOrder(deployment)).toEqual([
      ['db', 'report'],
      ['api', 'migrate'],
    ]);
  });
});

describe('parseCompose validation and pins', () => {
  const parse = (yaml: string, extra: Partial<ComposeParseOptions> = {}) =>
    parseCompose(yaml, { ...options, ...extra });

  it('detects pins: bind mounts, host network, devices, container_name, unreplicated volumes', () => {
    const result = parse(`
services:
  a:
    image: x
    network_mode: host
    devices: ["/dev/nvidia0"]
    container_name: fixed
    volumes: ["/srv/data:/data", "/var/run/docker.sock:/var/run/docker.sock:ro"]
volumes:
  scratch:
    x-loadweaver: { replicas: 1, crossSite: none }
`);

    expect(result.ok).toBe(true);

    if (result.ok !== true) return;

    expect(result.deployment.services[0].pins.map((p) => p.kind).sort()).toEqual([
      'data',
      'data',
      'deployment',
      'deployment',
      'deployment',
    ]);
    expect(result.deployment.volumes[0].pins).toEqual([
      { kind: 'data', reason: 'volume scratch has no replica outside its node' },
    ]);
    expect(result.warnings.filter((w) => w.message.startsWith('unacknowledged')).length).toBe(5);
  });

  it('does not warn about acknowledged pins', () => {
    const result = parse(`
services:
  a:
    image: x
    network_mode: host
    x-loadweaver: { pinned: { reason: "needs the host's multicast" } }
`);

    expect(result.ok === true && result.warnings.some((w) => w.message.startsWith('unacknowledged'))).toBe(false);
  });

  it.each([
    ['missing image', 'services:\n  a: {}\n', 'image is required'],
    ['build only', 'services:\n  a: { build: . }\n', 'build is not supported'],
    ['env_file', 'services:\n  a: { image: x, env_file: .env }\n', 'env_file is not supported'],
    ['unknown dependency', 'services:\n  a: { image: x, depends_on: [b] }\n', 'unknown service b'],
    ['undefined volume', 'services:\n  a: { image: x, volumes: ["data:/d"] }\n', 'undefined volume data'],
    ['undefined network', 'services:\n  a: { image: x, networks: [n] }\n', 'undefined network n'],
    [
      'secret values in file',
      'services:\n  a: { image: x }\nsecrets:\n  s: { file: ./s.txt }\n',
      'must be external references',
    ],
    [
      'cycle',
      'services:\n  a: { image: x, depends_on: [b] }\n  b: { image: x, depends_on: [a] }\n',
      'dependency cycle',
    ],
    ['bad extension', 'services:\n  a: { image: x, x-loadweaver: { replicaz: 2 } }\n', 'Unrecognized key'],
    [
      'job and cron',
      'services:\n  a: { image: x, x-loadweaver: { job: {}, cron: { schedule: "@daily" } } }\n',
      'either a job or a cron job',
    ],
    ['missing variable', 'services:\n  a: { image: "x:${NOPE}" }\n', 'variable NOPE is not set'],
    [
      'container_name with replicas',
      'services:\n  a: { image: x, container_name: c, x-loadweaver: { replicas: 2 } }\n',
      'prevents more than one replica',
    ],
    ['no services', 'version: "3"\n', 'at least one service'],
    ['bad port', 'services:\n  a: { image: x, ports: ["70000:1"] }\n', 'invalid port mapping'],
    ['relative bind', 'services:\n  a: { image: x, volumes: ["./data:/data"] }\n', 'relative bind mount'],
  ])('rejects %s', (_label, yaml, message) => {
    const result = parse(yaml);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.some((i) => i.message.includes(message))).toBe(true);
  });

  it('rejects oversized files and duplicate keys', () => {
    expect(parse('x'.repeat(1024 * 1024 + 1)).ok).toBe(false);
    expect(parse('services:\n  a: { image: x }\n  a: { image: y }\n').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('interpolates like compose', () => {
    const missing: string[] = [];
    const vars = { A: 'a', EMPTY: '' };
    const run = (s: string) => interpolate(s, vars, (n) => missing.push(n));

    expect(run('$A ${A} ${EMPTY:-d} ${EMPTY-d} ${UNSET-d} $$A')).toBe('a a d  d $A');
    expect(run('${UNSET:?needs value}')).toBe('');
    expect(missing).toEqual(['UNSET']);
  });

  it('splits commands with quotes', () => {
    expect(splitCommand(`sh -c "echo 'hi there'" 'single quoted'`)).toEqual([
      'sh',
      '-c',
      "echo 'hi there'",
      'single quoted',
    ]);
  });

  it('parses units', () => {
    expect(parseDuration('1m30s')).toBe(90_000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1x')).toBeNull();
    expect(parseCpus('0.25')).toBe(250);
    expect(parseCpus('-1')).toBeNull();
    expect(parseBytes('512m')).toBe(512 * 1024 ** 2);
    expect(parseBytes('1.5g')).toBe(1.5 * 1024 ** 3);
    expect(parseBytes('12q')).toBeNull();
  });
});

describe('parseCompose cron validation', () => {
  it('rejects bad cron schedules and unknown timezones', () => {
    const result = parseCompose(
      `services:
  report:
    image: busybox:1.37
    x-loadweaver: { cron: { schedule: '61 * * * *', timezone: 'Mars/Olympus' } }
`,
      options,
    );

    expect(result.ok).toBe(false);
    expect(
      (result as { issues: { level: string; path: string }[] }).issues
        .filter((i) => i.level === 'error')
        .map((i) => i.path),
    ).toEqual(
      expect.arrayContaining([
        'services.report.x-loadweaver.cron.schedule',
        'services.report.x-loadweaver.cron.timezone',
      ]),
    );
  });
});

describe('parseCompose images', () => {
  it('keeps private images inside the project namespace', () => {
    const compose = (image: string) => `services:\n  app:\n    image: ${image}\n`;
    const errors = (image: string) => {
      const result = parseCompose(compose(image), options);

      return result.ok ? [] : result.issues.filter((i) => i.level === 'error').map((i) => i.message);
    };

    expect(errors('registry.lw/shop/api:1')).toEqual([]);
    expect(errors('registry.lw/other/api:1')).toEqual([expect.stringContaining('registry.lw/shop/')]);
    expect(errors('Not An Image')).toEqual(['invalid image reference']);
  });
});

describe('parseCompose HTTP exposure options', () => {
  it('parses rate limits and WAF modes, and rejects paths the agents would refuse', () => {
    const compose = (http: string) =>
      `services:\n  web:\n    image: nginx@sha256:${'a'.repeat(64)}\n    x-loadweaver: { exposure: { http: [${http}] } }\n`;
    const result = parseCompose(
      compose(
        `{ host: www.example.com, port: 80, rateLimit: { perIp: 100/m, perKey: { header: X-API-Key, rate: 10/s } }, waf: enforce }`,
      ),
      options,
    );

    expect(result.ok && result.deployment.services[0].http[0]).toEqual({
      host: 'www.example.com',
      port: 80,
      path: '/',
      rateLimit: {
        perIp: { requests: 100, unit: 'minute' },
        perKey: { header: 'x-api-key', rate: { requests: 10, unit: 'second' } },
      },
      waf: 'enforce',
    });
    expect(parseCompose(compose(`{ host: www.example.com, port: 80, path: '/a"b' }`), options).ok).toBe(false);
    expect(parseCompose(compose(`{ host: www.example.com, port: 80, rateLimit: { perIp: lots } }`), options).ok).toBe(
      false,
    );
  });
});
