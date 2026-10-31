/** A JSON Schema (draft 2020-12). */
export type JsonSchema = boolean | JsonSchemaObject;

export interface JsonSchemaObject {
  [keyword: string]: unknown;
}

/** A schema violation, located by its path in the document (e.g. `['spec', 'from', 0, 'group']`). */
export interface JsonSchemaIssue {
  path: (string | number)[];
  message: string;
}

type Path = (string | number)[];

/**
 * A small JSON Schema (draft 2020-12) checker for the subset the published resource schemas use: `type`, `const`,
 * `enum`, string length / `pattern`, number bounds, `items` / `prefixItems` / `minItems` / `maxItems` /
 * `uniqueItems`, `properties` / `required` / `additionalProperties` / `patternProperties` / `propertyNames`,
 * `allOf`, `anyOf` / `oneOf` (best effort: the closest branch's issues), `not`, `if` / `then` / `else` and local
 * `$ref`s. `format` and unknown keywords are ignored. The server validates again when the plan is created.
 */
export function checkJsonSchema(schema: JsonSchema, value: unknown): JsonSchemaIssue[] {
  return check(schema, value, [], schema);
}

const patternCache = new Map<string, RegExp | null>();

function regex(pattern: string): RegExp | null {
  if (!patternCache.has(pattern)) {
    let compiled: RegExp | null = null;

    try {
      compiled = new RegExp(pattern, 'u');
    } catch {
      try {
        compiled = new RegExp(pattern);
      } catch {
        compiled = null;
      }
    }

    patternCache.set(pattern, compiled);
  }

  return patternCache.get(pattern) ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';

  if (Array.isArray(value)) return 'array';

  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';

  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);

  return actual === type || (type === 'number' && actual === 'integer');
}

/**
 * An own property (`Object.hasOwn`): `in` and plain indexing also see the prototype, so keys like `constructor`,
 * `toString` or `__proto__` in a document would match inherited members.
 */
export function hasOwnKey(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));

  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);

    return keys.length === Object.keys(b).length && keys.every((k) => hasOwnKey(b, k) && deepEqual(a[k], b[k]));
  }

  return false;
}

function show(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

/** Resolves `#/...` JSON pointers against the root schema. */
function resolveRef(root: JsonSchema, ref: string): JsonSchema | null {
  if (!ref.startsWith('#')) return null;

  let node: unknown = root;

  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const part = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');

    if (!isObject(node) || !hasOwnKey(node, part)) return null;

    node = node[part];
  }

  return typeof node === 'boolean' || isObject(node) ? (node as JsonSchema) : null;
}

function schemas(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? (value.filter((s) => typeof s === 'boolean' || isObject(s)) as JsonSchema[]) : [];
}

/** The schema a `$ref` points to (one level), else the schema itself. */
function target(schema: JsonSchema, root: JsonSchema): JsonSchema {
  return isObject(schema) && typeof schema['$ref'] === 'string' ? (resolveRef(root, schema['$ref']) ?? schema) : schema;
}

function typeFits(schema: JsonSchema, value: unknown): boolean {
  if (!isObject(schema)) return schema;

  const type = schema['type'];
  const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');

  return types.length === 0 || types.some((t) => matchesType(value, t));
}

function requiredPresent(schema: JsonSchema, value: Record<string, unknown>): boolean {
  return (
    isObject(schema) &&
    Array.isArray(schema['required']) &&
    schema['required'].length > 0 &&
    schema['required'].every((key) => typeof key === 'string' && hasOwnKey(value, key))
  );
}

/**
 * The issues of the intended branch of a failed `anyOf` / `oneOf`: among the branches of the value's type (and,
 * for objects, those whose required properties are all there) the one with the fewest issues; null when that is
 * ambiguous.
 */
function closestBranch(branches: JsonSchema[], value: unknown, path: Path, root: JsonSchema): JsonSchemaIssue[] | null {
  let candidates = branches.filter((branch) => typeFits(target(branch, root), value));

  if (candidates.length === 0) candidates = branches;

  if (isObject(value)) {
    const complete = candidates.filter((branch) => requiredPresent(target(branch, root), value));

    if (complete.length > 0) candidates = complete;
  }

  const results = candidates.map((branch) => check(branch, value, path, root)).sort((a, b) => a.length - b.length);

  return results.length === 1 || (results.length > 1 && results[0].length < results[1].length) ? results[0] : null;
}

function check(schema: JsonSchema, value: unknown, path: Path, root: JsonSchema): JsonSchemaIssue[] {
  if (schema === true) return [];

  if (schema === false) return [{ path, message: 'is not allowed' }];

  const s = schema as JsonSchemaObject;
  const issues: JsonSchemaIssue[] = [];

  if (typeof s['$ref'] === 'string') {
    const target = resolveRef(root, s['$ref']);

    if (target !== null) issues.push(...check(target, value, path, root));
  }

  const type = s['type'];

  if (typeof type === 'string' || Array.isArray(type)) {
    const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');

    if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
      return [...issues, { path, message: `must be ${types.join(' or ')}, not ${typeOf(value)}` }];
    }
  }

  if (hasOwnKey(s, 'const') && !deepEqual(value, s['const'])) {
    issues.push({ path, message: `must be ${show(s['const'])}` });
  }

  if (Array.isArray(s['enum']) && !s['enum'].some((option) => deepEqual(value, option))) {
    issues.push({ path, message: `must be one of ${s['enum'].map(show).join(', ')}` });
  }

  if (typeof value === 'string') issues.push(...checkString(s, value, path));

  if (typeof value === 'number') issues.push(...checkNumber(s, value, path));

  if (Array.isArray(value)) issues.push(...checkArray(s, value, path, root));

  if (isObject(value)) issues.push(...checkObject(s, value, path, root));

  for (const sub of schemas(s['allOf'])) issues.push(...check(sub, value, path, root));

  const anyOf = schemas(s['anyOf']);

  if (anyOf.length > 0 && !anyOf.some((sub) => check(sub, value, path, root).length === 0)) {
    issues.push(
      ...(closestBranch(anyOf, value, path, root) ?? [{ path, message: 'matches none of the allowed forms' }]),
    );
  }

  const oneOf = schemas(s['oneOf']);

  if (oneOf.length > 0) {
    const passing = oneOf.filter((sub) => check(sub, value, path, root).length === 0).length;

    if (passing === 0) {
      issues.push(
        ...(closestBranch(oneOf, value, path, root) ?? [{ path, message: 'matches none of the allowed forms' }]),
      );
    } else if (passing > 1) {
      issues.push({ path, message: 'matches more than one of the allowed forms' });
    }
  }

  if (
    (typeof s['not'] === 'boolean' || isObject(s['not'])) &&
    check(s['not'] as JsonSchema, value, path, root).length === 0
  ) {
    issues.push({ path, message: 'matches a form that is not allowed' });
  }

  if (typeof s['if'] === 'boolean' || isObject(s['if'])) {
    const branch = check(s['if'] as JsonSchema, value, path, root).length === 0 ? s['then'] : s['else'];

    if (typeof branch === 'boolean' || isObject(branch)) issues.push(...check(branch as JsonSchema, value, path, root));
  }

  return issues;
}

function checkString(s: JsonSchemaObject, value: string, path: Path): JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];
  const length = [...value].length;

  if (typeof s['minLength'] === 'number' && length < s['minLength']) {
    issues.push({
      path,
      message: s['minLength'] === 1 ? 'must not be empty' : `must be at least ${s['minLength']} characters`,
    });
  }

  if (typeof s['maxLength'] === 'number' && length > s['maxLength']) {
    issues.push({ path, message: `must be at most ${s['maxLength']} characters` });
  }

  if (typeof s['pattern'] === 'string') {
    const pattern = regex(s['pattern']);

    if (pattern && !pattern.test(value)) issues.push({ path, message: `must match ${s['pattern']}` });
  }

  return issues;
}

function checkNumber(s: JsonSchemaObject, value: number, path: Path): JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];

  if (typeof s['minimum'] === 'number' && value < s['minimum']) {
    issues.push({ path, message: `must be at least ${s['minimum']}` });
  }

  if (typeof s['maximum'] === 'number' && value > s['maximum']) {
    issues.push({ path, message: `must be at most ${s['maximum']}` });
  }

  if (typeof s['exclusiveMinimum'] === 'number' && value <= s['exclusiveMinimum']) {
    issues.push({ path, message: `must be greater than ${s['exclusiveMinimum']}` });
  }

  if (typeof s['exclusiveMaximum'] === 'number' && value >= s['exclusiveMaximum']) {
    issues.push({ path, message: `must be less than ${s['exclusiveMaximum']}` });
  }

  if (typeof s['multipleOf'] === 'number' && s['multipleOf'] > 0) {
    const ratio = value / s['multipleOf'];

    if (Math.abs(ratio - Math.round(ratio)) > 1e-9)
      issues.push({ path, message: `must be a multiple of ${s['multipleOf']}` });
  }

  return issues;
}

function checkArray(s: JsonSchemaObject, value: unknown[], path: Path, root: JsonSchema): JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];

  if (typeof s['minItems'] === 'number' && value.length < s['minItems']) {
    issues.push({
      path,
      message: s['minItems'] === 1 ? 'needs at least one entry' : `needs at least ${s['minItems']} entries`,
    });
  }

  if (typeof s['maxItems'] === 'number' && value.length > s['maxItems']) {
    issues.push({ path, message: `allows at most ${s['maxItems']} entries` });
  }

  // Draft 2020-12 `prefixItems` + `items`; an `items` array is the older tuple form.
  const prefix = Array.isArray(s['prefixItems'])
    ? schemas(s['prefixItems'])
    : Array.isArray(s['items'])
      ? schemas(s['items'])
      : [];
  const rest = Array.isArray(s['items']) ? undefined : s['items'];

  value.forEach((item, index) => {
    const itemSchema = index < prefix.length ? prefix[index] : rest;

    if (typeof itemSchema === 'boolean' || isObject(itemSchema)) {
      issues.push(...check(itemSchema as JsonSchema, item, [...path, index], root));
    }
  });

  if (s['uniqueItems'] === true) {
    value.forEach((item, index) => {
      if (value.findIndex((other) => deepEqual(other, item)) < index) {
        issues.push({ path: [...path, index], message: 'is a duplicate' });
      }
    });
  }

  return issues;
}

function checkObject(
  s: JsonSchemaObject,
  value: Record<string, unknown>,
  path: Path,
  root: JsonSchema,
): JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];
  const properties = isObject(s['properties']) ? s['properties'] : {};
  const patternProperties = isObject(s['patternProperties']) ? s['patternProperties'] : {};

  if (Array.isArray(s['required'])) {
    for (const key of s['required']) {
      if (typeof key === 'string' && !hasOwnKey(value, key))
        issues.push({ path, message: `missing property "${key}"` });
    }
  }

  const keys = Object.keys(value);

  if (typeof s['minProperties'] === 'number' && keys.length < s['minProperties']) {
    issues.push({ path, message: `needs at least ${s['minProperties']} properties` });
  }

  if (typeof s['maxProperties'] === 'number' && keys.length > s['maxProperties']) {
    issues.push({ path, message: `allows at most ${s['maxProperties']} properties` });
  }

  for (const key of keys) {
    const keyPath = [...path, key];
    let known = false;

    if (hasOwnKey(properties, key)) {
      known = true;
      issues.push(...check(properties[key] as JsonSchema, value[key], keyPath, root));
    }

    for (const [pattern, sub] of Object.entries(patternProperties)) {
      if (regex(pattern)?.test(key)) {
        known = true;
        issues.push(...check(sub as JsonSchema, value[key], keyPath, root));
      }
    }

    if (typeof s['propertyNames'] === 'boolean' || isObject(s['propertyNames'])) {
      for (const issue of check(s['propertyNames'] as JsonSchema, key, keyPath, root)) {
        issues.push({ path: keyPath, message: `invalid name "${key}": ${issue.message}` });
      }
    }

    if (!known) {
      const additional = s['additionalProperties'];

      if (additional === false) {
        issues.push({ path: keyPath, message: `unknown property "${key}"` });
      } else if (isObject(additional)) {
        issues.push(...check(additional as JsonSchema, value[key], keyPath, root));
      }
    }
  }

  return issues;
}
