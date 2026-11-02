import { checkJsonSchema } from '@forepath/loadweaver/shared/util-json-schema';
import { z } from 'zod';

import { APP_NAME_PATTERN, APP_STORE_API_VERSION, parseWithSchema, SEMVER_PATTERN, type ParseResult } from './common';

/** Parameter names: usable as `${name}` in the compose. */
export const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Secret names: usable as `${secret:name}` in the compose; same rules as Loadweaver secret names. */
export const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Value types a parameter can have (they are substituted into the compose). */
export const PARAMETER_TYPES = ['string', 'integer', 'number', 'boolean'] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];
export type ParameterValue = string | number | boolean;

/** Policy-lint rules a manifest can declare an exception for (with a reason). */
export const EXCEPTION_RULES = ['host-network', 'privileged', 'host-pid', 'host-ipc', 'host-path'] as const;
export type ExceptionRule = (typeof EXCEPTION_RULES)[number];

const nameSchema = z.string().regex(APP_NAME_PATTERN, 'must be a DNS label (a-z, 0-9, -; max. 63)');
const semverSchema = z.string().regex(SEMVER_PATTERN, 'must be a semantic version (e.g. 1.2.3)');
const httpUrlSchema = z.url({ protocol: /^https?$/ });
const serviceNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'invalid service name');

/**
 * One parameter: a JSON Schema for a scalar (`type` required). Any other JSON Schema keyword (`title`,
 * `description`, `default`, `enum`, `minimum`, `pattern`, `format`, …) is kept and drives the install form.
 */
export const parameterSchemaSchema = z.looseObject({
  type: z.enum(PARAMETER_TYPES),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ParameterSchema = z.infer<typeof parameterSchemaSchema>;

/** `parameters`: a JSON Schema object whose properties are the parameters. */
export const parametersSchema = z
  .looseObject({
    type: z.literal('object').default('object'),
    properties: z.record(z.string(), parameterSchemaSchema).default({}),
    required: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    for (const name of Object.keys(value.properties)) {
      if (!PARAMETER_NAME_PATTERN.test(name))
        ctx.addIssue({
          code: 'custom',
          path: ['properties', name],
          message: 'parameter names are [A-Za-z_][A-Za-z0-9_]* (max. 64)',
        });
    }

    value.required.forEach((name, i) => {
      if (!Object.prototype.hasOwnProperty.call(value.properties, name))
        ctx.addIssue({ code: 'custom', path: ['required', i], message: `unknown parameter ${name}` });
    });

    for (const [name, schema] of Object.entries(value.properties)) {
      if (schema.default === undefined) continue;

      const issues = checkJsonSchema(schema, schema.default);

      if (issues.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['properties', name, 'default'],
          message: `default does not match the parameter schema: ${issues[0].message}`,
        });
    }
  });
export type ManifestParameters = z.infer<typeof parametersSchema>;

/**
 * When a secret is needed (conditional secrets): `parameter` names a parameter of the manifest; without `equals` it
 * must be a boolean and the secret is needed while it is `true`, with `equals` the secret is needed while the
 * parameter has exactly that value (e.g. an enum option). Checked against the parameter's schema by `parseManifest`.
 */
export const secretConditionSchema = z.strictObject({
  parameter: z.string().regex(PARAMETER_NAME_PATTERN, 'parameter names are [A-Za-z_][A-Za-z0-9_]* (max. 64)'),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type SecretCondition = z.infer<typeof secretConditionSchema>;

export const manifestSecretSchema = z.strictObject({
  name: z.string().regex(SECRET_NAME_PATTERN, 'secret names are [a-z0-9][a-z0-9._-]*'),
  description: z.string().min(1).max(2000),
  /** Needed only while the condition holds; otherwise optional, and the rendered compose leaves it out when unset. */
  requiredWhen: secretConditionSchema.optional(),
});
export type ManifestSecret = z.infer<typeof manifestSecretSchema>;

/**
 * A service the app needs. `bundled`: part of the compose; its services (and volumes) are removed when the boolean
 * `parameter` is false. `provided`: the user supplies an existing one through the listed connection parameters.
 * A dependency can offer both (bundled by default, provided when the toggle is off).
 */
export const manifestDependencySchema = z
  .strictObject({
    name: nameSchema,
    title: z.string().max(200).optional(),
    bundled: z
      .strictObject({
        parameter: z.string().regex(PARAMETER_NAME_PATTERN),
        services: z.array(serviceNameSchema).min(1),
        volumes: z.array(z.string().min(1)).default([]),
      })
      .optional(),
    provided: z.strictObject({ parameters: z.array(z.string().regex(PARAMETER_NAME_PATTERN)).min(1) }).optional(),
  })
  .refine((d) => d.bundled !== undefined || d.provided !== undefined, {
    message: 'a dependency is bundled, provided or both',
  });
export type ManifestDependency = z.infer<typeof manifestDependencySchema>;

/** Draft resources the install plan suggests (Loadweaver resource documents; checked when the plan is created). */
const draftsSchema = z.array(z.record(z.string(), z.unknown())).default([]);

export const manifestSuggestionsSchema = z
  .strictObject({ groups: draftsSchema, policies: draftsSchema, ingress: draftsSchema, dns: draftsSchema })
  .default({ groups: [], policies: [], ingress: [], dns: [] });
export type ManifestSuggestions = z.infer<typeof manifestSuggestionsSchema>;

export const manifestBackupSchema = z.strictObject({
  name: nameSchema,
  schedule: z.string().min(1).max(100),
  volumes: z.array(z.string().min(1)).default([]),
  retention: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
});
export type ManifestBackup = z.infer<typeof manifestBackupSchema>;

export const manifestHealthCheckSchema = z.strictObject({
  service: serviceNameSchema,
  type: z.enum(['http', 'tcp', 'command']),
  port: z.number().int().min(1).max(65535).optional(),
  path: z.string().startsWith('/').optional(),
  command: z.array(z.string()).min(1).optional(),
  interval: z.string().max(20).optional(),
  timeout: z.string().max(20).optional(),
});
export type ManifestHealthCheck = z.infer<typeof manifestHealthCheckSchema>;

export const migrationStepSchema = z.strictObject({
  name: z.string().min(1).max(200),
  service: serviceNameSchema,
  command: z.array(z.string()).min(1),
  /** Before the new version's services start (default) or after. */
  phase: z.enum(['before', 'after']).default('before'),
});
export type MigrationStep = z.infer<typeof migrationStepSchema>;

/** Steps the update plan runs when updating *to* `version` (from any older version). */
export const manifestMigrationSchema = z.strictObject({
  version: semverSchema,
  description: z.string().max(2000).optional(),
  steps: z.array(migrationStepSchema).min(1),
});
export type ManifestMigration = z.infer<typeof manifestMigrationSchema>;

/** A declared reason for a policy-lint exception (e.g. host networking for a VPN app). */
export const manifestExceptionSchema = z.strictObject({
  rule: z.enum(EXCEPTION_RULES),
  /** Compose service it applies to; omitted = every service. */
  service: serviceNameSchema.optional(),
  reason: z.string().min(10).max(1000),
});
export type ManifestException = z.infer<typeof manifestExceptionSchema>;

/** Why a secret condition doesn't fit the parameters (unknown parameter, no boolean, a value the schema refuses). */
function secretConditionIssue(
  condition: SecretCondition,
  params: Record<string, ParameterSchema>,
): { path: string[]; message: string } | null {
  const schema = Object.prototype.hasOwnProperty.call(params, condition.parameter)
    ? params[condition.parameter]
    : undefined;

  if (!schema) return { path: ['parameter'], message: `unknown parameter ${condition.parameter}` };

  if (condition.equals === undefined)
    return schema.type === 'boolean'
      ? null
      : {
          path: ['parameter'],
          message: `${condition.parameter} is a ${schema.type} parameter: name the value with equals (only booleans can go without)`,
        };

  const issues = checkJsonSchema(schema, condition.equals);

  return issues.length > 0
    ? {
        path: ['equals'],
        message: `${JSON.stringify(condition.equals)} is not a value of ${condition.parameter}: ${issues[0].message}`,
      }
    : null;
}

/**
 * Whether a secret is needed for the given (resolved) parameter values: always without `requiredWhen`, else while the
 * condition holds (a boolean parameter is `true` / the parameter equals the value; no value = not needed).
 */
export function secretRequired(
  secret: Pick<ManifestSecret, 'requiredWhen'>,
  parameters: Readonly<Record<string, unknown>>,
): boolean {
  const condition = secret.requiredWhen;

  if (!condition) return true;

  const value = parameters[condition.parameter];

  return condition.equals === undefined ? value === true : value === condition.equals;
}

/** `manifest.yaml` of an app package. */
export const appManifestSchema = z
  .strictObject({
    apiVersion: z.literal(APP_STORE_API_VERSION),
    name: nameSchema,
    version: semverSchema,
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(5000),
    /** Publisher name; matches `publishers[*].name` in the catalog index. */
    publisher: z.string().min(1).max(100),
    /** SPDX licence id or expression; free / OSS only (see `lintPackage`). */
    license: z.string().min(1).max(200),
    homepage: httpUrlSchema,
    docs: httpUrlSchema,
    icon: z.url({ protocol: /^(https?|data)$/ }).optional(),
    channels: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
      .min(1)
      .default(['stable']),
    parameters: parametersSchema.default({ type: 'object', properties: {}, required: [] }),
    secrets: z.array(manifestSecretSchema).default([]),
    dependencies: z.array(manifestDependencySchema).default([]),
    suggestions: manifestSuggestionsSchema,
    backups: z.array(manifestBackupSchema).default([]),
    healthChecks: z.array(manifestHealthCheckSchema).default([]),
    migrations: z.array(manifestMigrationSchema).default([]),
    exceptions: z.array(manifestExceptionSchema).default([]),
    minLoadweaver: semverSchema.optional(),
  })
  .superRefine((m, ctx) => {
    const unique = (values: string[], path: string, what: string) => {
      const seen = new Set<string>();

      values.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: 'custom', path: [path, i], message: `duplicate ${what} ${v}` });

        seen.add(v);
      });
    };

    unique(
      m.secrets.map((s) => s.name),
      'secrets',
      'secret',
    );
    unique(
      m.dependencies.map((d) => d.name),
      'dependencies',
      'dependency',
    );
    unique(m.channels, 'channels', 'channel');
    unique(
      m.migrations.map((x) => x.version),
      'migrations',
      'migration version',
    );

    const params = m.parameters.properties;

    m.dependencies.forEach((d, i) => {
      if (d.bundled) {
        const p = params[d.bundled.parameter];

        if (!p || p.type !== 'boolean')
          ctx.addIssue({
            code: 'custom',
            path: ['dependencies', i, 'bundled', 'parameter'],
            message: `${d.bundled.parameter} must be a boolean parameter`,
          });
      }

      d.provided?.parameters.forEach((name, j) => {
        if (!params[name])
          ctx.addIssue({
            code: 'custom',
            path: ['dependencies', i, 'provided', 'parameters', j],
            message: `unknown parameter ${name}`,
          });
      });
    });

    m.secrets.forEach((s, i) => {
      if (!s.requiredWhen) return;

      const issue = secretConditionIssue(s.requiredWhen, params);

      if (issue)
        ctx.addIssue({ code: 'custom', path: ['secrets', i, 'requiredWhen', ...issue.path], message: issue.message });
    });
  });
export type AppManifest = z.infer<typeof appManifestSchema>;

/** Parses `manifest.yaml` (YAML text, bytes or an already parsed object). */
export function parseManifest(source: string | Uint8Array | unknown): ParseResult<AppManifest> {
  return parseWithSchema(source, appManifestSchema, 'manifest.yaml');
}
