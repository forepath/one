import { COMPOSE_YAML, DIGEST_A, MANIFEST_YAML } from './__fixtures__/fixtures';
import { checkLicense } from './licenses';
import { hasLintErrors, lintPackage, type LintFinding } from './lint';
import { parseManifest, type AppManifest } from './manifest';

function manifest(change: (m: AppManifest) => void = () => undefined): AppManifest {
  const result = parseManifest(MANIFEST_YAML);

  if (!result.ok) throw new Error(result.errors.join('\n'));

  change(result.value);

  return result.value;
}

const IMAGE = `ghcr.io/acme/x@${DIGEST_A}`;

/** The fixture manifest without service references (so tests see only the rule under test). */
function bare(change: (m: AppManifest) => void = () => undefined): AppManifest {
  return manifest((m) => {
    m.dependencies = [];
    m.healthChecks = [];
    m.migrations = [];
    change(m);
  });
}

function lint(compose: string, m = bare()): LintFinding[] {
  return lintPackage({ manifest: m, compose });
}

function rules(findings: LintFinding[], severity = 'error'): string[] {
  return findings.filter((f) => f.severity === severity).map((f) => `${f.rule}@${f.path ?? ''}`);
}

describe('lintPackage', () => {
  it('passes the fixture package', () => {
    const findings = lint(COMPOSE_YAML, manifest());

    expect(findings).toEqual([]);
    expect(hasLintErrors(findings)).toBe(false);
  });

  it('flags host access without a reason', () => {
    const compose = `services:
  vpn:
    image: ${IMAGE}
    network_mode: host
    privileged: true
    pid: host
    ipc: host
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
      - named:/named
      - type: bind
        source: /etc
        target: /host-etc
      - type: volume
        source: named
        target: /x
`;

    expect(rules(lint(compose))).toEqual([
      'host-network@services.vpn.network_mode',
      'privileged@services.vpn.privileged',
      'host-pid@services.vpn.pid',
      'host-ipc@services.vpn.ipc',
      'host-path@services.vpn.volumes[0]',
      'host-path@services.vpn.volumes[1]',
      'host-path@services.vpn.volumes[3]',
    ]);
  });

  it('allows host access with a declared reason (manifest or x-loadweaver-exceptions)', () => {
    const compose = `services:
  vpn:
    image: ${IMAGE}
    network_mode: host
    privileged: true
    x-loadweaver-exceptions:
      privileged: needs to manage WireGuard interfaces
`;
    const m = bare((x) => {
      x.exceptions = [
        { rule: 'host-network', service: 'vpn', reason: 'routes traffic for the whole node' },
        { rule: 'host-pid', reason: 'not needed by anything here' },
      ];
    });
    const findings = lint(compose, m);

    expect(rules(findings)).toEqual([]);
    expect(rules(findings, 'info')).toEqual([
      'host-network@services.vpn.network_mode',
      'privileged@services.vpn.privileged',
    ]);
    expect(findings.find((f) => f.rule === 'host-network')?.message).toMatch(/routes traffic/);
    expect(rules(findings, 'warning')).toEqual(['unused-exception@manifest.exceptions[1]']);
  });

  it('does not apply a service-scoped exception to another service', () => {
    const compose = `services:
  a:
    image: ${IMAGE}
    privileged: true
`;
    const m = bare((x) => (x.exceptions = [{ rule: 'privileged', service: 'b', reason: 'only b needs this one' }]));

    expect(rules(lint(compose, m))).toEqual([
      'privileged@services.a.privileged',
      'manifest@manifest.exceptions[0].service',
    ]);
  });

  it('flags unknown inline exception rules and too-short reasons', () => {
    const compose = `services:
  a:
    image: ${IMAGE}
    privileged: true
    x-loadweaver-exceptions:
      privileged: short
      root: because I want to
`;

    expect(rules(lint(compose))).toEqual([
      'privileged@services.a.privileged',
      'manifest@services.a.x-loadweaver-exceptions.root',
    ]);
  });

  it('flags plaintext secrets in environment maps and lists', () => {
    const compose = `services:
  a:
    image: ${IMAGE}
    environment:
      DB_PASSWORD: hunter2
      API_KEY: abc123
      apiKey: abc123
      JWT_SECRET: s3cr3t
      GITHUB_TOKEN: ghp_x
      SAFE_PASSWORD: \${password}
      PASSWORD_FILE: /run/secrets/pw
      TOKEN_TTL: 3600
      TOKEN_AUTH_ENABLED: "true"
      KEYCLOAK_URL: https://kc.example.com
      EMPTY_SECRET: ""
      UNSET_TOKEN:
  b:
    image: ${IMAGE}
    environment:
      - ADMIN_PASSWORD=admin
      - LOG_LEVEL=debug
      - SECRET_REF=/run/secrets/x
`;
    const m = bare((x) => (x.parameters.properties['password'] = { type: 'string', default: 'x' }));

    expect(rules(lint(compose, m))).toEqual([
      'plaintext-secret@services.a.environment.DB_PASSWORD',
      'plaintext-secret@services.a.environment.API_KEY',
      'plaintext-secret@services.a.environment.apiKey',
      'plaintext-secret@services.a.environment.JWT_SECRET',
      'plaintext-secret@services.a.environment.GITHUB_TOKEN',
      'plaintext-secret@services.b.environment.ADMIN_PASSWORD',
    ]);
  });

  it('flags unpinned images', () => {
    const compose = `services:
  a:
    image: nginx:latest
  b:
    build: .
`;

    expect(rules(lint(compose))).toEqual(['unpinned-image@services.a.image', 'unpinned-image@services.b.image']);
  });

  it('checks the licence', () => {
    expect(
      rules(
        lint(
          COMPOSE_YAML,
          bare((m) => (m.license = 'BUSL-1.1')),
        ),
      ),
    ).toEqual(['license@manifest.license']);
    expect(
      rules(
        lint(
          COMPOSE_YAML,
          bare((m) => (m.license = 'LicenseRef-Acme-Free')),
        ),
        'warning',
      ),
    ).toEqual(['license@manifest.license']);
    expect(
      lint(
        COMPOSE_YAML,
        bare((m) => (m.license = 'MIT OR Apache-2.0')),
      ),
    ).toEqual([]);
  });

  it('flags undeclared and invalid placeholders anywhere in the compose', () => {
    const compose = `services:
  a:
    image: ${IMAGE}
    command: ["\${nope}", "$HOME", "\${port}", "\${nope}"]
secrets:
  s:
    x-loadweaver-ref: \${secret:unknown}
`;

    expect(
      lint(compose)
        .filter((f) => f.severity === 'error')
        .map((f) => f.message),
    ).toEqual([
      '${nope}: parameter nope is not declared in the manifest',
      'unsupported placeholder $HOME (use ${parameter}, ${secret:name} or $$ for a literal $)',
      '${secret:unknown}: secret unknown is not declared in the manifest',
    ]);
  });

  it('flags conditional secrets used outside the top-level secrets section', () => {
    const m = bare((x) => {
      x.secrets.push({ name: 'token', description: 'Token', requiredWhen: { parameter: 'debug' } });
      x.suggestions.policies = [{ kind: 'Policy', metadata: { name: 'p' }, spec: { token: '${secret:token}' } }];
    });
    const compose = `services:
  a:
    image: ${IMAGE}
    environment:
      TOKEN: \${secret:token}
    secrets: [token]
secrets:
  token:
    x-loadweaver-ref: \${secret:token}
`;

    expect(
      lint(compose, m)
        .filter((f) => f.rule === 'conditional-secret')
        .map((f) => `${f.severity}@${f.path}`),
    ).toEqual(['error@services', 'error@manifest.suggestions.policies[0]']);
    expect(
      lint(
        compose.replace('TOKEN: ${secret:token}', 'TOKEN_FILE: /run/secrets/token'),
        bare((x) => x.secrets.push({ name: 'token', description: 'Token', requiredWhen: { parameter: 'debug' } })),
      ),
    ).toEqual([]);
  });

  it('checks manifest references to compose services', () => {
    const compose = `services:
  other:
    image: ${IMAGE}
`;

    expect(rules(lint(compose, manifest()))).toEqual([
      'manifest@manifest.dependencies[0].bundled.services[0]',
      'manifest@manifest.healthChecks[0].service',
      'manifest@manifest.migrations[0].steps[0].service',
    ]);
  });

  it('reports a broken compose file', () => {
    expect(rules(lint('a: ['))).toEqual(['compose@']);
    expect(rules(lint('services: 1'))).toEqual(['compose@']);
  });

  it('accepts a parsed compose tree', () => {
    expect(
      lintPackage({ manifest: bare(), compose: { services: { a: { image: 'x' } } } }).map((f) => f.rule),
    ).toContain('unpinned-image');
  });
});

describe('checkLicense', () => {
  it.each([
    ['MIT', 'free'],
    ['AGPL-3.0-only', 'free'],
    ['(MIT OR Apache-2.0) AND BSD-3-Clause', 'free'],
    ['GPL-2.0-only WITH Classpath-exception-2.0', 'free'],
    ['SSPL-1.0', 'not-free'],
    ['MIT AND Elastic-2.0', 'not-free'],
    ['GPL-3.0', 'not-free'],
    ['LicenseRef-Agenstra-Startup', 'review'],
    ['', 'not-free'],
  ])('%s → %s', (expression, verdict) => {
    expect(checkLicense(expression).verdict).toBe(verdict);
  });
});
