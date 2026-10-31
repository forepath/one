import { RESOURCE_KIND_NAMES, resourceJsonSchema } from '@forepath/loadweaver/shared/util-model';
import { resourceTemplate } from '@forepath/loadweaver/frontend/data-access-console';
import { parse } from 'yaml';

import { CREATE_KINDS } from '../nav/create-kinds';
import { hasTypedSteps, wizardSteps } from './create-wizard';
import {
  asNode,
  enumOptions,
  fieldKind,
  fieldLabel,
  fillRequired,
  formSpec,
  initialValue,
  properties,
  readableIssue,
  readablePath,
  readableValue,
  type SchemaNode,
  specKeys,
  specSchema,
  summarize,
  variantIndex,
  variantsOf,
  withFormSpec,
  withProperty,
  sectionSeed,
} from './schema-form';
import { SCHEMA_ENUM_LABELS, SCHEMA_FIELD_LABELS, SCHEMA_KIND_LABELS } from './schema-form-labels';

/** Every node of a spec schema with its property path (unions: every branch). */
function nodes(schema: SchemaNode, path: string[] = []): { path: string[]; key: string; schema: SchemaNode }[] {
  const key = path.at(-1) ?? '';
  const out = [{ path, key, schema }];
  const kind = fieldKind(schema, key);

  if (kind === 'object') {
    for (const [k, child] of Object.entries(properties(schema))) out.push(...nodes(child, [...path, k]));
  } else if (kind === 'variants') {
    for (const v of variantsOf(schema)) {
      for (const [k, child] of Object.entries(properties(v.schema))) out.push(...nodes(child, [...path, k]));
    }
  } else if (kind === 'list') {
    out.push(
      ...nodes(asNode(schema['items']), path)
        .slice(0)
        .map((n) => ({ ...n, key: n.key || key })),
    );
  } else if (kind === 'map') {
    out.push(...nodes(asNode(schema['additionalProperties']), path));
  }

  return out;
}

/** A value for every field of a schema node (lists get one row, maps one entry, unions their branch `variant`). */
function sample(schema: SchemaNode, key = '', variant = 0): unknown {
  const kind = fieldKind(schema, key);

  switch (kind) {
    case 'object':
      return Object.fromEntries(Object.entries(properties(schema)).map(([k, child]) => [k, sample(child, k, variant)]));
    case 'variants': {
      const branches = variantsOf(schema);

      return sample(branches[variant % branches.length].schema, key, variant);
    }
    case 'list':
      return [sample(asNode(schema['items']), key, variant)];
    case 'multiEnum':
      return enumOptions(asNode(schema['items'])).slice(0, 2);
    case 'map':
      return { app: sample(asNode(schema['additionalProperties']), 'value') };
    case 'tuple':
      return (schema['prefixItems'] as unknown[]).map((p) => (asNode(p)['minimum'] as number) ?? 1);
    case 'enum':
      return enumOptions(schema).at(-1);
    case 'boolean':
      return true;
    case 'number':
      return typeof schema['minimum'] === 'number' ? (schema['minimum'] as number) + 1 : 7;
    case 'decimal':
      return '0.5';
    case 'quantity':
      return fieldKind(schema) === 'quantity' && schema['type'] === 'string' ? '2g' : '8Gi';
    case 'duration':
      return '10m';
    case 'time':
      return '08:30';
    case 'portRange':
      return '8000-8100';
    case 'textarea':
      return 'line one\nline two';
    case 'code':
      return 'services:\n  web:\n    image: nginx:1.27\n';
    default:
      return `${key || 'value'}-1`;
  }
}

const KINDS = RESOURCE_KIND_NAMES.map((kind) => ({ kind, spec: specSchema(resourceJsonSchema(kind))! }));
/** A raw schema path / key: brackets, `a.b`, or a camelCase property name as the label. */
const RAW_PATH = /[[\]]|\w\.\w|^[a-z]+[A-Z][a-z]+[A-Za-z]*$/;
/** Enum values shown as they are (record types, HTTP methods, algorithms). */
const VERBATIM = /^([A-Z]+|hmac-sha\d+)$/;

describe('generated resource form: coverage of every published kind (2026-10-29)', () => {
  it.each(KINDS)('$kind: every field can be edited in the form (no YAML-only field)', ({ spec }) => {
    const unsupported = nodes(spec).filter((n) => fieldKind(n.schema, n.key) === 'unsupported');

    expect(unsupported.map((n) => n.path.join('.'))).toEqual([]);
  });

  it.each(KINDS)('$kind: every field and option has a readable, translated label', ({ kind, spec }) => {
    for (const n of nodes(spec)) {
      if (n.key) expect([n.path.join('.'), SCHEMA_FIELD_LABELS[n.key] ?? null]).not.toEqual([n.path.join('.'), null]);

      for (const option of enumOptions(fieldKind(n.schema) === 'multiEnum' ? asNode(n.schema['items']) : n.schema)) {
        const text = String(option);

        if (!VERBATIM.test(text) && typeof option === 'string' && !text.startsWith('/')) {
          expect([text, SCHEMA_ENUM_LABELS[text] ?? null]).not.toEqual([text, null]);
        }
      }
    }

    expect(SCHEMA_KIND_LABELS[kind]).toBeTruthy();
  });

  it.each(KINDS)('$kind: every top-level field belongs to a wizard step', ({ kind, spec }) => {
    const steps = wizardSteps(kind, specKeys(spec));
    const keys = steps.flatMap((s) => s.keys);

    expect([...keys].sort()).toEqual([...specKeys(spec)].sort());
    expect(steps[0].id).toBe('general');
    expect(steps.at(-1)?.id).toBe('review');
    // No empty typed steps.
    expect(steps.slice(1, -1).every((s) => s.keys.length > 0)).toBe(true);
    expect(hasTypedSteps(kind)).toBe(true);
  });

  it.each(KINDS)(
    '$kind: a full form state builds the YAML, and the YAML builds the same form state',
    ({ kind, spec }) => {
      const template = resourceTemplate(kind, 'shop');

      for (const variant of [0, 1, 2, 3, 4, 5, 6]) {
        const state = sample(spec, '', variant);
        const yaml = withFormSpec(template, state);

        expect(formSpec(yaml)).toEqual(state);
        // Idempotent: writing the same state again changes nothing.
        expect(withFormSpec(yaml, state)).toBe(yaml);
        // The envelope stays.
        expect((parse(yaml) as { kind: string }).kind).toBe(kind);
      }
    },
  );

  it.each(KINDS)('$kind: new documents get the required fields; the review reads like prose', ({ kind, spec }) => {
    const filled = fillRequired(spec, formSpec(resourceTemplate(kind, 'shop')));

    // Required fields with a start value (defaults, first options, minimums, lists) are there; texts stay empty.
    for (const key of (spec['required'] as string[] | undefined) ?? []) {
      if (initialValue(properties(spec)[key], key) !== undefined) expect(filled).toHaveProperty(key);
    }

    const state = sample(spec);
    const rows = summarize(spec, state, specKeys(spec), kind);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.label).not.toMatch(RAW_PATH);
      expect(row.label).not.toMatch(/^spec/);
    }
  });
});

describe('generated resource form: values, YAML patching, words', () => {
  const vm = specSchema(resourceJsonSchema('VirtualMachine'))!;

  it('patches only what changed (comments elsewhere stay) and removes emptied optional fields', () => {
    const text = [
      'apiVersion: loadweaver.com/v1',
      'kind: VirtualMachine',
      'metadata:',
      '  name: vm',
      'spec:',
      '  # the boot image',
      '  image: registry.lw/shop/debian:13',
      '  memory: 4Gi',
      '  disks:',
      '    - name: root # boot',
      '      size: 20Gi',
      '',
    ].join('\n');
    const spec = formSpec(text) as Record<string, unknown>;
    const next = { ...spec, memory: '8Gi', disks: [{ name: 'root', size: '40Gi' }] };
    const out = withFormSpec(text, next);

    expect(out).toContain('# the boot image');
    expect(out).toContain('name: root # boot');
    expect(out).toContain('memory: 8Gi');
    expect(out).toContain('size: 40Gi');

    expect(withProperty({ a: 1, b: [] }, 'b', [], false)).toEqual({ a: 1 });
    expect(withProperty({ a: 1 }, 'b', {}, true)).toEqual({ a: 1, b: {} });
    expect(withProperty({ a: 1 }, 'a', false, false)).toEqual({ a: false });
  });

  it('classifies quantities, durations, times, port ranges, unions and enum lists', () => {
    expect(fieldKind(properties(vm)['memory'], 'memory')).toBe('quantity');
    expect(fieldKind(properties(vm)['disks'], 'disks')).toBe('list');
    expect(fieldKind(properties(vm)['firmware'], 'firmware')).toBe('enum');
    expect(fieldKind(properties(vm)['cloudInit'], 'cloudInit')).toBe('object');

    const alert = specSchema(resourceJsonSchema('AlertRule'))!;

    expect(fieldKind(properties(alert)['condition'])).toBe('variants');
    expect(fieldKind(properties(alert)['repeatEvery'])).toBe('duration');
    expect(variantsOf(properties(alert)['condition']).map((v) => v.label)).toEqual([
      'Metric',
      'Metric missing',
      'Logs',
    ]);
    expect(variantIndex(properties(alert)['condition'], { logs: { op: '>', threshold: 1 } })).toBe(2);

    const target = specSchema(resourceJsonSchema('BackupTarget'))!;

    expect(fieldKind(target)).toBe('variants');
    expect(variantsOf(target).map((v) => v.label)).toEqual(['S3 object storage', 'SFTP server']);
    expect(variantIndex(target, { type: 'sftp' })).toBe(1);
    // Required fields: the discriminant; texts start unset (shown as "Required"), defaults show as placeholders.
    expect(initialValue(variantsOf(target)[1].schema)).toEqual({ type: 'sftp' });

    const window = specSchema(resourceJsonSchema('MaintenanceWindow'))!;

    expect(fieldKind(properties(window)['start'], 'start')).toBe('time');
    expect(fieldKind(properties(window)['days'], 'days')).toBe('multiEnum');
  });

  it('says where and what in words, with units and option labels', () => {
    expect(readablePath(['disks', 0, 'size'])).toBe('Disk 1 › Size');
    expect(readablePath(['nics', 1])).toBe('Interface 2');
    expect(fieldLabel(['days'], 'MaintenanceWindow')).toBe('Weekdays');
    expect(readableIssue(['spec', 'disks', 0], 'missing property "size"')).toBe('Disk 1 › Size: Required');
    expect(readableIssue(['spec', 'cpu', 'vcpus'], 'must be at most 64')).toBe('CPU › vCPUs: At most 64');
    expect(readableIssue(['spec', 'nics'], 'needs at least one entry')).toBe(
      'Network interfaces: Add at least one entry',
    );
    expect(readableValue(properties(vm)['memory'], '4Gi', 'memory')).toBe('4 GiB');
    expect(readableValue(properties(vm)['runStrategy'], 'Always', 'runStrategy')).toBe('Always running');
    expect(readableValue({ type: 'integer' }, 30, 'intervalSeconds')).toBe('30 s');
    expect(readableValue({ type: 'boolean' }, true)).toBe('Yes');

    const rows = summarize(vm, { cpu: { vcpus: 2 }, disks: [{ name: 'root', size: '20Gi', source: 'image' }] }, [
      'cpu',
      'disks',
    ]);

    expect(rows).toEqual([
      { label: 'CPU', value: null, depth: 0 },
      { label: 'vCPUs', value: '2 vCPUs', depth: 1 },
      { label: 'Disks', value: null, depth: 0 },
      { label: 'Disk 1 · root', value: null, depth: 1 },
      { label: 'Name', value: 'root', depth: 2 },
      { label: 'Size', value: '20 GiB', depth: 2 },
      { label: 'Source', value: 'From the image', depth: 2 },
    ]);
  });

  it('offers only published kinds in Create ▾', () => {
    expect(CREATE_KINDS.filter((k) => k.kind).every((k) => RESOURCE_KIND_NAMES.includes(k.kind as never))).toBe(true);
  });
  it('starts numbers at their minimum, but leaves signed ranges (latitude / longitude) empty (2026-10-29)', () => {
    expect(initialValue({ type: 'integer', minimum: 1, maximum: 65535 })).toBe(1);
    expect(initialValue({ type: 'number', minimum: -90, maximum: 90 })).toBeUndefined();

    const location = {
      type: 'object',
      required: ['latitude', 'longitude'],
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
      },
    };

    // Opening the optional location block no longer invents a place at the South Pole.
    expect(initialValue(location)).toEqual({});
  });
  it('seeds a switched-on optional section with its required keys so it stays in the document (2026-10-29)', () => {
    const remoteAccess = {
      type: 'object',
      required: ['nodeGroup', 'endpoint'],
      properties: {
        nodeGroup: { type: 'string' },
        endpoint: { type: 'string' },
        port: { type: 'integer', default: 51800 },
      },
    };

    expect(initialValue(remoteAccess)).toEqual({});
    expect(sectionSeed(remoteAccess)).toEqual({ nodeGroup: '', endpoint: '' });
    expect(withProperty({}, 'remoteAccess', sectionSeed(remoteAccess), false)).toEqual({
      remoteAccess: { nodeGroup: '', endpoint: '' },
    });
    expect(sectionSeed({ type: 'boolean' })).toBe(false);
  });
});
