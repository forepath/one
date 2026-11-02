import {
  type AppInstallRequest,
  type AppManifest,
  type AppSuggestionGroup,
  checkJsonSchema,
  type ManifestDependency,
  type ManifestSecret,
  type ParameterSchema,
  type ParameterValue,
} from '@forepath/loadweaver/frontend/data-access-console';

import type { SchemaFieldIssue } from '../objects/schema-field.component';

/**
 * The install form (P1), generated from the manifest: every parameter is a scalar JSON Schema rendered by the
 * resource form's field component; a dependency's boolean toggle switches between the bundled services and the
 * provided connection parameters (only the active side is shown, checked and sent); secrets are references to
 * existing project secrets (a conditional one only while its condition holds); suggestions are a checklist. Pure, so
 * the modal stays a view.
 */

export interface InstallParameterField {
  name: string;
  schema: ParameterSchema;
  required: boolean;
}

export interface InstallDependencyField {
  dependency: ManifestDependency;
  /** The boolean parameter that bundles it (null: provided only). */
  toggle: string | null;
  toggleField: InstallParameterField | null;
  /** The connection parameters when provided. */
  provided: InstallParameterField[];
}

export interface InstallFormModel {
  /** Parameters that are no dependency toggle and no connection parameter. */
  parameters: InstallParameterField[];
  dependencies: InstallDependencyField[];
}

export type SuggestionGroup = AppSuggestionGroup;

/** The groups the cluster takes (`manifest.suggestions.*` and `backups` = the manifest's backup policies). */
export const SUGGESTION_GROUPS: readonly SuggestionGroup[] = ['groups', 'policies', 'ingress', 'dns', 'backups'];

/** One group of the suggested resources (the cluster includes or leaves out whole groups). */
export interface SuggestionItem {
  group: SuggestionGroup;
  /** `Kind name` of each suggested resource (backups: the policy names). */
  labels: string[];
  key: string;
}

function field(manifest: AppManifest, name: string): InstallParameterField | null {
  const schema = manifest.parameters?.properties?.[name];

  return schema ? { name, schema, required: (manifest.parameters.required ?? []).includes(name) } : null;
}

export function installFormModel(manifest: AppManifest): InstallFormModel {
  const dependencies = (manifest.dependencies ?? []).map<InstallDependencyField>((dependency) => ({
    dependency,
    toggle: dependency.bundled?.parameter ?? null,
    toggleField: dependency.bundled ? field(manifest, dependency.bundled.parameter) : null,
    provided: (dependency.provided?.parameters ?? [])
      .map((name) => field(manifest, name))
      .filter((f): f is InstallParameterField => f !== null),
  }));
  const claimed = new Set(
    dependencies.flatMap((d) => [...(d.toggle ? [d.toggle] : []), ...d.provided.map((p) => p.name)]),
  );
  const parameters = Object.keys(manifest.parameters?.properties ?? {})
    .filter((name) => !claimed.has(name))
    .map((name) => field(manifest, name))
    .filter((f): f is InstallParameterField => f !== null);

  return { parameters, dependencies };
}

/** Defaults of every parameter; dependency toggles without a default start bundled. */
export function initialParameterValues(manifest: AppManifest): Record<string, ParameterValue> {
  const values: Record<string, ParameterValue> = {};

  for (const [name, schema] of Object.entries(manifest.parameters?.properties ?? {}))
    if (schema.default !== undefined) values[name] = schema.default;

  for (const d of manifest.dependencies ?? [])
    if (d.bundled && values[d.bundled.parameter] === undefined) values[d.bundled.parameter] = true;

  return values;
}

/** A dependency is bundled when its toggle is on (provided-only dependencies never are). */
export function dependencyBundled(dependency: InstallDependencyField, values: Record<string, unknown>): boolean {
  return !!dependency.toggle && values[dependency.toggle] !== false;
}

/** The parameters that are shown, checked and sent: all but the connection parameters of bundled dependencies. */
export function activeParameters(model: InstallFormModel, values: Record<string, unknown>): InstallParameterField[] {
  const active = [...model.parameters];

  for (const d of model.dependencies) {
    if (d.toggle) active.push(d.toggleField ?? { name: d.toggle, schema: { type: 'boolean' }, required: false });

    if (!dependencyBundled(d, values)) active.push(...d.provided);
  }

  return active;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Problems per active parameter (path `[name]`, the field component's issue format). */
export function parameterIssues(model: InstallFormModel, values: Record<string, unknown>): SchemaFieldIssue[] {
  const issues: SchemaFieldIssue[] = [];

  for (const p of activeParameters(model, values)) {
    const value = values[p.name];

    if (isEmpty(value)) {
      if (p.required) issues.push({ path: [p.name], message: 'required' });

      continue;
    }

    for (const issue of checkJsonSchema(p.schema, value))
      issues.push({ path: [p.name, ...issue.path], message: issue.message });
  }

  return issues;
}

/**
 * Whether the install needs a secret with these values: always, or — a conditional secret (`requiredWhen`) — while its
 * boolean parameter is `true` / its parameter equals the value (an unset parameter counts with its default).
 */
export function secretNeeded(manifest: AppManifest, secret: ManifestSecret, values: Record<string, unknown>): boolean {
  const condition = secret.requiredWhen;

  if (!condition) return true;

  const value = values[condition.parameter] ?? manifest.parameters?.properties?.[condition.parameter]?.default;

  return condition.equals === undefined ? value === true : value === condition.equals;
}

/** The secrets the form shows, requires and sends: conditional ones only while their condition holds. */
export function visibleSecrets(manifest: AppManifest, values: Record<string, unknown>): ManifestSecret[] {
  return (manifest.secrets ?? []).filter((s) => secretNeeded(manifest, s, values));
}

/** Shown secrets still without a reference. */
export function missingSecrets(
  manifest: AppManifest,
  secrets: Record<string, string>,
  values: Record<string, unknown> = initialParameterValues(manifest),
): string[] {
  return visibleSecrets(manifest, values)
    .map((s) => s.name)
    .filter((name) => !secrets[name]?.trim());
}

/** `secret://<project>/<name>` of a secret picked in the install project (a full reference stays as is). */
export function secretReference(project: string, value: string): string {
  const text = value.trim();

  return text.startsWith('secret://') ? text : `secret://${project}/${text}`;
}

/** The suggested resources as a checklist of groups (all checked by default); empty groups are left out. */
export function suggestionItems(manifest: AppManifest): SuggestionItem[] {
  const suggestions = manifest.suggestions ?? { groups: [], policies: [], ingress: [], dns: [] };

  return SUGGESTION_GROUPS.map((group): SuggestionItem => {
    if (group === 'backups') return { group, key: group, labels: (manifest.backups ?? []).map((b) => b.name) };

    const labels = (suggestions[group] ?? []).map((doc, index) => {
      const metadata = (doc['metadata'] ?? {}) as Record<string, unknown>;
      const kind = typeof doc['kind'] === 'string' ? doc['kind'] : group;
      const name = typeof metadata['name'] === 'string' ? metadata['name'] : `#${index + 1}`;

      return `${kind} ${name}`;
    });

    return { group, key: group, labels };
  }).filter((item) => item.labels.length > 0);
}

export interface InstallInput {
  manifest: AppManifest;
  project: string;
  name: string;
  values: Record<string, unknown>;
  /** Manifest secret name → picked secret name (or full reference). */
  secrets: Record<string, string>;
  suggestions: readonly SuggestionItem[];
  /** Checked suggestion groups. */
  selected: ReadonlySet<string>;
}

/** The plan request: active parameters only (unset optional ones left out), secret references, the checklist. */
export function buildInstallRequest(input: InstallInput): AppInstallRequest {
  const model = installFormModel(input.manifest);
  const parameters: Record<string, ParameterValue> = {};

  for (const p of activeParameters(model, input.values)) {
    const value = input.values[p.name];

    if (!isEmpty(value)) parameters[p.name] = value as ParameterValue;
  }

  const secrets: Record<string, string> = {};

  // Hidden conditional secrets aren't sent, even when picked earlier (the cluster would drop them as well).
  for (const s of visibleSecrets(input.manifest, input.values)) {
    const value = input.secrets[s.name];

    if (value?.trim()) secrets[s.name] = secretReference(input.project, value);
  }

  const name = input.name.trim();

  return {
    project: input.project,
    ...(name && name !== input.manifest.name ? { deployment: name } : {}),
    parameters,
    secrets,
    // The cluster includes every group when omitted: the checked groups are always sent explicitly.
    suggestions: input.suggestions.filter((item) => input.selected.has(item.key)).map((item) => item.group),
  };
}

/** Deployment names are DNS labels. */
export const DEPLOYMENT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
