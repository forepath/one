import { checkJsonSchema, hasOwnKey, type JsonSchema } from './json-schema';

const name = { type: 'string', minLength: 1, maxLength: 63, pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' };

/** Shaped like the published `Policy` schema (zod's draft 2020-12 output). */
const policy: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    apiVersion: { type: 'string', const: 'loadweaver.com/v1' },
    kind: { type: 'string', const: 'Policy' },
    metadata: {
      type: 'object',
      properties: {
        name,
        project: name,
        labels: {
          type: 'object',
          propertyNames: { type: 'string', pattern: '^[a-z]+$' },
          additionalProperties: { type: 'string', maxLength: 5 },
        },
      },
      required: ['name'],
    },
    spec: {
      type: 'object',
      properties: {
        mode: { default: 'enforce', type: 'string', enum: ['enforce', 'monitor'] },
        from: {
          minItems: 1,
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: { group: name, project: name },
                required: ['group'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { builtin: { type: 'string', enum: ['internet', 'cluster'] } },
                required: ['builtin'],
                additionalProperties: false,
              },
            ],
          },
        },
        rules: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            properties: {
              ports: {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'integer', minimum: 1, maximum: 65535 },
                    { type: 'string', pattern: '^\\d{1,5}-\\d{1,5}$' },
                  ],
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['from'],
      additionalProperties: false,
    },
  },
  required: ['apiVersion', 'kind', 'metadata', 'spec'],
  additionalProperties: false,
};

const valid = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Policy',
  metadata: { name: 'allow-web', project: 'shop', labels: { team: 'a' } },
  spec: { from: [{ group: 'web' }, { builtin: 'internet' }], rules: [{ ports: [443, '8000-8100'] }] },
};

describe('checkJsonSchema', () => {
  it('accepts a valid document', () => {
    expect(checkJsonSchema(policy, valid)).toEqual([]);
  });

  it('reports required, const, unknown properties, enum, pattern and lengths by path', () => {
    const issues = checkJsonSchema(policy, {
      apiVersion: 'v2',
      kind: 'Policy',
      metadata: { name: 'Bad_Name', labels: { Team: 'toolong' } },
      spec: { mode: 'audit', extra: true },
      status: {},
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        { path: ['apiVersion'], message: 'must be "loadweaver.com/v1"' },
        { path: ['metadata', 'name'], message: 'must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' },
        { path: ['metadata', 'labels', 'Team'], message: 'invalid name "Team": must match ^[a-z]+$' },
        { path: ['metadata', 'labels', 'Team'], message: 'must be at most 5 characters' },
        { path: ['spec'], message: 'missing property "from"' },
        { path: ['spec', 'mode'], message: 'must be one of "enforce", "monitor"' },
        { path: ['spec', 'extra'], message: 'unknown property "extra"' },
        { path: ['status'], message: 'unknown property "status"' },
      ]),
    );
    expect(issues).toHaveLength(8);
  });

  it('reports types, array bounds and empty strings', () => {
    expect(
      checkJsonSchema(policy, {
        ...valid,
        metadata: { name: '' },
        spec: { from: [], rules: [{}, {}, {}] },
      }),
    ).toEqual([
      { path: ['metadata', 'name'], message: 'must not be empty' },
      { path: ['metadata', 'name'], message: 'must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' },
      { path: ['spec', 'from'], message: 'needs at least one entry' },
      { path: ['spec', 'rules'], message: 'allows at most 2 entries' },
    ]);
    expect(checkJsonSchema(policy, { ...valid, spec: { from: 'web' } })).toEqual([
      { path: ['spec', 'from'], message: 'must be array, not string' },
    ]);
  });

  it('reports the closest anyOf branch, or that none matches', () => {
    const at = (from: unknown[], rules: unknown[] = []) => checkJsonSchema(policy, { ...valid, spec: { from, rules } });

    expect(at([{ group: 'Web' }])).toEqual([
      { path: ['spec', 'from', 0, 'group'], message: 'must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' },
    ]);
    expect(at([{ builtin: 'moon' }])).toEqual([
      { path: ['spec', 'from', 0, 'builtin'], message: 'must be one of "internet", "cluster"' },
    ]);
    expect(at([{ grop: 'web' }])).toEqual([
      { path: ['spec', 'from', 0], message: 'matches none of the allowed forms' },
    ]);
    expect(at([{ group: 'web' }], [{ ports: [70000, 'abc'] }])).toEqual([
      { path: ['spec', 'rules', 0, 'ports', 0], message: 'must be at most 65535' },
      { path: ['spec', 'rules', 0, 'ports', 1], message: 'must match ^\\d{1,5}-\\d{1,5}$' },
    ]);
  });

  it('supports oneOf, not, if/then/else, prefixItems, uniqueItems, number bounds and local $refs', () => {
    const schema: JsonSchema = {
      $defs: { port: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 } },
      type: 'object',
      properties: {
        port: { $ref: '#/$defs/port' },
        pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false },
        tags: { type: 'array', uniqueItems: true },
        either: { oneOf: [{ type: 'string' }, { type: 'string', maxLength: 3 }] },
        notNull: { not: { type: 'null' } },
        ratio: { type: 'number', multipleOf: 0.5, minimum: 0 },
      },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['port'] },
    };

    expect(
      checkJsonSchema(schema, {
        kind: 'a',
        pair: ['x', 'y', 3],
        tags: ['a', 'a'],
        either: 'ab',
        notNull: null,
        ratio: 0.3,
      }),
    ).toEqual([
      { path: ['pair', 1], message: 'must be number, not string' },
      { path: ['pair', 2], message: 'is not allowed' },
      { path: ['tags', 1], message: 'is a duplicate' },
      { path: ['either'], message: 'matches more than one of the allowed forms' },
      { path: ['notNull'], message: 'matches a form that is not allowed' },
      { path: ['ratio'], message: 'must be a multiple of 0.5' },
      { path: [], message: 'missing property "port"' },
    ]);
    expect(checkJsonSchema(schema, { port: 10 })).toEqual([{ path: ['port'], message: 'must be less than 10' }]);
    expect(checkJsonSchema(schema, { port: 1.5 })).toEqual([
      { path: ['port'], message: 'must be integer, not number' },
    ]);
    expect(checkJsonSchema(false, 1)).toEqual([{ path: [], message: 'is not allowed' }]);
    expect(checkJsonSchema(true, 1)).toEqual([]);
  });

  it('ignores invalid patterns instead of failing', () => {
    expect(checkJsonSchema({ type: 'string', pattern: '([' }, 'x')).toEqual([]);
    expect(checkJsonSchema({ type: 'string', pattern: '^\\P{Cc}+$' }, 'a\u0007')).toHaveLength(1);
  });

  it('only matches own properties (constructor, toString, __proto__)', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name', 'toString'],
      additionalProperties: false,
    };
    const value = JSON.parse('{"name":"x","constructor":1,"__proto__":2,"toString":3}') as Record<string, unknown>;

    expect(checkJsonSchema(schema, value)).toEqual([
      { path: ['constructor'], message: 'unknown property "constructor"' },
      { path: ['__proto__'], message: 'unknown property "__proto__"' },
      { path: ['toString'], message: 'unknown property "toString"' },
    ]);
    expect(checkJsonSchema(schema, { name: 'x' })).toEqual([{ path: [], message: 'missing property "toString"' }]);
    expect(checkJsonSchema({ $ref: '#/constructor' }, 1)).toEqual([]);
    expect(hasOwnKey({ a: 1 }, 'a')).toBe(true);
    expect(hasOwnKey({}, 'constructor')).toBe(false);
  });
});
