import type { JsonSchema } from '@forepath/loadweaver/frontend/data-access-console';
import { isMap, isSeq, parse, parseDocument, type Document } from 'yaml';

import {
  SCHEMA_ENUM_LABELS,
  SCHEMA_FIELD_HINTS,
  SCHEMA_FIELD_LABELS,
  SCHEMA_FIELD_LABELS_AT,
  SCHEMA_ITEM_LABELS,
  SCHEMA_TEXT,
} from './schema-form-labels';

/**
 * The generated resource form (2026-10-29, "order-plan style, full form coverage"): every published resource schema
 * (zod → JSON Schema, `GET /schemas/{kind}`) is rendered from the schema itself — objects, lists of scalars and of
 * objects (nested), key / value maps, discriminated unions, tuples, enums, quantities with units, durations, times.
 * The form edits the parsed `spec` and writes back into the YAML text as a minimal patch (comments elsewhere stay).
 */

/** A JSON Schema node (the subset the resource schemas use). */
export type SchemaNode = Record<string, unknown>;

/** How a schema node is edited. */
export type SchemaFieldKind =
  | 'object'
  | 'variants'
  | 'list'
  | 'multiEnum'
  | 'map'
  | 'tuple'
  | 'text'
  | 'textarea'
  | 'code'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'enum'
  | 'quantity'
  | 'duration'
  | 'time'
  | 'portRange'
  | 'unsupported';

/** A value unit shown next to a number (translated). */
export type SchemaUnit = 'seconds' | 'minutes' | 'days' | 'vcpus' | 'cores' | 'checks' | 'backups';

/** A quantity unit choice: the suffix written into the YAML and its readable label. */
export interface QuantityUnit {
  suffix: string;
  label: string;
}

const DURATION = /^\^\\d\{1,6\}\(s\|m\|h\|d\)\$$/;
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const K8S_QUANTITY = '^(\\d+(?:\\.\\d+)?)\\s*([a-zA-Z]{0,2})$';
const DOCKER_QUANTITY = /^\^\\d\+\(\\\.\\d\+\)\?\[(kKmMgG|kKmMgGtT)\]\?\[bB\]\?\$$/;
const DECIMAL = '^\\d+(\\.\\d+)?$';
const RANGE = '^\\d{1,5}-\\d{1,5}$';
const TEXTAREA_KEYS = new Set(['description', 'userData', 'caCertificate', 'knownHosts', 'keys', 'sshAuthorizedKeys']);
const CODE_KEYS = new Set(['compose']);

export function asNode(schema: unknown): SchemaNode {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema) ? (schema as SchemaNode) : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function branches(schema: SchemaNode): SchemaNode[] {
  const list = (schema['anyOf'] ?? schema['oneOf']) as unknown[] | undefined;

  return Array.isArray(list) ? list.map(asNode) : [];
}

function types(schema: SchemaNode): string[] {
  const type = schema['type'];

  return (Array.isArray(type) ? type : type ? [type] : []).filter((t): t is string => t !== 'null');
}

export function properties(schema: SchemaNode): Record<string, SchemaNode> {
  const props = asNode(schema['properties']);

  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, asNode(v)]));
}

export function requiredKeys(schema: SchemaNode): string[] {
  return Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
}

/** The `spec` node of a kind's envelope schema. */
export function specSchema(schema: JsonSchema | null | undefined): SchemaNode | null {
  const root = asNode(schema);
  const spec = properties(root)['spec'];

  return spec && Object.keys(spec).length > 0 ? spec : null;
}

/** The top-level keys of the spec (a union at the root: the keys of every branch, in order). */
export function specKeys(spec: SchemaNode | null): string[] {
  if (!spec) return [];

  const own = Object.keys(properties(spec));

  if (own.length > 0) return own;

  return [...new Set(branches(spec).flatMap((b) => Object.keys(properties(b))))];
}

/** The const option values of a union of consts / an enum / a single const. */
export function enumOptions(schema: SchemaNode): (string | number)[] {
  if (Array.isArray(schema['enum'])) return schema['enum'] as (string | number)[];

  if (schema['const'] !== undefined) return [schema['const'] as string | number];

  const all = branches(schema);

  if (all.length > 0 && all.every((b) => b['const'] !== undefined))
    return all.map((b) => b['const'] as string | number);

  return [];
}

/** How the node at `key` is edited. */
export function fieldKind(schema: SchemaNode, key = ''): SchemaFieldKind {
  const unions = branches(schema);

  if (unions.length > 0) {
    if (unions.every((b) => b['const'] !== undefined)) return 'enum';

    const shapes = unions.map((b) => types(b)[0]);

    if (shapes.includes('integer') && unions.some((b) => b['pattern'] === K8S_QUANTITY)) return 'quantity';

    if (shapes.includes('integer') && unions.some((b) => b['pattern'] === RANGE)) return 'portRange';

    if (unions.every((b) => types(b)[0] === 'object' || b['properties'])) return 'variants';

    return 'unsupported';
  }

  if (Array.isArray(schema['enum']) || schema['const'] !== undefined) return 'enum';

  const type = types(schema)[0];

  switch (type) {
    case 'array': {
      if (Array.isArray(schema['prefixItems'])) return 'tuple';

      const items = asNode(schema['items']);

      return enumOptions(items).length > 0 && fieldKind(items) === 'enum' ? 'multiEnum' : 'list';
    }
    case 'object':
      return Object.keys(properties(schema)).length > 0 ? 'object' : 'map';
    case 'string': {
      const pattern = typeof schema['pattern'] === 'string' ? schema['pattern'] : '';

      if (CODE_KEYS.has(key)) return 'code';

      if (DURATION.test(pattern)) return 'duration';

      if (pattern === TIME) return 'time';

      if (pattern === DECIMAL) return 'decimal';

      if (DOCKER_QUANTITY.test(pattern)) return 'quantity';

      if (TEXTAREA_KEYS.has(key)) return 'textarea';

      return 'text';
    }
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return Object.keys(properties(schema)).length > 0 ? 'object' : 'unsupported';
  }
}

/** Quantity units: Kubernetes-style (Mi / Gi / Ti) or Docker-style (m / g / t), from the schema's pattern. */
export function quantityUnits(schema: SchemaNode): QuantityUnit[] {
  const docker = typeof schema['pattern'] === 'string' && DOCKER_QUANTITY.exec(schema['pattern'] as string);

  if (docker) {
    return [
      { suffix: 'm', label: 'MB' },
      { suffix: 'g', label: 'GB' },
      ...(docker[1].includes('tT') ? [{ suffix: 't', label: 'TB' }] : []),
    ];
  }

  return [
    { suffix: 'Mi', label: 'MiB' },
    { suffix: 'Gi', label: 'GiB' },
    { suffix: 'Ti', label: 'TiB' },
  ];
}

/** `"4Gi"` → `{ amount: '4', suffix: 'Gi' }` (a bare integer = bytes, suffix ''). */
export function splitQuantity(value: unknown): { amount: string; suffix: string } {
  if (typeof value === 'number') return { amount: String(value), suffix: '' };

  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]{0,2})$/.exec(String(value ?? '').trim());

  return match ? { amount: match[1], suffix: match[2] } : { amount: '', suffix: '' };
}

/** `"30m"` → `{ amount: '30', unit: 'm' }`. */
export function splitDuration(value: unknown): { amount: string; unit: 's' | 'm' | 'h' | 'd' } {
  const match = /^(\d{1,6})(s|m|h|d)$/.exec(String(value ?? ''));

  return match ? { amount: match[1], unit: match[2] as 's' | 'm' | 'h' | 'd' } : { amount: '', unit: 'm' };
}

/** The unit shown next to a number field (by its name). */
export function unitOf(key: string, kind: SchemaFieldKind): SchemaUnit | null {
  if (kind === 'decimal') return 'cores';

  if (kind !== 'number') return null;

  if (/Seconds$/.test(key) || key === 'ttl' || key === 'defaultTtl') return 'seconds';

  if (/Minutes$/.test(key)) return 'minutes';

  if (/Days$/.test(key) || key === 'days') return 'days';

  if (/[vV]cpus$/.test(key)) return 'vcpus';

  if (key === 'failAfter' || key === 'recoverAfter') return 'checks';

  if (key === 'keep') return 'backups';

  return null;
}

export function unitLabel(unit: SchemaUnit): string {
  return {
    seconds: SCHEMA_TEXT.unitSeconds,
    minutes: SCHEMA_TEXT.unitMinutes,
    days: SCHEMA_TEXT.unitDays,
    vcpus: SCHEMA_TEXT.unitVcpus,
    cores: SCHEMA_TEXT.unitCores,
    checks: SCHEMA_TEXT.unitChecks,
    backups: SCHEMA_TEXT.unitBackups,
  }[unit];
}

/** `camelCase` / `kebab-case` → "Camel case" (fallback when the table has no label). */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** The schema property names of a path (indices and union branches dropped): `['disks', 0, 'size']` → `disks.size`. */
export function namePath(path: readonly (string | number)[]): string {
  return path.filter((p): p is string => typeof p === 'string').join('.');
}

/** The readable label of the field at `path` (a kind-specific override, else by its name). */
export function fieldLabel(path: readonly (string | number)[], kind = ''): string {
  const names = path.filter((p): p is string => typeof p === 'string');
  const key = names.at(-1) ?? '';
  const at = SCHEMA_FIELD_LABELS_AT[`${kind}:${names.join('.')}`];

  return at ?? SCHEMA_FIELD_LABELS[key] ?? humanize(key);
}

/** The singular of a list's rows ("Disk"). */
export function itemNoun(listKey: string): string {
  return SCHEMA_ITEM_LABELS[listKey] ?? SCHEMA_TEXT.entry;
}

/** A readable option label of an enum value. */
export function enumLabel(value: unknown): string {
  const text = String(value);

  return Object.prototype.hasOwnProperty.call(SCHEMA_ENUM_LABELS, text) ? SCHEMA_ENUM_LABELS[text] : text;
}

/** Help under a field: a named hint, else one derived from the pattern / format. */
export function fieldHint(key: string, schema: SchemaNode): string | null {
  if (Object.prototype.hasOwnProperty.call(SCHEMA_FIELD_HINTS, key)) return SCHEMA_FIELD_HINTS[key];

  const pattern = typeof schema['pattern'] === 'string' ? (schema['pattern'] as string) : '';

  if (pattern.startsWith('^secret:')) return SCHEMA_TEXT.hintSecret;

  if (pattern.startsWith('^(@(yearly')) return SCHEMA_TEXT.hintCron;

  if (pattern === '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' || pattern === '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') {
    return SCHEMA_TEXT.hintDnsLabel;
  }

  if (pattern.startsWith('^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+') || pattern.startsWith('^(\\*\\.)?([a-z0-9]')) {
    return SCHEMA_TEXT.hintHostname;
  }

  if (schema['format'] === 'uuid') return SCHEMA_TEXT.hintUuid;

  if (schema['format'] === 'uri') return SCHEMA_TEXT.hintUrl;

  if (pattern.startsWith('^[a-z0-9-]{1,63}\\/[a-z0-9-]{1,63}\\/')) {
    return key === 'service' ? SCHEMA_TEXT.hintServiceRef : SCHEMA_TEXT.hintVolumeRef;
  }

  if (pattern === '^[a-z0-9-]{1,63}\\/[a-z0-9-]{1,63}$') return SCHEMA_TEXT.hintDeploymentRef;

  if (pattern.startsWith('^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\/')) return SCHEMA_TEXT.hintServiceRef;

  if (pattern.startsWith('^\\/')) return SCHEMA_TEXT.hintPath;

  return null;
}

/** The input type of a text field (email / url keyboards). */
export function inputTypeOf(schema: SchemaNode): 'text' | 'email' | 'url' {
  return schema['format'] === 'email' ? 'email' : schema['format'] === 'uri' ? 'url' : 'text';
}

// ---------------------------------------------------------------------------------------------------------------
// Unions

/** The property whose `const` tells the branches apart (`type: s3 | sftp`), if any. */
function discriminant(all: readonly SchemaNode[]): string | null {
  const first = all[0];

  if (!first) return null;

  for (const [key, prop] of Object.entries(properties(first))) {
    if (prop['const'] !== undefined && all.every((b) => properties(b)[key]?.['const'] !== undefined)) return key;
  }

  return null;
}

export interface SchemaVariant {
  index: number;
  label: string;
  schema: SchemaNode;
}

/** The branches of a union of objects with readable labels (the discriminant's value, else the defining key). */
export function variantsOf(schema: SchemaNode): SchemaVariant[] {
  const all = branches(schema);
  const key = discriminant(all);

  return all.map((branch, index) => {
    const own = key ? properties(branch)[key]['const'] : null;
    const defining = requiredKeys(branch)[0] ?? Object.keys(properties(branch))[0] ?? '';

    return { index, label: own !== null ? enumLabel(own) : fieldLabel([defining]), schema: branch };
  });
}

/** Which branch `value` is (discriminant match, else the first branch whose required keys are all present). */
export function variantIndex(schema: SchemaNode, value: unknown): number {
  const all = branches(schema);
  const key = discriminant(all);

  if (!isPlainObject(value)) return 0;

  if (key) {
    const found = all.findIndex((b) => properties(b)[key]['const'] === value[key]);

    return found >= 0 ? found : 0;
  }

  const full = all.findIndex((b) => {
    const required = requiredKeys(b);

    return required.length > 0 && required.every((k) => k in value);
  });

  if (full >= 0) return full;

  const scored = all.map((b) => Object.keys(properties(b)).filter((k) => k in value).length);
  const best = Math.max(...scored);

  return best > 0 ? scored.indexOf(best) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Values

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * A starting value for a schema node: its `default`, else (objects) its required properties filled the same way,
 * (lists) `minItems` new rows, (enums) the first option, (numbers) the minimum; texts stay unset (`undefined`).
 */
export function initialValue(schema: SchemaNode, key = ''): unknown {
  if (schema['default'] !== undefined) return clone(schema['default']);

  const kind = fieldKind(schema, key);

  switch (kind) {
    case 'object':
      return fillRequired(schema, {});
    case 'variants': {
      const first = variantsOf(schema)[0];

      return first ? variantSeed(first.schema, key) : {};
    }
    case 'list': {
      const min = typeof schema['minItems'] === 'number' ? (schema['minItems'] as number) : 0;

      // Rows of texts start empty (a row to type into), not as `null`.
      return Array.from({ length: min }, () => initialValue(asNode(schema['items']), key) ?? '');
    }
    case 'multiEnum': {
      const min = typeof schema['minItems'] === 'number' ? (schema['minItems'] as number) : 0;

      return enumOptions(asNode(schema['items'])).slice(0, min);
    }
    case 'map':
      return {};
    case 'tuple':
      return (schema['prefixItems'] as unknown[]).map((item) => initialValue(asNode(item)));
    case 'enum':
      return enumOptions(schema)[0];
    case 'boolean':
      return false;
    case 'number': {
      const min = schema['minimum'] ?? schema['exclusiveMinimum'];

      // A range below zero has no meaningful start (latitude / longitude: the minimum -90 / -180 invented a location at
      // the South Pole, 2026-10-29): such a field starts empty and is required until a value is entered.
      if (typeof min === 'number' && min < 0) return undefined;

      return typeof min === 'number' ? (schema['exclusiveMinimum'] !== undefined ? min + 1 : min) : 0;
    }
    case 'quantity':
      return types(schema)[0] === 'string' ? '1g' : '1Gi';
    case 'duration':
      return '5m';
    case 'portRange':
      return 443;
    default:
      // Texts start unset: the field shows "Required" until filled.
      return undefined;
  }
}

/**
 * The starting value of a union branch: its initial value with every required key present (an empty text where it
 * has no other start), so the branch stays recognisable before the user typed anything.
 */
export function variantSeed(branch: SchemaNode, key = ''): Record<string, unknown> {
  const value = initialValue(branch, key);
  const seed: Record<string, unknown> = isPlainObject(value) ? { ...value } : {};

  for (const k of requiredKeys(branch)) if (seed[k] === undefined) seed[k] = '';

  return seed;
}

/** The start of an optional section that is switched on: like a union branch's seed for objects, else its initial value. */
export function sectionSeed(schema: SchemaNode, key = ''): unknown {
  return fieldKind(schema, key) === 'object' ? variantSeed(schema, key) : initialValue(schema, key);
}

/** `value` with every missing required property of `schema` added (recursively into present objects). */
export function fillRequired(schema: SchemaNode, value: unknown): unknown {
  const kind = fieldKind(schema);

  if (kind === 'variants') {
    const variant = variantsOf(schema)[variantIndex(schema, value)];

    return variant ? fillRequired(variant.schema, isPlainObject(value) ? value : initialValue(variant.schema)) : value;
  }

  if (kind !== 'object' || !isPlainObject(value)) return value;

  const next: Record<string, unknown> = { ...value };

  for (const [key, child] of Object.entries(properties(schema))) {
    if (next[key] === undefined) {
      const initial = requiredKeys(schema).includes(key) ? initialValue(child, key) : undefined;

      if (initial !== undefined) next[key] = initial;
    } else if (isPlainObject(next[key])) {
      next[key] = fillRequired(child, next[key]);
    }
  }

  return next;
}

/** Whether a value counts as unset (removed from its parent when the field is optional). */
export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}

/**
 * `object` with `key` set to `value` — an empty value of an optional property removes it (so an emptied optional
 * section or list disappears from the YAML instead of leaving `{}` / `[]` behind).
 */
export function withProperty(object: unknown, key: string, value: unknown, required: boolean): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainObject(object) ? { ...object } : {};

  if (value === undefined || (!required && isEmptyValue(value))) delete next[key];
  else next[key] = value;

  return next;
}

/** The spec of a YAML resource document as plain data (null when the YAML doesn't parse). */
export function formSpec(text: string): unknown {
  try {
    const doc = parseDocument(text);

    if (doc.errors.length > 0) return null;

    const value = doc.toJS() as { spec?: unknown } | null;

    return isPlainObject(value) ? (value.spec ?? {}) : null;
  } catch {
    return null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Applies the difference `before` → `after` at `path` to `doc` node by node (untouched nodes keep their comments). */
function patch(doc: Document, path: (string | number)[], before: unknown, after: unknown): void {
  if (deepEqual(before, after)) return;

  if (after === undefined) {
    doc.deleteIn(path);

    return;
  }

  const node = path.length ? doc.getIn(path, true) : doc.contents;

  if (isPlainObject(before) && isPlainObject(after) && isMap(node)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      patch(doc, [...path, key], before[key], after[key]);
    }

    return;
  }

  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length && isSeq(node)) {
    after.forEach((item, index) => patch(doc, [...path, index], before[index], item));

    return;
  }

  doc.setIn(path, doc.createNode(after));
}

/** The YAML text with its spec changed from `before` to `after` (a minimal patch; the rest of the text stays). */
export function withFormSpec(text: string, after: unknown): string {
  const doc = parseDocument(text);

  if (doc.errors.length > 0) return text;

  const before = (doc.toJS() as { spec?: unknown } | null)?.spec;

  if (!isMap(doc.getIn(['spec'], true))) {
    doc.setIn(['spec'], doc.createNode(after ?? {}));

    return doc.toString({ lineWidth: 0 });
  }

  patch(doc, ['spec'], before, after);

  return doc.toString({ lineWidth: 0 });
}

/** The YAML text of a spec value (round-trip checks). */
export function specOf(text: string): unknown {
  return (parse(text) as { spec?: unknown } | null)?.spec;
}

// ---------------------------------------------------------------------------------------------------------------
// Readable paths and problems

/** The schema node at a document path below `spec` (null when the path leaves the schema). */
export function schemaAt(spec: SchemaNode, path: readonly (string | number)[], value?: unknown): SchemaNode | null {
  let node: SchemaNode | null = spec;
  let current: unknown = value;

  for (const part of path) {
    if (!node) return null;

    if (fieldKind(node) === 'variants') {
      node = variantsOf(node)[variantIndex(node, current)]?.schema ?? null;

      if (!node) return null;
    }

    if (typeof part === 'number') {
      node = Array.isArray(node['prefixItems'])
        ? asNode((node['prefixItems'] as unknown[])[part])
        : asNode(node['items']);
    } else {
      const props = properties(node);

      node = props[part] ?? (isPlainObject(node['additionalProperties']) ? asNode(node['additionalProperties']) : null);
    }

    current = isPlainObject(current) || Array.isArray(current) ? (current as Record<string, unknown>)[part] : undefined;
  }

  return node;
}

/** A readable location: `['disks', 0, 'size']` → "Disk 1 › Size"; `['nics', 1]` → "Interface 2". */
export function readablePath(path: readonly (string | number)[], kind = ''): string {
  const parts: string[] = [];

  path.forEach((part, index) => {
    if (typeof part === 'number') {
      const listKey = path[index - 1];

      parts.pop();
      parts.push(`${typeof listKey === 'string' ? itemNoun(listKey) : SCHEMA_TEXT.entry} ${part + 1}`);
    } else {
      parts.push(fieldLabel(path.slice(0, index + 1), kind));
    }
  });

  return parts.join(' › ');
}

/** A translated message of a schema checker issue. */
export function readableMessage(message: string): string {
  const n = (m: RegExpExecArray) => m[1];
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^missing property "([^"]+)"/, () => SCHEMA_TEXT.errRequired],
    [/^must not be empty$/, () => SCHEMA_TEXT.errRequired],
    [/^must match /, () => SCHEMA_TEXT.errFormat],
    [/^must be at least (\d+) characters$/, (m) => SCHEMA_TEXT.errMinLength.replace('{n}', n(m))],
    [/^must be at most (\d+) characters$/, (m) => SCHEMA_TEXT.errMaxLength.replace('{n}', n(m))],
    [/^must be at least (-?[\d.e+]+)$/, (m) => SCHEMA_TEXT.errMin.replace('{n}', n(m))],
    [/^must be at most (-?[\d.e+]+)$/, (m) => SCHEMA_TEXT.errMax.replace('{n}', n(m))],
    [/^must be greater than (-?[\d.e+]+)$/, (m) => SCHEMA_TEXT.errGreater.replace('{n}', n(m))],
    [/^must be less than (-?[\d.e+]+)$/, (m) => SCHEMA_TEXT.errLess.replace('{n}', n(m))],
    [/^needs at least one entry$/, () => SCHEMA_TEXT.errMinOne],
    [/^needs at least (\d+) entries$/, (m) => SCHEMA_TEXT.errMinItems.replace('{n}', n(m))],
    [/^allows at most (\d+) entries$/, (m) => SCHEMA_TEXT.errMaxItems.replace('{n}', n(m))],
    [/^is a duplicate$/, () => SCHEMA_TEXT.errDuplicate],
    [/^must be one of /, () => SCHEMA_TEXT.errOneOf],
    [/^must be .+, not /, () => SCHEMA_TEXT.errType],
    [/^matches none of the allowed forms$/, () => SCHEMA_TEXT.errForm],
    [/^unknown property "([^"]+)"/, (m) => SCHEMA_TEXT.errUnknown.replace('{n}', n(m))],
    [/^invalid name "([^"]+)"/, (m) => SCHEMA_TEXT.errInvalidKey.replace('{n}', n(m))],
    [/^must be (.+)$/, (m) => SCHEMA_TEXT.errConst.replace('{n}', enumLabel(n(m).replace(/^"|"$/g, '')))],
  ];

  for (const [pattern, text] of rules) {
    const match = pattern.exec(message);

    if (match) return text(match);
  }

  return message;
}

/** A checker issue as "Where: what" in the form's words (`missing property` points at the missing field). */
export function readableIssue(path: readonly (string | number)[], message: string, kind = ''): string {
  const missing = /^missing property "([^"]+)"/.exec(message);
  const at = missing ? [...path, missing[1]] : [...path];
  const where = readablePath(at[0] === 'spec' ? at.slice(1) : at, kind);

  return where ? `${where}: ${readableMessage(message)}` : readableMessage(message);
}

// ---------------------------------------------------------------------------------------------------------------
// Readable values (review summary)

/** A readable value of a leaf ("4 GiB", "30 s", "Yes", option labels). */
export function readableValue(schema: SchemaNode, value: unknown, key = ''): string {
  if (value === undefined || value === null || value === '') return SCHEMA_TEXT.notSet;

  const kind = fieldKind(schema, key);

  switch (kind) {
    case 'boolean':
      return value ? SCHEMA_TEXT.yes : SCHEMA_TEXT.no;
    case 'enum':
      return enumLabel(value);
    case 'multiEnum':
      return Array.isArray(value) ? value.map(enumLabel).join(', ') : String(value);
    case 'quantity': {
      const { amount, suffix } = splitQuantity(value);
      const unit = quantityUnits(schema).find((u) => u.suffix === suffix);

      return amount ? `${amount} ${unit?.label ?? (suffix || SCHEMA_TEXT.unitBytes)}` : String(value);
    }
    case 'duration': {
      const { amount, unit } = splitDuration(value);
      const units = {
        s: SCHEMA_TEXT.unitSeconds,
        m: SCHEMA_TEXT.unitMinutes,
        h: SCHEMA_TEXT.unitHours,
        d: SCHEMA_TEXT.unitDays,
      };

      return amount ? `${amount} ${units[unit]}` : String(value);
    }
    case 'number':
    case 'decimal': {
      const unit = unitOf(key, kind);

      return unit ? `${value} ${unitLabel(unit)}` : String(value);
    }
    case 'code':
      return composeSummary(String(value)) ?? String(value).split('\n')[0];
    case 'tuple':
      return Array.isArray(value) ? value.join(' – ') : String(value);
    case 'map':
      return isPlainObject(value)
        ? Object.entries(value)
            .map(([k, v]) => `${k} = ${v}`)
            .join(', ')
        : String(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** "2 service(s): web, db" of a compose file (null when it has no services mapping). */
export function composeSummary(compose: string): string | null {
  try {
    const services = (parse(compose) as { services?: unknown } | null)?.services;

    if (!isPlainObject(services)) return null;

    const names = Object.keys(services);

    return SCHEMA_TEXT.composeServices.replace('{n}', String(names.length)).replace('{list}', names.join(', '));
  } catch {
    return null;
  }
}

/** One line of the review summary: a heading (section / list row) or a label and its value. */
export interface SummaryRow {
  label: string;
  value: string | null;
  depth: number;
}

/** The readable summary of the spec fields `keys` (unset optional fields are left out). */
export function summarize(spec: SchemaNode, value: unknown, keys: readonly string[], kind = ''): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const walk = (schema: SchemaNode, current: unknown, path: (string | number)[], depth: number) => {
    const key = [...path].reverse().find((p): p is string => typeof p === 'string') ?? '';
    const fk = fieldKind(schema, key);
    const label = fieldLabel(path, kind);

    if (current === undefined || current === null || (current === '' && fk !== 'code')) return;

    if (fk === 'object' && isPlainObject(current)) {
      const heading = rows.length;

      Object.entries(properties(schema))
        .filter(([k]) => current[k] !== undefined)
        .forEach(([k, child]) => walk(child, current[k], [...path, k], depth + 1));

      // A section heading only when something below it is shown.
      if (rows.length > heading) rows.splice(heading, 0, { label, value: null, depth });

      return;
    }

    if (fk === 'variants' && isPlainObject(current)) {
      const variant = variantsOf(schema)[variantIndex(schema, current)];

      rows.push({ label: `${label}: ${variant?.label ?? ''}`, value: null, depth });

      if (variant) {
        Object.entries(properties(variant.schema))
          .filter(([k]) => current[k] !== undefined)
          .forEach(([k, child]) => {
            const ck = fieldKind(child, k);

            // The defining key of a one-key branch is the heading already: its fields follow directly.
            if ((ck === 'object' || ck === 'variants') && Object.keys(properties(variant.schema)).length === 1) {
              Object.entries(properties(child))
                .filter(([kk]) => (current[k] as Record<string, unknown>)?.[kk] !== undefined)
                .forEach(([kk, grand]) =>
                  walk(grand, (current[k] as Record<string, unknown>)[kk], [...path, k, kk], depth + 1),
                );
            } else {
              walk(child, current[k], [...path, k], depth + 1);
            }
          });
      }

      return;
    }

    if (fk === 'list' && Array.isArray(current)) {
      const items = asNode(schema['items']);
      const ik = fieldKind(items, key);

      if (current.length === 0) return;

      if (ik === 'object' || ik === 'variants' || ik === 'list') {
        rows.push({ label, value: null, depth });
        current.forEach((item, index) => {
          const title = `${itemNoun(key)} ${index + 1}${itemTitle(item) ? ' · ' + itemTitle(item) : ''}`;

          if (ik === 'object' && isPlainObject(item)) {
            rows.push({ label: title, value: null, depth: depth + 1 });
            Object.entries(properties(items))
              .filter(([k]) => item[k] !== undefined)
              .forEach(([k, child]) => walk(child, item[k], [...path, index, k], depth + 2));
          } else if (ik === 'variants') {
            const variant = variantsOf(items)[variantIndex(items, item)];
            const inner = variant ? summarize(variant.schema, item, Object.keys(properties(variant.schema)), kind) : [];

            rows.push({
              label: title,
              value: inner.length === 1 ? `${inner[0].label}: ${inner[0].value}` : (variant?.label ?? null),
              depth: depth + 1,
            });

            if (inner.length > 1) inner.forEach((r) => rows.push({ ...r, depth: r.depth + depth + 2 }));
          } else {
            rows.push({ label: title, value: readableValue(items, item, key), depth: depth + 1 });
          }
        });

        return;
      }

      rows.push({ label, value: current.map((item) => readableValue(items, item, key)).join(', '), depth });

      return;
    }

    if ((fk === 'map' || fk === 'multiEnum') && isEmptyValue(current)) return;

    rows.push({ label, value: readableValue(schema, current, key), depth });
  };

  const root = isPlainObject(value) ? value : {};

  if (fieldKind(spec) === 'variants') {
    const variant = variantsOf(spec)[variantIndex(spec, root)];

    if (!variant) return rows;

    for (const key of keys) {
      const child = properties(variant.schema)[key];

      if (child) walk(child, root[key], [key], 0);
    }

    return rows;
  }

  for (const key of keys) {
    const child = properties(spec)[key];

    if (child) walk(child, root[key], [key], 0);
  }

  return rows;
}

/** The title part of a list row: its name / title / host / … (first present string of those). */
export function itemTitle(item: unknown): string {
  if (typeof item === 'string' || typeof item === 'number') return '';

  if (!isPlainObject(item)) return '';

  for (const key of [
    'name',
    'title',
    'host',
    'id',
    'address',
    'group',
    'service',
    'builtin',
    'site',
    'cidr',
    'clients',
  ]) {
    const v = item[key];

    if (typeof v === 'string' && v) return key === 'builtin' ? enumLabel(v) : v;
  }

  for (const key of ['protocol', 'type']) {
    const v = item[key];

    if (typeof v === 'string' && v) return enumLabel(v);
  }

  return '';
}
