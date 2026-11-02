import { parse } from 'yaml';

import { COMPOSE_YAML, DIGEST_A, MANIFEST_YAML } from './__fixtures__/fixtures';
import { findUnpinnedImages } from './compose-tree';
import { parseManifest, type AppManifest } from './manifest';
import { findPlaceholders, renderCompose, resolveParameters } from './render';

function manifest(): AppManifest {
  const result = parseManifest(MANIFEST_YAML);

  if (!result.ok) throw new Error(result.errors.join('\n'));

  return result.value;
}

const SECRETS = { 'db-password': 'secret://shop/wiki-db-password' };

function render(
  parameters: Record<string, unknown>,
  extra: { compose?: string; secrets?: Record<string, string>; coerceStrings?: boolean } = {},
) {
  return renderCompose({
    manifest: manifest(),
    compose: extra.compose ?? COMPOSE_YAML,
    parameters,
    secrets: extra.secrets ?? SECRETS,
    coerceStrings: extra.coerceStrings,
  });
}

function rendered(parameters: Record<string, unknown>, extra = {}) {
  const result = render(parameters, extra);

  if (!result.ok) throw new Error(result.errors.join('\n'));

  return { ...result.value, tree: parse(result.value.compose) };
}

describe('resolveParameters', () => {
  it('applies defaults and keeps given values', () => {
    expect(resolveParameters(manifest(), { hostname: 'wiki.example.com', port: 9000 })).toEqual({
      ok: true,
      value: {
        hostname: 'wiki.example.com',
        port: 9000,
        debug: false,
        bundlePostgres: true,
        dbHost: 'postgres',
        plan: 'small',
      },
    });
  });

  it('treats null as not given', () => {
    const result = resolveParameters(manifest(), { hostname: 'h', port: null });

    expect(result.ok && result.value['port']).toBe(8080);
  });

  it('refuses unknown, missing required and mistyped values', () => {
    const result = resolveParameters(manifest(), { port: '80', debug: 'yes', plan: 'huge', extra: 1 });

    expect(!result.ok && result.errors).toEqual(
      expect.arrayContaining([
        'unknown parameter extra',
        'parameter hostname is required',
        expect.stringMatching(/^parameter port: /),
        expect.stringMatching(/^parameter debug: /),
        expect.stringMatching(/^parameter plan: /),
      ]),
    );
  });

  it('checks bounds and patterns', () => {
    const result = resolveParameters(manifest(), { hostname: 'Bad Host!', port: 70000 });

    expect(!result.ok && result.errors).toHaveLength(2);
    expect(resolveParameters(manifest(), { hostname: 'h', port: 1.5 }).ok).toBe(false);
  });

  it('coerces strings when asked', () => {
    const result = resolveParameters(
      manifest(),
      { hostname: 'h', port: '9000', debug: 'true' },
      { coerceStrings: true },
    );

    expect(result.ok && result.value).toMatchObject({ port: 9000, debug: true });
    expect(resolveParameters(manifest(), { hostname: 'h', port: 'x' }, { coerceStrings: true }).ok).toBe(false);
    expect(resolveParameters(manifest(), { hostname: 'h', debug: 'maybe' }, { coerceStrings: true }).ok).toBe(false);
  });
});

describe('findPlaceholders', () => {
  it('classifies placeholders and skips $$', () => {
    expect(findPlaceholders('a ${x} $${y} ${secret:db} $HOME ${X:-d} $$ ${}')).toEqual([
      { kind: 'parameter', name: 'x', raw: '${x}' },
      { kind: 'secret', name: 'db', raw: '${secret:db}' },
      { kind: 'invalid', raw: '$HOME' },
      { kind: 'invalid', raw: '${X:-d}' },
      { kind: 'invalid', raw: '${}' },
    ]);
  });
});

describe('renderCompose', () => {
  it('substitutes parameters with their types and secret references', () => {
    const { tree, parameters, removedServices } = rendered({ hostname: 'wiki.example.com' });
    const env = tree.services.web.environment;

    expect(env).toMatchObject({ HOSTNAME: 'wiki.example.com', PORT: 8080, DEBUG: false, DB_HOST: 'postgres' });
    expect(env.DB_URL).toBe('postgres://wiki@postgres:5432/wiki');
    expect(env.PRICE).toBe('$$5');
    expect(tree.secrets['db-password']['x-loadweaver-ref']).toBe('secret://shop/wiki-db-password');
    expect(parameters['port']).toBe(8080);
    expect(removedServices).toEqual([]);
  });

  it('keeps quoted single placeholders as strings', () => {
    const { tree } = rendered(
      { hostname: 'h' },
      { compose: 'services:\n  web:\n    environment:\n      PORT: "${port}"\n' },
    );

    expect(tree.services.web.environment.PORT).toBe('8080');
  });

  it('removes a bundled dependency switched off, with its volumes and depends_on', () => {
    const { tree, removedServices } = rendered({ hostname: 'h', bundlePostgres: false, dbHost: 'db.internal' });

    expect(Object.keys(tree.services)).toEqual(['web']);
    expect(tree.services.web.depends_on).toBeUndefined();
    expect(tree.volumes).toEqual({});
    expect(tree.services.web.environment.DB_HOST).toBe('db.internal');
    expect(removedServices).toEqual(['postgres']);
  });

  it('cleans long-form depends_on', () => {
    const compose = COMPOSE_YAML.replace(
      'depends_on: [postgres]',
      'depends_on:\n      postgres:\n        condition: service_healthy\n      cache: {}',
    );
    const { tree } = rendered({ hostname: 'h', bundlePostgres: false }, { compose });

    expect(tree.services.web.depends_on).toEqual({ cache: {} });
  });

  it('cannot inject structure through values and escapes $', () => {
    const { tree } = rendered({ hostname: 'h', dbHost: 'x\nprivileged: true\n$HOME ${port}' });

    expect(tree.services.web.privileged).toBeUndefined();
    expect(tree.services.web.environment.DB_HOST).toBe('x\nprivileged: true\n$$HOME $${port}');
  });

  it('refuses missing / unknown secrets and invalid references', () => {
    expect(!render({ hostname: 'h' }, { secrets: {} }).ok).toBe(true);

    const result = render({ hostname: 'h' }, { secrets: { 'db-password': 'plaintext', other: 'secret://a/b' } });

    expect(!result.ok && result.errors).toEqual([
      'secret db-password: plaintext is not a secret reference (secret://<project>/<name>[@<version>])',
      'unknown secret other',
    ]);
  });

  describe('conditional secrets', () => {
    // A secret needed only with the large plan, mounted through an anchored list (as packages share them).
    const compose = `x-secrets: &secrets
  - db-password
  - { source: large-key, target: LARGE_KEY }
services:
  web:
    image: x
    secrets: *secrets
  worker:
    image: x
    secrets: [large-key]
secrets:
  db-password:
    x-loadweaver-ref: \${secret:db-password}
  large-key:
    x-loadweaver-ref: \${secret:large-key}
`;
    const conditional = () => {
      const m = manifest();

      m.secrets.push({ name: 'large-key', description: 'Key', requiredWhen: { parameter: 'plan', equals: 'large' } });

      return m;
    };
    const run = (parameters: Record<string, unknown>, secrets: Record<string, string>, text = compose) =>
      renderCompose({ manifest: conditional(), compose: text, parameters: { hostname: 'h', ...parameters }, secrets });

    it('leaves an unset secret whose condition is off out of the compose', () => {
      const result = run({}, SECRETS);

      expect(result.ok).toBe(true);

      if (!result.ok) return;

      const tree = parse(result.value.compose);

      expect(result.value.omittedSecrets).toEqual(['large-key']);
      expect(Object.keys(tree.secrets)).toEqual(['db-password']);
      expect(tree.services.web.secrets).toEqual(['db-password']);
      expect(tree.services.worker.secrets).toBeUndefined();
      expect(result.value.compose).not.toContain('large-key');
    });

    it('requires the secret while its condition holds', () => {
      const result = run({ plan: 'large' }, SECRETS);

      expect(!result.ok && result.errors).toEqual([
        'secret large-key needs a secret reference (required while plan is "large")',
      ]);
    });

    it('wires a given reference while the condition holds', () => {
      const result = run({ plan: 'large' }, { ...SECRETS, 'large-key': 'secret://shop/large' });

      expect(result.ok).toBe(true);

      if (!result.ok) return;

      const tree = parse(result.value.compose);

      expect(result.value.omittedSecrets).toEqual([]);
      expect(tree.secrets['large-key']['x-loadweaver-ref']).toBe('secret://shop/large');
      expect(tree.services.web.secrets).toEqual(['db-password', { source: 'large-key', target: 'LARGE_KEY' }]);
      expect(tree.services.worker.secrets).toEqual(['large-key']);
    });

    it('drops a given reference while the condition is off, exactly as if none was given', () => {
      const given = run({ plan: 'small' }, { ...SECRETS, 'large-key': 'secret://shop/large' });
      const unset = run({ plan: 'small' }, SECRETS);

      expect(given.ok && unset.ok).toBe(true);

      if (!given.ok || !unset.ok) return;

      const tree = parse(given.value.compose);

      expect(given.value.omittedSecrets).toEqual(['large-key']);
      expect(given.value.compose).toBe(unset.value.compose);
      expect(Object.keys(tree.secrets)).toEqual(['db-password']);
      expect(tree.services.web.secrets).toEqual(['db-password']);
      expect(tree.services.worker.secrets).toBeUndefined();
      expect(given.value.compose).not.toContain('secret://shop/large');
    });

    it('does not check the format of a dropped reference', () => {
      expect(run({}, { ...SECRETS, 'large-key': 'plaintext' }).ok).toBe(true);
    });

    it('refuses a conditional secret that is off used outside the secrets section, given or not', () => {
      for (const secrets of [SECRETS, { ...SECRETS, 'large-key': 'secret://shop/large' }]) {
        const result = run({}, secrets, `${compose}x-other:\n  token: \${secret:large-key}\n`);

        expect(!result.ok && result.errors).toEqual([
          '${secret:large-key}: secret large-key is left out (its condition is off); conditional secrets belong in the top-level secrets section only',
        ]);
      }
    });
  });

  it('refuses undeclared references, unsupported forms and placeholders in keys', () => {
    const compose = `services:
  web:
    image: x
    environment:
      A: \${nope}
      B: \${secret:other}
      C: $HOME
      \${hostname}: x
`;
    const result = render({ hostname: 'h' }, { compose });

    expect(!result.ok && result.errors).toEqual([
      '${nope}: parameter nope is not declared in the manifest',
      '${secret:other}: secret other is not declared in the manifest',
      'unsupported placeholder $HOME (use ${parameter}, ${secret:name} or $$ for a literal $)',
      'placeholders are not allowed in keys: ${hostname}',
    ]);
  });

  it('refuses a referenced optional parameter without a value', () => {
    const m = manifest();

    m.parameters.properties['optional'] = { type: 'string' };

    const result = renderCompose({
      manifest: m,
      compose: 'services:\n  a:\n    command: ${optional}\n',
      parameters: { hostname: 'h' },
      secrets: SECRETS,
    });

    expect(!result.ok && result.errors).toEqual(['${optional}: parameter optional has no value and no default']);
  });

  it('reports parameter errors and invalid YAML', () => {
    expect(!render({}).ok && (render({}) as { errors: string[] }).errors).toEqual(['parameter hostname is required']);
    expect((render({ hostname: 'h' }, { compose: 'a: [' }) as { errors: string[] }).errors[0]).toMatch(
      /not valid YAML/,
    );
    expect((render({ hostname: 'h' }, { compose: '- a' }) as { errors: string[] }).errors).toEqual([
      'compose.yaml must be a map',
    ]);
  });

  it('coerces CLI strings', () => {
    expect(rendered({ hostname: 'h', port: '81' }, { coerceStrings: true }).tree.services.web.environment.PORT).toBe(
      81,
    );
  });
});

describe('findUnpinnedImages', () => {
  it('lists services whose image is not pinned by digest', () => {
    const compose = `services:
  a:
    image: nginx@${DIGEST_A}
  b:
    image: nginx:1.27
  c:
    image: nginx@sha256:short
  d:
    build: .
`;

    expect(findUnpinnedImages(compose)).toEqual([
      { service: 'b', image: 'nginx:1.27' },
      { service: 'c', image: 'nginx@sha256:short' },
      { service: 'd', image: '' },
    ]);
    expect(findUnpinnedImages(COMPOSE_YAML)).toEqual([]);
    expect(() => findUnpinnedImages('nope')).toThrow(/must be a map/);
  });
});
