import { parseDocument } from 'yaml';

import { namePath, type SchemaNode } from './schema-form';

/**
 * Reference fields of the generated resource form (2026-10-29, "typeaheads for references"): which spec fields name
 * another object, and what they name. The JSON Schemas only say "a DNS label" (`resourceNameSchema`), so the
 * referenced kind comes from this table (by kind and field path, or by a field name that always means the same kind);
 * secret references are recognised by their `secret://` pattern.
 */

/** What a reference field points at. */
export type ReferenceTarget =
  /** A declared resource of `kind`; `projectScoped`: only those of the edited resource's project. */
  | { type: 'resource'; kind: string; projectScoped: boolean }
  /** A project (`me.projects` + readable `Project` resources). */
  | { type: 'project' }
  /** `secret://<project>/<name>`: project picker + secret-name picker (`secretName`). */
  | { type: 'secret' }
  /** A secret's name within `project` (names only, `GET /projects/:project/secrets/names`; never values). */
  | { type: 'secretName'; project: string | null }
  /** A backup id from the catalog of the edited resource's project. */
  | { type: 'backup' };

const resource = (kind: string, projectScoped = false): ReferenceTarget => ({ type: 'resource', kind, projectScoped });

/** Field names that name the same kind wherever they appear (strings or lists of strings). */
const BY_KEY: Readonly<Record<string, ReferenceTarget>> = {
  nodeGroup: resource('NodeGroup'),
  site: resource('Site'),
  sites: resource('Site'),
  primarySite: resource('Site'),
  pool: resource('IpPool'),
  pools: resource('IpPool'),
  secondaries: resource('DnsProvider'),
  peers: resource('BgpPeer'),
  restrictedGroup: resource('ClientGroup'),
  clients: resource('ClientGroup'),
  targets: resource('BackupTarget'),
  projects: { type: 'project' },
};

/** `Kind:field.path` (list indices dropped) → target, where the field name alone is ambiguous. */
const BY_PATH: Readonly<Record<string, ReferenceTarget>> = {
  'DnsZone:provider': resource('DnsProvider'),
  'DnsRecord:zone': resource('DnsZone'),
  'Policy:from.group': resource('WorkloadGroup', true),
  'Policy:to.group': resource('WorkloadGroup', true),
  'Policy:from.project': { type: 'project' },
  'Policy:to.project': { type: 'project' },
  'VirtualMachine:nics.groups': resource('WorkloadGroup', true),
  'Restore:target.deployment': resource('Deployment', true),
  'Restore:backup': { type: 'backup' },
  'BackupPolicy:selector.deployments.names': resource('Deployment', true),
  'NodeGroup:selector.names': resource('Node'),
  'MaintenanceWindow:selector.names': resource('Node'),
  'AlertRule:condition.metric.node': resource('Node'),
};

function isString(schema: SchemaNode): boolean {
  const type = schema['type'];

  return type === 'string' || (Array.isArray(type) && type.includes('string'));
}

/** The reference target of the string field at `path` of `kind` (null: not a reference). */
export function referenceOf(
  kind: string,
  path: readonly (string | number)[],
  schema: SchemaNode,
): ReferenceTarget | null {
  if (!isString(schema) || schema['enum'] !== undefined || schema['const'] !== undefined) return null;

  const pattern = typeof schema['pattern'] === 'string' ? (schema['pattern'] as string) : '';

  if (pattern.startsWith('^secret:')) return { type: 'secret' };

  const names = namePath(path);
  const at = BY_PATH[`${kind}:${names}`];

  if (at) return at;

  const key = names.split('.').at(-1) ?? '';

  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
}

/** `secret://ops/db@3` → `{ project: 'ops', name: 'db@3' }` (anything else: the whole text is the name). */
export function splitSecretRef(value: unknown): { project: string; name: string } {
  const text = typeof value === 'string' ? value : '';
  const match = /^secret:\/\/([^/]*)\/?(.*)$/.exec(text);

  return match ? { project: match[1], name: match[2] } : { project: '', name: text };
}

/** The reference text of a project and a name (`undefined` when both are empty). */
export function joinSecretRef(project: string, name: string): string | undefined {
  const p = project.trim();
  const n = name.trim();

  return p || n ? `secret://${p}/${n}` : undefined;
}

/** `metadata.project` of a resource YAML document (null: cluster-level, or the text doesn't parse). */
export function documentProject(text: string): string | null {
  try {
    const doc = parseDocument(text);

    if (doc.errors.length > 0) return null;

    const project = doc.getIn(['metadata', 'project']);

    return typeof project === 'string' && project ? project : null;
  } catch {
    return null;
  }
}

export const REF_TEXT = {
  placeholder: $localize`:@@lwSchemaRef-placeholder:Search or type a name`,
  empty: $localize`:@@lwSchemaRef-empty:No {kind} you can see matches.`,
  emptyInProject: $localize`:@@lwSchemaRef-emptyInProject:No {kind} in project {project} matches.`,
  typeAnyway: $localize`:@@lwSchemaRef-typeAnyway:You can still type a name.`,
  denied: $localize`:@@lwSchemaRef-denied:You can't list these here: type the name.`,
  projectDetail: $localize`:@@lwSchemaRef-projectDetail:Project {project}`,
  yourRole: $localize`:@@lwSchemaRef-yourRole:Your role: {role}`,
  secretProject: $localize`:@@lwSchemaRef-secretProject:Project of the secret`,
  secretName: $localize`:@@lwSchemaRef-secretName:Secret name`,
  secretHint: $localize`:@@lwSchemaRef-secretHint:Pick the project, then the secret.`,
  secretEmpty: $localize`:@@lwSchemaRef-secretEmpty:No secret in project {project} matches.`,
  secretPickProject: $localize`:@@lwSchemaRef-secretPickProject:Pick the project first.`,
  backupEmpty: $localize`:@@lwSchemaRef-backupEmpty:No backups in project {project}.`,
  project: $localize`:@@lwSchemaRef-project:Project`,
} as const;
