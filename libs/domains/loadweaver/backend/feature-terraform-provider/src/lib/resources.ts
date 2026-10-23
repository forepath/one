import {
  containsUnknown,
  isUnknown,
  type AttributeSchema,
  type BlockSchema,
  type TfObject,
  type TfValue,
} from '@forepath/loadweaver/backend/util-terraform-protocol';
import {
  LOADWEAVER_API_VERSION,
  parseResource,
  RESOURCE_KINDS,
  type Resource,
  type ResourceIssue,
  type ResourceKind,
  type ResourceScope,
} from '@forepath/loadweaver/shared/util-model';

/** A typed attribute mapped onto a path inside the resource's `spec`. */
export interface SpecField {
  attribute: AttributeSchema;
  path: string[];
}

/**
 * A Terraform resource type over one Loadweaver kind. Kinds with a small, flat spec get typed attributes
 * (`fields`); the others take the spec as JSON (`spec = jsonencode({...})`), validated against the same schema
 * the control plane uses (util-model), so every field of the kind is available without a second schema.
 */
export interface ResourceDefinition {
  typeName: string;
  /** `null`: the generic `loadweaver_resource` with a `kind` attribute. */
  kind: ResourceKind | null;
  description: string;
  fields: SpecField[] | null;
}

const str = (name: string, description: string, extra: Partial<AttributeSchema> = {}): AttributeSchema => ({
  name,
  type: 'string',
  optional: true,
  description,
  ...extra,
});

export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    typeName: 'loadweaver_project',
    kind: 'Project',
    description:
      'A project: the access unit that owns deployments, groups, policies and volumes, with defaults and quota.',
    fields: [
      { attribute: str('description', 'Description shown in the console.'), path: ['description'] },
      {
        attribute: str('default_cpu', 'CPU request of services without `deploy.resources` (default `0.25`).', {
          computed: true,
        }),
        path: ['defaults', 'cpu'],
      },
      {
        attribute: str('default_memory', 'Memory request of services without `deploy.resources` (default `256m`).', {
          computed: true,
        }),
        path: ['defaults', 'memory'],
      },
      {
        attribute: str('default_volume_size', 'Size of volumes without `x-loadweaver.size` (default `10g`).', {
          computed: true,
        }),
        path: ['defaults', 'volumeSize'],
      },
      { attribute: str('quota_cpu', 'Quota: requested CPUs of all replicas.'), path: ['quota', 'cpu'] },
      {
        attribute: str('quota_memory', 'Quota: requested memory of all replicas, e.g. `16g`.'),
        path: ['quota', 'memory'],
      },
      {
        attribute: str('quota_storage', 'Quota: volume sizes (each volume once), e.g. `500g`.'),
        path: ['quota', 'storage'],
      },
      {
        attribute: {
          name: 'quota_public_ips',
          type: 'number',
          optional: true,
          description: 'Quota: public addresses.',
        },
        path: ['quota', 'publicIps'],
      },
      {
        attribute: { name: 'quota_ports', type: 'number', optional: true, description: 'Quota: published L4 ports.' },
        path: ['quota', 'ports'],
      },
      {
        attribute: str('billing_subscription_id', "Decabill subscription the project's metered usage is billed on."),
        path: ['billing', 'decabillSubscriptionId'],
      },
    ],
  },
  {
    typeName: 'loadweaver_deployment',
    kind: 'Deployment',
    description:
      'A Docker Compose project with `x-loadweaver` extensions (replicas, placement, exposure, volumes and their replication / backups).',
    fields: [
      {
        attribute: {
          name: 'compose',
          type: 'string',
          required: true,
          description:
            'The compose file, e.g. `file("compose.yaml")`. Volumes are declared here (top-level `volumes` with `x-loadweaver`).',
        },
        path: ['compose'],
      },
      {
        attribute: {
          name: 'variables',
          type: ['map', 'string'],
          optional: true,
          description: 'Values for `${VAR}` interpolation (never secrets: use secret references).',
        },
        path: ['variables'],
      },
    ],
  },
  ...(
    [
      ['loadweaver_workload_group', 'WorkloadGroup'],
      ['loadweaver_node_group', 'NodeGroup'],
      ['loadweaver_client_group', 'ClientGroup'],
      ['loadweaver_policy', 'Policy'],
      ['loadweaver_dns_zone', 'DnsZone'],
      ['loadweaver_dns_record', 'DnsRecord'],
      ['loadweaver_alert_rule', 'AlertRule'],
      ['loadweaver_backup_policy', 'BackupPolicy'],
    ] as const
  ).map(([typeName, kind]) => ({ typeName, kind, description: RESOURCE_KINDS[kind].description, fields: null })),
  {
    typeName: 'loadweaver_resource',
    kind: null,
    description: 'Any Loadweaver resource kind (`kind` + JSON `spec`), for kinds without a dedicated resource type.',
    fields: null,
  },
];

export function definitionFor(typeName: string): ResourceDefinition | undefined {
  return RESOURCE_DEFINITIONS.find((d) => d.typeName === typeName);
}

/** Whether a resource type has a `project` attribute (generic: always, its kind decides at plan time). */
export function hasProjectAttribute(def: ResourceDefinition): boolean {
  return def.kind === null || RESOURCE_KINDS[def.kind].scope !== 'cluster';
}

export function resourceSchema(def: ResourceDefinition): BlockSchema {
  const attributes: AttributeSchema[] = [
    {
      name: 'id',
      type: 'string',
      computed: true,
      description: '`Kind/name` or `Kind/project/name`.',
    },
  ];

  if (def.kind === null)
    attributes.push({
      name: 'kind',
      type: 'string',
      required: true,
      description: 'The Loadweaver kind, e.g. `ImagePolicy` (see `/api/schemas`). Changing it replaces the resource.',
    });

  attributes.push({
    name: 'name',
    type: 'string',
    required: true,
    description: 'Resource name (lowercase RFC 1123 label). Changing it replaces the resource.',
  });

  if (hasProjectAttribute(def)) {
    const scope = def.kind ? RESOURCE_KINDS[def.kind].scope : 'any';

    attributes.push({
      name: 'project',
      type: 'string',
      optional: true,
      computed: true,
      description:
        scope === 'project'
          ? 'Owning project. Default: the provider `project`. Changing it replaces the resource.'
          : 'Owning project, or `""` for a cluster-wide resource. Default: the provider `project` if set, else cluster-wide. Changing it replaces the resource.',
    });
  }

  attributes.push({
    name: 'labels',
    type: ['map', 'string'],
    optional: true,
    description: 'Resource labels (`metadata.labels`).',
  });

  if (def.fields) attributes.push(...def.fields.map((f) => f.attribute));
  else
    attributes.push({
      name: 'spec',
      type: 'string',
      required: true,
      description:
        'The resource `spec` as JSON, e.g. `jsonencode({ ... })` or `jsonencode(yamldecode(file("policy.yaml")))`. Fields are those of the kind\'s JSON Schema (`/api/schemas/{kind}`).',
    });

  attributes.push({
    name: 'last_plan_id',
    type: 'string',
    computed: true,
    description: 'The Loadweaver plan that last changed this resource through Terraform.',
  });

  return {
    version: 0,
    description: `${def.description}\n\nChanges are planned and applied as Loadweaver plans (subject to the project's approval rules).`,
    attributes,
  };
}

export function kindOf(def: ResourceDefinition, state: TfObject): string | null {
  if (def.kind) return def.kind;

  const kind = state['kind'];

  return typeof kind === 'string' ? kind : null;
}

export function scopeOfKind(kind: string): ResourceScope | null {
  return kind in RESOURCE_KINDS ? RESOURCE_KINDS[kind as ResourceKind].scope : null;
}

/** `Kind/name` or `Kind/project/name` (what `terraform import` takes as well, without the kind for typed resources). */
export function resourceId(kind: string, name: string, project: string | null): string {
  return project ? `${kind}/${project}/${name}` : `${kind}/${name}`;
}

/** Canonical JSON like Terraform's `jsonencode`: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);

    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );

    return v;
  };

  return JSON.stringify(sort(value));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

function getPath(spec: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = spec;

  for (const key of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined;

  return cur;
}

function setPath(spec: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = spec;

  for (const key of path.slice(0, -1)) {
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};

    cur = cur[key] as Record<string, unknown>;
  }

  cur[path[path.length - 1]] = value;
}

export type SpecResult =
  | { ok: true; spec: Record<string, unknown> }
  | { ok: false; attribute: string; message: string };

/** The `spec` a state / config describes (all values must be known). */
export function specFromState(def: ResourceDefinition, state: TfObject): SpecResult {
  if (!def.fields) {
    const raw = state['spec'];

    if (typeof raw !== 'string') return { ok: false, attribute: 'spec', message: 'spec is required' };

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { ok: false, attribute: 'spec', message: 'spec must be a JSON object' };

      return { ok: true, spec: parsed as Record<string, unknown> };
    } catch (error) {
      return { ok: false, attribute: 'spec', message: `spec is not valid JSON: ${(error as Error).message}` };
    }
  }

  const spec: Record<string, unknown> = {};

  for (const field of def.fields) {
    const value = state[field.attribute.name];

    if (value !== null && value !== undefined && !isUnknown(value)) setPath(spec, field.path, value);
  }

  return { ok: true, spec };
}

/** The Loadweaver resource document of a (fully known) state, or why it can't be built. */
export function documentFromState(
  def: ResourceDefinition,
  state: TfObject,
): { ok: true; resource: Resource } | { ok: false; attribute: string; message: string } {
  const kind = kindOf(def, state);

  if (!kind) return { ok: false, attribute: 'kind', message: 'kind is required' };

  const spec = specFromState(def, state);

  if (spec.ok === false) return spec;

  const project = typeof state['project'] === 'string' && state['project'] !== '' ? state['project'] : undefined;
  const labels = state['labels'];

  return {
    ok: true,
    resource: {
      apiVersion: LOADWEAVER_API_VERSION,
      kind: kind as ResourceKind,
      metadata: {
        name: String(state['name']),
        ...(project ? { project } : {}),
        ...(labels && typeof labels === 'object' && !Array.isArray(labels) && Object.keys(labels).length > 0
          ? { labels: labels as Record<string, string> }
          : {}),
      },
      spec: spec.spec as Resource['spec'],
    },
  };
}

/** Maps a model issue path (`spec.selector.matchLabels`) onto the Terraform attribute it comes from. */
export function attributeForIssue(def: ResourceDefinition, path: string): string {
  const parts = path.split('.').filter(Boolean);

  if (parts[0] === 'metadata') return parts[1] === 'project' ? 'project' : parts[1] === 'labels' ? 'labels' : 'name';

  if (parts[0] === 'kind') return 'kind';

  if (parts[0] !== 'spec') return def.fields ? 'name' : 'spec';

  if (!def.fields) return 'spec';

  const rest = parts.slice(1);
  const field =
    def.fields.find((f) => f.path.every((p, i) => rest[i] === p)) ?? def.fields.find((f) => f.path[0] === rest[0]);

  return field?.attribute.name ?? def.fields[0].attribute.name;
}

/** Local validation with the control plane's own schema (defaults applied); `null` resource if invalid. */
export function validateDocument(resource: Resource): { resource: Resource | null; issues: ResourceIssue[] } {
  const parsed = parseResource(resource);

  return parsed.ok ? { resource: parsed.resource, issues: [] } : { resource: null, issues: parsed.issues };
}

/**
 * The state after reading the stored resource. Values the configuration states keep their configured form as long
 * as they mean the same as what is stored (the control plane fills in defaults); a real difference (drift) puts
 * the stored value into the state, so the next plan shows it and puts it back.
 */
export function stateFromServer(def: ResourceDefinition, prior: TfObject, server: Resource): TfObject {
  const next: TfObject = { ...prior };
  const kind = server.kind;
  const project = server.metadata.project ?? null;

  next['id'] = resourceId(kind, server.metadata.name, project);
  next['name'] = server.metadata.name;

  if (def.kind === null) next['kind'] = kind;

  if (hasProjectAttribute(def)) next['project'] = project ?? '';

  const serverLabels = server.metadata.labels ?? {};
  const priorLabels = prior['labels'];

  next['labels'] =
    Object.keys(serverLabels).length === 0 &&
    (priorLabels === null ||
      priorLabels === undefined ||
      (typeof priorLabels === 'object' && Object.keys(priorLabels).length === 0))
      ? (priorLabels ?? null)
      : (serverLabels as TfObject);

  const serverSpec = (server.spec ?? {}) as Record<string, unknown>;

  if (!def.fields) {
    const priorSpec = typeof prior['spec'] === 'string' ? prior['spec'] : null;

    if (priorSpec !== null && specMatches(def, prior, priorSpec, server)) next['spec'] = priorSpec;
    else next['spec'] = canonicalJson(serverSpec);

    return next;
  }

  for (const field of def.fields) {
    const value = getPath(serverSpec, field.path);

    next[field.attribute.name] = value === undefined ? null : (value as TfValue);
  }

  // Optional-only typed attributes the configuration leaves out but the server fills with a default stay null.
  const normalizedPrior = documentFromState(def, prior);

  if (normalizedPrior.ok) {
    const validated = validateDocument(normalizedPrior.resource);

    if (validated.resource && deepEqual(validated.resource.spec, serverSpec))
      for (const field of def.fields)
        if (!field.attribute.computed) next[field.attribute.name] = prior[field.attribute.name] ?? null;
  }

  return next;
}

function specMatches(def: ResourceDefinition, prior: TfObject, priorSpec: string, server: Resource): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(priorSpec);
  } catch {
    return false;
  }

  if (deepEqual(parsed, server.spec)) return true;

  const doc = documentFromState(def, { ...prior, kind: server.kind, project: server.metadata.project ?? '' });

  if (!doc.ok) return false;

  const validated = validateDocument(doc.resource);

  return !!validated.resource && deepEqual(validated.resource.spec, server.spec);
}

/** Replaces unknown values of a planned state with what the server stored (after an apply). */
export function fillUnknowns(planned: TfObject, fromServer: TfObject): TfObject {
  const out: TfObject = {};

  for (const [key, value] of Object.entries(planned))
    out[key] = isUnknown(value) || containsUnknown(value) ? (fromServer[key] ?? null) : value;

  return out;
}
