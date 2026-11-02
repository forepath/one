import {
  compareVersions,
  hasLintErrors,
  lintPackage,
  renderCompose,
  type AppManifest,
  type LintFinding,
  type ManifestMigration,
  type MigrationStep,
  type ParameterValue,
} from '@forepath/loadweaver/shared/util-app-catalog';
import {
  APP_ANNOTATIONS,
  APP_BACKUP_BEFORE_UPDATE_ANNOTATION,
  APP_INSTALL_ANNOTATION,
  APP_PARAMETERS_ANNOTATION,
  APP_SECRETS_ANNOTATION,
  appAnnotations,
  LOADWEAVER_API_VERSION,
  parseResource,
  RESOURCE_KINDS,
  stringifyResourceDocuments,
  type AppBackupBeforeUpdate,
  type InstalledAppMetadata,
  type Resource,
} from '@forepath/loadweaver/shared/util-model';
import { isMap, isNode, parseDocument, stringify, YAMLMap } from 'yaml';
/** Annotation values are capped at 4096 characters (resource metadata). */
const MAX_ANNOTATION = 4096;

export const SUGGESTION_GROUPS = ['groups', 'policies', 'ingress', 'dns', 'backups'] as const;
export type SuggestionGroup = (typeof SUGGESTION_GROUPS)[number];

/** A resource the install suggests next to the Deployment (a separate draft op the user can keep or drop). */
export interface SuggestedResource {
  group: SuggestionGroup;
  kind: string;
  name: string;
  document: string;
}

export interface RenderedInstall {
  /** The Deployment document (one YAML document). */
  deployment: string;
  parameters: Record<string, ParameterValue>;
  removedServices: string[];
  suggestions: SuggestedResource[];
  /** Policy lint findings (errors only when the request is refused). */
  findings: LintFinding[];
  warnings: string[];
}

export type RenderOutcome =
  | { ok: true; value: RenderedInstall }
  | { ok: false; errors: string[]; findings?: LintFinding[] };

function withPrefix(errors: readonly string[], prefix: string): string[] {
  return errors.map((e) => `${prefix}${e}`);
}

/** The recorded install inputs of an installed app's Deployment (empty when absent or unreadable). */
export function recordedInputs(annotations: Record<string, string> | undefined): {
  parameters: Record<string, unknown>;
  secrets: Record<string, string>;
} {
  const read = (key: string) => {
    try {
      const value = JSON.parse(annotations?.[key] ?? '{}');

      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  return {
    parameters: read(APP_PARAMETERS_ANNOTATION),
    secrets: Object.fromEntries(
      Object.entries(read(APP_SECRETS_ANNOTATION)).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
  };
}

/**
 * Renders a suggestion document (a manifest `suggestions` entry) with the install's parameters and secret references:
 * the same substitution as the compose (on the YAML tree), then the resource is scoped to the project and marked as
 * belonging to the installation. Cluster-level kinds are refused (an app only creates project resources).
 */
export function renderSuggestion(
  raw: Record<string, unknown>,
  context: {
    manifest: Pick<AppManifest, 'parameters' | 'secrets'>;
    parameters: Record<string, unknown>;
    secrets: Record<string, string>;
    project: string;
    deployment: string;
  },
): { ok: true; resource: Resource } | { ok: false; error: string } {
  const rendered = renderCompose({
    manifest: { parameters: context.manifest.parameters, secrets: context.manifest.secrets, dependencies: [] },
    compose: stringify(raw),
    parameters: context.parameters,
    secrets: context.secrets,
    coerceStrings: true,
  });

  if (rendered.ok === false) return { ok: false, error: rendered.errors.join('; ') };

  const doc = parseDocument(rendered.value.compose).toJS() as Record<string, unknown>;
  const kind = typeof doc['kind'] === 'string' ? doc['kind'] : '';
  const definition = (RESOURCE_KINDS as Record<string, { scope: string } | undefined>)[kind];

  if (!definition) return { ok: false, error: `unknown kind ${kind || '(none)'}` };

  if (definition.scope === 'cluster') return { ok: false, error: `${kind} is a cluster-level resource` };

  const metadata = (doc['metadata'] && typeof doc['metadata'] === 'object' ? doc['metadata'] : {}) as Record<
    string,
    unknown
  >;
  const annotations = (
    metadata['annotations'] && typeof metadata['annotations'] === 'object' ? metadata['annotations'] : {}
  ) as Record<string, string>;
  const parsed = parseResource({
    apiVersion: LOADWEAVER_API_VERSION,
    ...doc,
    metadata: {
      ...metadata,
      project: context.project,
      annotations: { ...annotations, [APP_INSTALL_ANNOTATION]: context.deployment },
    },
  });

  if (parsed.ok === false) return { ok: false, error: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ') };

  return { ok: true, resource: parsed.resource };
}

/** A manifest backup policy as a `BackupPolicy` of the project, selecting the installation's volumes. */
export function backupPolicyFor(
  backup: AppManifest['backups'][number],
  context: { project: string; deployment: string },
): { ok: true; resource: Resource } | { ok: false; error: string } {
  const parsed = parseResource({
    apiVersion: LOADWEAVER_API_VERSION,
    kind: 'BackupPolicy',
    metadata: {
      name: `${context.deployment}-${backup.name}`.slice(0, 63).replace(/-+$/, ''),
      project: context.project,
      annotations: { [APP_INSTALL_ANNOTATION]: context.deployment },
    },
    spec: {
      description: [backup.description, backup.retention ? `Suggested retention: ${backup.retention}` : '']
        .filter(Boolean)
        .join(' — ')
        .slice(0, 1024),
      selector: {
        deployments: { names: [context.deployment] },
        ...(backup.volumes.length ? { volumes: backup.volumes } : {}),
      },
      schedules: [backup.schedule],
    },
  });

  if (parsed.ok === false) return { ok: false, error: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ') };

  return { ok: true, resource: parsed.resource };
}

export interface RenderInstallInput {
  manifest: AppManifest;
  compose: string;
  app: InstalledAppMetadata;
  project: string;
  deployment: string;
  parameters?: Record<string, unknown>;
  secrets?: Record<string, string>;
  /** Suggestion groups to include (default: all). */
  include?: readonly SuggestionGroup[];
  /** Labels / variables of the existing Deployment (updates keep them). */
  labels?: Record<string, string>;
  variables?: Record<string, string>;
  /** Extra annotations of the existing Deployment that aren't the app's own (updates keep them). */
  annotations?: Record<string, string>;
  /** Migration steps to add as `before` / `after` jobs (updates). */
  migrations?: readonly ManifestMigration[];
  /** Updates: volumes the apply backs up before it applies this version (the manifest declares backups). */
  backupBeforeUpdate?: AppBackupBeforeUpdate;
}

/**
 * Renders an install (or an update's new state): secret references must name the target project, the compose is
 * rendered with the parameters, linted (errors refuse unless the manifest declares exceptions), the app record and
 * inputs go into annotations, migrations become jobs, and the suggested resources are rendered next to it.
 */
export function renderInstall(input: RenderInstallInput): RenderOutcome {
  const given = input.secrets ?? {};
  const findings = lintPackage({ manifest: input.manifest, compose: input.compose });

  if (hasLintErrors(findings))
    return {
      ok: false,
      errors: findings.filter((f) => f.severity === 'error').map((f) => `lint ${f.rule}: ${f.message}`),
      findings,
    };

  const rendered = renderCompose({
    manifest: input.manifest,
    compose: input.compose,
    parameters: input.parameters,
    secrets: given,
    coerceStrings: true,
  });

  if (rendered.ok === false) return { ok: false, errors: rendered.errors, findings };

  // Conditional secrets whose condition is off are dropped (decided P1): not checked, mounted or recorded.
  const omitted = new Set(rendered.value.omittedSecrets);
  const secrets = Object.fromEntries(Object.entries(given).filter(([name]) => !omitted.has(name)));
  const errors: string[] = [];

  for (const [name, ref] of Object.entries(secrets)) {
    const project = /^secret:\/\/([^/]+)\//.exec(ref)?.[1];

    if (project !== undefined && project !== input.project)
      errors.push(`secret ${name}: the reference must name a secret of project ${input.project}`);
  }

  if (errors.length) return { ok: false, errors, findings };

  let compose = rendered.value.compose;

  if (input.migrations?.length) {
    const jobs = addMigrationJobs(
      compose,
      input.migrations.flatMap((m) => m.steps.map((step) => ({ version: m.version, step }))),
    );

    if (jobs.ok === false) return { ok: false, errors: jobs.errors, findings };

    compose = jobs.compose;
  }

  const recordedParameters = JSON.stringify(rendered.value.parameters);
  const recordedSecrets = JSON.stringify(secrets);

  if (recordedParameters.length > MAX_ANNOTATION || recordedSecrets.length > MAX_ANNOTATION)
    return { ok: false, errors: ['the install parameters are too large to record (4096 characters)'], findings };

  const ownKeys = new Set<string>([
    ...Object.values(APP_ANNOTATIONS),
    APP_PARAMETERS_ANNOTATION,
    APP_SECRETS_ANNOTATION,
    APP_BACKUP_BEFORE_UPDATE_ANNOTATION,
  ]);
  const keptAnnotations = Object.fromEntries(
    Object.entries(input.annotations ?? {}).filter(([key]) => !ownKeys.has(key)),
  );
  const deployment = parseResource({
    apiVersion: LOADWEAVER_API_VERSION,
    kind: 'Deployment',
    metadata: {
      name: input.deployment,
      project: input.project,
      ...(input.labels && Object.keys(input.labels).length ? { labels: input.labels } : {}),
      annotations: {
        ...keptAnnotations,
        ...appAnnotations(input.app),
        [APP_PARAMETERS_ANNOTATION]: recordedParameters,
        [APP_SECRETS_ANNOTATION]: recordedSecrets,
        ...(input.backupBeforeUpdate?.volumes.length
          ? { [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: JSON.stringify(input.backupBeforeUpdate) }
          : {}),
      },
    },
    spec: {
      compose,
      ...(input.variables && Object.keys(input.variables).length ? { variables: input.variables } : {}),
    },
  });

  if (deployment.ok === false)
    return {
      ok: false,
      errors: withPrefix(
        deployment.issues.map((i) => `${i.path}: ${i.message}`),
        'deployment: ',
      ),
      findings,
    };

  const include = new Set(input.include ?? SUGGESTION_GROUPS);
  const warnings: string[] = [];
  const suggestions: SuggestedResource[] = [];
  const context = {
    manifest: input.manifest,
    parameters: rendered.value.parameters,
    secrets,
    project: input.project,
    deployment: input.deployment,
  };

  for (const group of ['groups', 'policies', 'ingress', 'dns'] as const) {
    if (!include.has(group)) continue;

    input.manifest.suggestions[group].forEach((raw, i) => {
      const result = renderSuggestion(raw, context);

      if (result.ok === false) {
        warnings.push(`suggestions.${group}[${i}] left out: ${result.error}`);

        return;
      }

      suggestions.push(toSuggestion(group, result.resource));
    });
  }

  if (include.has('backups'))
    input.manifest.backups.forEach((backup, i) => {
      const result = backupPolicyFor(backup, context);

      if (result.ok === false) warnings.push(`backups[${i}] left out: ${result.error}`);
      else suggestions.push(toSuggestion('backups', result.resource));
    });

  return {
    ok: true,
    value: {
      deployment: stringifyResourceDocuments([deployment.resource]),
      parameters: rendered.value.parameters,
      removedServices: rendered.value.removedServices,
      suggestions,
      findings,
      warnings,
    },
  };
}

function toSuggestion(group: SuggestionGroup, resource: Resource): SuggestedResource {
  return { group, kind: resource.kind, name: resource.metadata.name, document: stringifyResourceDocuments([resource]) };
}

/** The manifest migrations an update from `from` to `to` runs: versions in (from, to], oldest first. */
export function migrationsBetween(
  manifest: Pick<AppManifest, 'migrations'>,
  from: string,
  to: string,
): ManifestMigration[] {
  return manifest.migrations
    .filter((m) => compareVersions(m.version, from) > 0 && compareVersions(m.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** Service keys a migration job doesn't take over from the service it runs as (it isn't served, scaled or exposed). */
const JOB_DROPPED_KEYS = new Set([
  'ports',
  'expose',
  'healthcheck',
  'deploy',
  'restart',
  'container_name',
  'scale',
  'x-loadweaver',
  'x-loadweaver-exceptions',
  'command',
  'entrypoint',
  'profiles',
  'depends_on',
]);

/** `lw-migrate-<version>-<n>` as a compose service name. */
function jobName(version: string, index: number): string {
  return `lw-migrate-${version.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${index + 1}`.slice(0, 63);
}

/**
 * Adds manifest migration steps as one-off jobs (`x-loadweaver.job`, run once per apply; `before` holds the new
 * version back until they succeeded): each runs the step's command in a copy of its service (image, environment,
 * volumes, secrets, networks), without ports, health checks, scaling or the service's own extensions.
 */
export function addMigrationJobs(
  compose: string,
  steps: readonly { version: string; step: MigrationStep }[],
): { ok: true; compose: string } | { ok: false; errors: string[] } {
  const doc = parseDocument(compose);
  const services = doc.get('services', true);

  if (!isMap(services)) return { ok: false, errors: ['compose.yaml has no services'] };

  const errors: string[] = [];

  steps.forEach(({ version, step }, index) => {
    const base = services.get(step.service, true);

    if (!isMap(base)) {
      errors.push(`migration ${version} "${step.name}": service ${step.service} is not part of the rendered compose`);

      return;
    }

    const job = new YAMLMap();

    for (const pair of base.items) {
      const key = String((pair.key as { value?: unknown })?.value ?? pair.key);

      if (!JOB_DROPPED_KEYS.has(key))
        job.add(doc.createPair(key, isNode(pair.value) ? pair.value.clone() : pair.value));
    }

    job.set('command', doc.createNode([...step.command]));
    job.set('restart', 'no');
    job.set('x-loadweaver', doc.createNode({ job: { phase: step.phase } }));
    services.set(jobName(version, index), job);
  });

  return errors.length ? { ok: false, errors } : { ok: true, compose: doc.toString({ lineWidth: 0 }) };
}

/**
 * The volumes an update to `manifest`'s version backs up first: those its declared backups name (a backup without
 * volumes means every volume of the deployment). Empty when the manifest declares no backups (updated as before).
 */
export function backupBeforeUpdateVolumes(
  manifest: Pick<AppManifest, 'backups'>,
  deploymentVolumes: readonly string[],
): string[] {
  if (manifest.backups.length === 0) return [];

  const named = manifest.backups.some((b) => b.volumes.length === 0)
    ? deploymentVolumes
    : manifest.backups.flatMap((b) => b.volumes);

  return [...new Set(named)].sort();
}
