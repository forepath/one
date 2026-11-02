import { checkJsonSchema } from '@forepath/loadweaver/shared/util-json-schema';
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document } from 'yaml';

import { type ParseResult } from './common';
import {
  PARAMETER_NAME_PATTERN,
  secretRequired,
  type AppManifest,
  type ParameterValue,
  type SecretCondition,
} from './manifest';

/** A Loadweaver secret reference (`secret://<project>/<name>[@<version>]`). */
export const SECRET_REFERENCE_PATTERN = /^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/;

/** A placeholder found in compose text. */
export type Placeholder =
  | { kind: 'parameter'; name: string; raw: string }
  | { kind: 'secret'; name: string; raw: string }
  | { kind: 'invalid'; raw: string };

const PLACEHOLDER = /\$(?:\$|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * Placeholders in a string: `${name}` (parameter), `${secret:name}` (secret reference). `$$` is compose's escape
 * for a literal `$` and is skipped; any other `${…}` / `$NAME` form is `invalid` (packages are self-contained: no
 * environment interpolation, no inline defaults).
 */
export function findPlaceholders(text: string): Placeholder[] {
  const found: Placeholder[] = [];

  for (const match of text.matchAll(PLACEHOLDER)) {
    const [raw, braced, bare] = match;

    if (raw === '$$') continue;

    if (bare !== undefined || braced === undefined) {
      found.push({ kind: 'invalid', raw });
      continue;
    }

    if (braced.startsWith('secret:')) found.push({ kind: 'secret', name: braced.slice(7), raw });
    else if (PARAMETER_NAME_PATTERN.test(braced)) found.push({ kind: 'parameter', name: braced, raw });
    else found.push({ kind: 'invalid', raw });
  }

  return found;
}

function coerce(value: string, type: string): unknown {
  const text = value.trim();

  if (type === 'boolean') return text === 'true' ? true : text === 'false' ? false : value;

  if ((type === 'integer' || type === 'number') && text !== '' && Number.isFinite(Number(text))) return Number(text);

  return value;
}

/**
 * Resolves install parameters against the manifest's parameter schema: applies defaults, refuses unknown names and
 * missing required ones, type-checks every value (JSON Schema: type, enum, bounds, pattern, …). `coerceStrings`
 * converts string input (CLI `--set`, form fields) to the declared number / boolean type first. `null` counts as
 * not given. Optional parameters without a value or default are left out.
 */
export function resolveParameters(
  manifest: Pick<AppManifest, 'parameters'>,
  values: Record<string, unknown> = {},
  options: { coerceStrings?: boolean } = {},
): ParseResult<Record<string, ParameterValue>> {
  const { properties, required } = manifest.parameters;
  const errors: string[] = [];
  const resolved: Record<string, ParameterValue> = {};

  for (const name of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) errors.push(`unknown parameter ${name}`);
  }

  for (const [name, schema] of Object.entries(properties)) {
    let value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;

    if (value === null || value === undefined) value = schema.default;

    if (value === undefined) {
      if (required.includes(name)) errors.push(`parameter ${name} is required`);

      continue;
    }

    if (options.coerceStrings && typeof value === 'string' && schema.type !== 'string')
      value = coerce(value, schema.type);

    const issues = checkJsonSchema(schema, value);

    if (issues.length > 0) {
      errors.push(...issues.map((i) => `parameter ${name}: ${i.message}`));
      continue;
    }

    resolved[name] = value as ParameterValue;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: resolved };
}

export interface RenderComposeInput {
  manifest: Pick<AppManifest, 'parameters' | 'secrets' | 'dependencies'>;
  /** `compose.yaml` text from the package. */
  compose: string;
  /** Install parameters (resolved with `resolveParameters`). */
  parameters?: Record<string, unknown>;
  /**
   * Manifest secret name → secret reference (`secret://<project>/<name>[@<version>]`): every declared secret, except
   * conditional ones (`requiredWhen`) whose condition is off (a reference given for those is ignored).
   */
  secrets?: Record<string, string>;
  coerceStrings?: boolean;
}

export interface RenderedCompose {
  /** The compose to deploy (plain compose + `x-loadweaver`; `$$` escapes kept for the compose parser). */
  compose: string;
  parameters: Record<string, ParameterValue>;
  /** Services removed because their bundled dependency is switched off. */
  removedServices: string[];
  /** Conditional secrets left out: their condition is off (whether or not a reference was given). */
  omittedSecrets: string[];
}

function escapeDollars(value: string): string {
  return value.replace(/\$/g, '$$$$');
}

/** The secret name a service's `secrets` entry refers to (`- name` or `- { source: name, … }`). */
function secretEntrySource(item: unknown): string | null {
  if (isScalar(item)) return String(item.value);

  if (isMap(item)) {
    const source = item.get('source');

    return typeof source === 'string' ? source : null;
  }

  return null;
}

/**
 * Leaves conditional secrets that are off out of the compose: the top-level `secrets` entries that refer to
 * them (`${secret:name}`) and every service's mounts of those entries (anchored / aliased lists included), so the
 * deployment never references a secret that doesn't exist.
 */
function removeSecrets(doc: Document, names: ReadonlySet<string>): void {
  const top = doc.get('secrets', true);
  const entries = new Set<string>();

  if (isMap(top)) {
    for (const pair of [...top.items]) {
      const strings: string[] = [];

      if (!isNode(pair.value)) continue;

      visit(pair.value, {
        Scalar(_, node) {
          if (typeof node.value === 'string') strings.push(node.value);
        },
      });

      if (strings.flatMap(findPlaceholders).some((p) => p.kind === 'secret' && names.has(p.name))) {
        entries.add(String(isScalar(pair.key) ? pair.key.value : pair.key));
        top.delete(pair.key);
      }
    }

    if (top.items.length === 0) doc.delete('secrets');
  }

  if (entries.size === 0) return;

  const services = doc.get('services', true);

  if (!isMap(services)) return;

  for (const pair of services.items) {
    if (!isMap(pair.value)) continue;

    const node = pair.value.get('secrets', true);
    const list = isAlias(node) ? node.resolve(doc) : node;

    if (!isSeq(list)) continue;

    list.items = list.items.filter((item) => {
      const source = secretEntrySource(isAlias(item) ? item.resolve(doc) : item);

      return source === null || !entries.has(source);
    });
  }

  for (const pair of services.items) {
    if (!isMap(pair.value)) continue;

    const node = pair.value.get('secrets', true);
    const list = isAlias(node) ? node.resolve(doc) : node;

    if (isSeq(list) && list.items.length === 0) pair.value.delete('secrets');
  }
}

function removeBundled(doc: Document, services: string[], volumes: string[]): void {
  for (const name of services) doc.deleteIn(['services', name]);

  for (const name of volumes) doc.deleteIn(['volumes', name]);

  const remaining = doc.getIn(['services']);

  if (!isMap(remaining)) return;

  for (const pair of remaining.items) {
    const service = pair.value;

    if (!isMap(service)) continue;

    const dependsOn = service.get('depends_on', true);

    if (isSeq(dependsOn))
      dependsOn.items = dependsOn.items.filter((item) => !(isScalar(item) && services.includes(String(item.value))));
    else if (isMap(dependsOn))
      dependsOn.items = dependsOn.items.filter((p) => !(isScalar(p.key) && services.includes(String(p.key.value))));

    if ((isSeq(dependsOn) || isMap(dependsOn)) && dependsOn.items.length === 0) service.delete('depends_on');
  }
}

/**
 * Renders a package's compose for an install: resolves the parameters, removes the services (and volumes) of bundled
 * dependencies whose toggle is false, then substitutes `${param}` (a plain, unquoted scalar that is exactly one
 * placeholder takes the value's type) and `${secret:name}` (the secret reference). Works on the YAML tree, so values can never inject
 * structure; `$` in values is escaped as `$$`. Refuses unknown / missing parameters, undeclared or missing secrets,
 * other `$` forms and placeholders in keys.
 */
export function renderCompose(input: RenderComposeInput): ParseResult<RenderedCompose> {
  const resolved = resolveParameters(input.manifest, input.parameters, { coerceStrings: input.coerceStrings });
  const errors: string[] = resolved.ok === true ? [] : [...resolved.errors];
  const parameters = resolved.ok === true ? resolved.value : {};
  const secrets = input.secrets ?? {};
  const declaredSecrets = new Set(input.manifest.secrets.map((s) => s.name));
  // Conditional secrets whose condition is off are left out of the compose, even when a reference was given.
  const omitted = new Set(input.manifest.secrets.filter((s) => !secretRequired(s, parameters)).map((s) => s.name));

  for (const secret of input.manifest.secrets) {
    const name = secret.name;

    if (omitted.has(name)) continue;

    if (secrets[name] === undefined)
      errors.push(
        secret.requiredWhen
          ? `secret ${name} needs a secret reference (${secretConditionText(secret.requiredWhen)})`
          : `secret ${name} needs a secret reference`,
      );
    else if (!SECRET_REFERENCE_PATTERN.test(secrets[name]))
      errors.push(`secret ${name}: ${secrets[name]} is not a secret reference (secret://<project>/<name>[@<version>])`);
  }

  for (const name of Object.keys(secrets)) if (!declaredSecrets.has(name)) errors.push(`unknown secret ${name}`);

  if (errors.length > 0) return { ok: false, errors };

  const doc = parseDocument(input.compose);

  if (doc.errors.length > 0)
    return { ok: false, errors: doc.errors.map((e) => `compose.yaml is not valid YAML: ${e.message.split('\n')[0]}`) };

  if (!isMap(doc.contents)) return { ok: false, errors: ['compose.yaml must be a map'] };

  const removedServices: string[] = [];

  for (const dependency of input.manifest.dependencies) {
    if (!dependency.bundled || parameters[dependency.bundled.parameter] !== false) continue;

    removeBundled(doc, dependency.bundled.services, dependency.bundled.volumes);
    removedServices.push(...dependency.bundled.services);
  }

  if (omitted.size > 0) removeSecrets(doc, omitted);

  visit(doc, {
    Scalar(key, node) {
      if (typeof node.value !== 'string') return;

      const text = node.value;
      const placeholders = findPlaceholders(text);

      if (placeholders.length === 0) return;

      if (key === 'key') {
        errors.push(`placeholders are not allowed in keys: ${text}`);

        return;
      }

      const valueOf = (p: Placeholder): ParameterValue | undefined => {
        if (p.kind === 'invalid') {
          errors.push(`unsupported placeholder ${p.raw} (use \${parameter}, \${secret:name} or $$ for a literal $)`);

          return undefined;
        }

        if (p.kind === 'secret') {
          if (!declaredSecrets.has(p.name)) errors.push(`${p.raw}: secret ${p.name} is not declared in the manifest`);
          else if (omitted.has(p.name))
            errors.push(
              `${p.raw}: secret ${p.name} is left out (its condition is off); conditional secrets belong in the top-level secrets section only`,
            );

          return secrets[p.name];
        }

        if (!Object.prototype.hasOwnProperty.call(input.manifest.parameters.properties, p.name)) {
          errors.push(`${p.raw}: parameter ${p.name} is not declared in the manifest`);

          return undefined;
        }

        if (parameters[p.name] === undefined) errors.push(`${p.raw}: parameter ${p.name} has no value and no default`);

        return parameters[p.name];
      };

      if (placeholders.length === 1 && placeholders[0].raw === text) {
        const value = valueOf(placeholders[0]);

        // A plain scalar takes the value's type; a quoted one stays a string.
        if (value !== undefined)
          node.value =
            typeof value === 'string' || (node.type !== undefined && node.type !== 'PLAIN')
              ? escapeDollars(String(value))
              : value;

        return;
      }

      node.value = text.replace(PLACEHOLDER, (raw) => {
        if (raw === '$$') return raw;

        const [placeholder] = findPlaceholders(raw);
        const value = valueOf(placeholder);

        return value === undefined ? raw : escapeDollars(String(value));
      });
    },
  });

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  return {
    ok: true,
    value: { compose: doc.toString(), parameters, removedServices, omittedSecrets: [...omitted].sort() },
  };
}

/** `required while stripeEnabled is true` / `required while authMethod is "keycloak"`. */
export function secretConditionText(condition: SecretCondition): string {
  return `required while ${condition.parameter} is ${condition.equals === undefined ? 'true' : JSON.stringify(condition.equals)}`;
}
