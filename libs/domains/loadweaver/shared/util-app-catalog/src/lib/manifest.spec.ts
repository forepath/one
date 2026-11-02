import { parse } from 'yaml';

import { MANIFEST_YAML } from './__fixtures__/fixtures';
import { checkMinLoadweaver, compareVersions, isUnknownLoadweaverVersion } from './common';
import { parseManifest, secretRequired } from './manifest';

function withChanges(change: (m: Record<string, unknown>) => void): Record<string, unknown> {
  const raw = parse(MANIFEST_YAML) as Record<string, unknown>;

  change(raw);

  return raw;
}

function errorsOf(source: unknown): string[] {
  const result = parseManifest(source);

  if (result.ok) throw new Error('expected errors');

  return result.errors;
}

describe('parseManifest', () => {
  it('parses a manifest from YAML text and applies defaults', () => {
    const result = parseManifest(MANIFEST_YAML);

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.name).toBe('wiki');
    expect(result.value.parameters.properties['port']).toMatchObject({ type: 'integer', default: 8080, minimum: 1 });
    expect(result.value.parameters.required).toEqual(['hostname']);
    expect(result.value.suggestions).toEqual({ groups: [], policies: [], ingress: [], dns: [] });
    expect(result.value.backups).toEqual([]);
    expect(result.value.exceptions).toEqual([]);
    expect(result.value.migrations[0].steps[0].phase).toBe('before');
  });

  it('accepts bytes and parsed objects', () => {
    expect(parseManifest(Buffer.from(MANIFEST_YAML)).ok).toBe(true);
    expect(parseManifest(parse(MANIFEST_YAML)).ok).toBe(true);
  });

  it('defaults channels and parameters for a minimal manifest', () => {
    const result = parseManifest(
      withChanges((m) => {
        delete m['channels'];
        delete m['parameters'];
        delete m['dependencies'];
        delete m['secrets'];
      }),
    );

    expect(result.ok && result.value.channels).toEqual(['stable']);
    expect(result.ok && result.value.parameters).toEqual({ type: 'object', properties: {}, required: [] });
  });

  it('reports readable, located errors', () => {
    const errors = errorsOf(
      withChanges((m) => {
        m['version'] = 'v1';
        m['homepage'] = 'ftp://example.com';
        m['unknownKey'] = 1;
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^version: must be a semantic version/),
        expect.stringMatching(/^homepage: /),
        expect.stringMatching(/unknownKey/),
      ]),
    );
  });

  it('accepts conditional secrets on a boolean or with a value the parameter allows', () => {
    const result = parseManifest(
      withChanges((m) => {
        m['secrets'] = [
          { name: 'debug-token', description: 'Debug token', requiredWhen: { parameter: 'debug' } },
          { name: 'large-key', description: 'Large plan key', requiredWhen: { parameter: 'plan', equals: 'large' } },
          { name: 'port-key', description: 'Port key', requiredWhen: { parameter: 'port', equals: 443 } },
        ];
      }),
    );

    expect(result.ok && result.value.secrets.map((s) => s.requiredWhen)).toEqual([
      { parameter: 'debug' },
      { parameter: 'plan', equals: 'large' },
      { parameter: 'port', equals: 443 },
    ]);
  });

  it('refuses conditions on unknown parameters, non-booleans without equals and values the schema refuses', () => {
    const secret = (requiredWhen: unknown) => ({ name: 's', description: 'S', requiredWhen });

    expect(errorsOf(withChanges((m) => (m['secrets'] = [secret({ parameter: 'nope' })])))).toEqual([
      'secrets[0].requiredWhen.parameter: unknown parameter nope',
    ]);
    expect(errorsOf(withChanges((m) => (m['secrets'] = [secret({ parameter: 'plan' })])))[0]).toMatch(
      /^secrets\[0\]\.requiredWhen\.parameter: plan is a string parameter: name the value with equals/,
    );
    expect(errorsOf(withChanges((m) => (m['secrets'] = [secret({ parameter: 'plan', equals: 'huge' })])))[0]).toMatch(
      /^secrets\[0\]\.requiredWhen\.equals: "huge" is not a value of plan/,
    );
    expect(errorsOf(withChanges((m) => (m['secrets'] = [secret({ parameter: 'debug', equals: 'yes' })])))[0]).toMatch(
      /^secrets\[0\]\.requiredWhen\.equals: "yes" is not a value of debug/,
    );
    expect(errorsOf(withChanges((m) => (m['secrets'] = [secret({ parameter: 'debug', other: 1 })])))[0]).toMatch(
      /requiredWhen/,
    );
  });

  it('decides whether a secret is needed from the parameter values', () => {
    expect(secretRequired({}, {})).toBe(true);
    expect(secretRequired({ requiredWhen: { parameter: 'debug' } }, { debug: true })).toBe(true);
    expect(secretRequired({ requiredWhen: { parameter: 'debug' } }, { debug: false })).toBe(false);
    expect(secretRequired({ requiredWhen: { parameter: 'debug' } }, {})).toBe(false);
    expect(secretRequired({ requiredWhen: { parameter: 'plan', equals: 'large' } }, { plan: 'large' })).toBe(true);
    expect(secretRequired({ requiredWhen: { parameter: 'plan', equals: 'large' } }, { plan: 'small' })).toBe(false);
  });

  it('refuses a wrong apiVersion', () => {
    expect(errorsOf(withChanges((m) => (m['apiVersion'] = 'apps.loadweaver.com/v2')))[0]).toMatch(/^apiVersion/);
  });

  it('checks parameters: names, types, required names and defaults', () => {
    const errors = errorsOf(
      withChanges((m) => {
        const parameters = m['parameters'] as { properties: Record<string, unknown>; required: string[] };

        parameters.properties['bad-name'] = { type: 'string' };
        parameters.properties['port'] = { type: 'integer', default: 70000, maximum: 65535 };
        parameters.required.push('missing');
      }),
    );

    expect(errors).toContain('parameters.properties.bad-name: parameter names are [A-Za-z_][A-Za-z0-9_]* (max. 64)');
    expect(
      errorsOf(
        withChanges(
          (m) => ((m['parameters'] as { properties: Record<string, unknown> }).properties['list'] = { type: 'array' }),
        ),
      )[0],
    ).toMatch(/^parameters\.properties\.list\.type: /);
    expect(errors).toContain('parameters.required[1]: unknown parameter missing');
    expect(errors.join('\n')).toMatch(/parameters\.properties\.port\.default: default does not match/);
  });

  it('checks dependencies against parameters', () => {
    const errors = errorsOf(
      withChanges((m) => {
        m['dependencies'] = [
          { name: 'postgres', bundled: { parameter: 'dbHost', services: ['postgres'] } },
          { name: 'redis', provided: { parameters: ['redisHost'] } },
          { name: 'empty' },
        ];
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'dependencies[0].bundled.parameter: dbHost must be a boolean parameter',
        'dependencies[1].provided.parameters[0]: unknown parameter redisHost',
        'dependencies[2]: a dependency is bundled, provided or both',
      ]),
    );
  });

  it('refuses duplicates', () => {
    const errors = errorsOf(
      withChanges((m) => {
        m['secrets'] = [
          { name: 'a', description: 'x' },
          { name: 'a', description: 'y' },
        ];
        m['channels'] = ['stable', 'stable'];
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining(['secrets[1]: duplicate secret a', 'channels[1]: duplicate channel stable']),
    );
  });

  it('requires a reason for exceptions', () => {
    const errors = errorsOf(withChanges((m) => (m['exceptions'] = [{ rule: 'privileged', reason: 'x' }])));

    expect(errors[0]).toMatch(/^exceptions\[0\]\.reason/);
  });

  it('reports invalid and empty YAML', () => {
    expect(errorsOf('a: [')[0]).toMatch(/^manifest.yaml is not valid YAML/);
    expect(errorsOf('')).toEqual(['manifest.yaml is empty']);
    expect(errorsOf('a: 1\na: 2')[0]).toMatch(/not valid YAML/);
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.10.0', '1.9.0', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0-alpha', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-rc.1', '1.0.0-beta.11', 1],
    ['1.0.0+build.1', '1.0.0+build.2', 0],
  ])('%s vs %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('throws on invalid versions', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/invalid semantic version: 1.0/);
  });
});

describe('checkMinLoadweaver', () => {
  it('refuses older clusters and admits equal / newer ones', () => {
    expect(checkMinLoadweaver('4.2.0', '4.1.9')).toEqual({
      ok: false,
      reason: 'needs Loadweaver 4.2.0 or newer; this cluster runs 4.1.9',
    });
    expect(checkMinLoadweaver('4.2.0', '4.2.0-rc.1').ok).toBe(false);
    expect(checkMinLoadweaver('4.2.0', '4.2.0')).toEqual({ ok: true });
    expect(checkMinLoadweaver('4.2.0', 'v5.0.0')).toEqual({ ok: true });
    expect(checkMinLoadweaver(undefined, '1.0.0')).toEqual({ ok: true });
  });

  it('allows unknown and development versions with a warning', () => {
    for (const version of [null, '', '0.0.0', '0.0.0-dev', '4.3.0-dev.2', 'latest']) {
      expect(isUnknownLoadweaverVersion(version)).toBe(true);

      const check = checkMinLoadweaver('9.0.0', version);

      expect(check.ok).toBe(true);
      expect(check.ok && check.warning).toContain('development build');
    }

    expect(isUnknownLoadweaverVersion('4.2.0-rc.1')).toBe(false);
  });
});
