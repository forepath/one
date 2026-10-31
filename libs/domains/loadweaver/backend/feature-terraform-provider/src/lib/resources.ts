import {
  containsUnknown,
  isUnknown,
  nestedAttribute,
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

/**
 * A typed attribute mapped onto a path inside the resource's `spec`. Nested attributes (lists of objects / objects)
 * map their snake_case attribute names onto the spec's camelCase keys (`cross_site` → `crossSite`); map values
 * (labels) are kept as they are.
 */
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

const num = (name: string, description: string, extra: Partial<AttributeSchema> = {}): AttributeSchema => ({
  name,
  type: 'number',
  optional: true,
  description,
  ...extra,
});

const bool = (name: string, description: string): AttributeSchema => ({
  name,
  type: 'bool',
  optional: true,
  description,
});

const strings = (name: string, description: string): AttributeSchema => ({
  name,
  type: ['list', 'string'],
  optional: true,
  description,
});

/** `VirtualMachine` (3.35): typed, with disks / NICs as lists of nested attributes and cloud-init / placement objects. */
const VIRTUAL_MACHINE_FIELDS: SpecField[] = [
  { attribute: str('description', 'Description shown in the console.'), path: ['description'] },
  {
    attribute: str(
      'image',
      'VM image in the registry (OCI VM image artifact or KubeVirt containerDisk), e.g. `registry.lw/shop/debian-13:20261017`; pinned to its digest by the plan.',
      { optional: false, required: true },
    ),
    path: ['image'],
  },
  { attribute: str('firmware', '`uefi` (default) or `bios` (amd64 only).'), path: ['firmware'] },
  {
    attribute: num('vcpus', 'Virtual CPUs (1-64).', { optional: false, required: true }),
    path: ['cpu', 'vcpus'],
  },
  {
    attribute: str(
      'cpu_model',
      '`host-model` (default, live-migrates across same-vendor nodes) or `host-passthrough` (live migration only between identical CPUs).',
    ),
    path: ['cpu', 'model'],
  },
  {
    attribute: str('memory', 'Guest memory, e.g. `4Gi` (at least `256Mi`).', { optional: false, required: true }),
    path: ['memory'],
  },
  {
    attribute: nestedAttribute(
      {
        name: 'disks',
        required: true,
        description:
          'Disks (1-8), replicated DRBD volumes attached as virtio-blk. Exactly one has `source = "image"`: the boot disk, written from the image on first start.',
      },
      'list',
      [
        str('name', 'Disk name (lowercase label, unique in the VM).', { optional: false, required: true }),
        str('size', "Size, e.g. `20Gi`; the boot disk at least the image's virtual size.", {
          optional: false,
          required: true,
        }),
        str('source', '`image` (the boot disk) or `blank` (default).'),
        num('replicas', "Copies of the disk (1-5); default: the cluster's volume default."),
        str('cross_site', 'Cross-site copy: `async`, `sync` or `none`.'),
        str('bus', '`virtio` (default, the only bus).'),
        str('cache', 'Host cache mode: `none` (default) or `writeback`.'),
      ],
    ),
    path: ['disks'],
  },
  {
    attribute: nestedAttribute(
      {
        name: 'nics',
        required: true,
        description:
          'Network interfaces (1-8). Each gets its own addresses and joins groups / policies like a service; the first is the primary one (default route, DNS name).',
      },
      'list',
      [
        str('name', 'Interface name in the guest, e.g. `eth0`.', { optional: false, required: true }),
        strings('groups', "Workload groups of the VM's project this interface is a member of."),
        {
          name: 'labels',
          type: ['map', 'string'],
          optional: true,
          description: "Extra labels of this interface for group selectors (merged over the VM's labels).",
        },
        bool('ipv4', 'IPv4 address (default: every family the cluster has a pod pool for).'),
        bool('ipv6', 'IPv6 address (default: every family the cluster has a pod pool for).'),
      ],
    ),
    path: ['nics'],
  },
  {
    attribute: nestedAttribute(
      {
        name: 'cloud_init',
        optional: true,
        description: 'First-boot configuration through a cloud-init NoCloud seed (built on tmpfs on the node).',
      },
      'single',
      [
        str(
          'user_data',
          '`#cloud-config` user data; may contain `secret://project/name` references, resolved on the node.',
        ),
        str('user_data_secret', 'User data from a secret (`secret://project/name`) instead of `user_data`.'),
        strings('ssh_authorized_keys', 'SSH public keys for the default user.'),
        str('network_config', '`auto` (default: static config for every NIC) or `none`.'),
      ],
    ),
    path: ['cloudInit'],
  },
  {
    attribute: nestedAttribute({ name: 'placement', optional: true, description: 'Where the VM may run.' }, 'single', [
      nestedAttribute({ name: 'selector', optional: true, description: 'Node selector.' }, 'single', [
        strings('names', 'Node names.'),
        {
          name: 'match_labels',
          type: ['map', 'string'],
          optional: true,
          description: 'Node labels that must match.',
        },
        nestedAttribute({ name: 'match_expressions', optional: true, description: 'Label expressions.' }, 'list', [
          str('key', 'Label key.', { optional: false, required: true }),
          str('operator', '`In`, `NotIn`, `Exists` or `DoesNotExist`.', { optional: false, required: true }),
          strings('values', 'Values for `In` / `NotIn`.'),
        ]),
      ]),
      str('spread', '`node` or `site`.'),
    ]),
    path: ['placement'],
  },
  {
    attribute: bool(
      'ha_restart_elsewhere',
      'Restart on another node with a disk copy when the node fails (default `true`); `false` pins the VM to its node.',
    ),
    path: ['ha', 'restartElsewhere'],
  },
  {
    attribute: bool('live_migration', 'QEMU live migration for planned moves (default `true`).'),
    path: ['liveMigration', 'enabled'],
  },
  {
    attribute: str(
      'run_strategy',
      '`Always` (default), `Manual` (powered on / off through the API or console) or `Halted`.',
    ),
    path: ['runStrategy'],
  },
  {
    attribute: bool('graphical_console', 'Graphical console (VNC) next to the serial console (default `true`).'),
    path: ['console', 'graphical'],
  },
];

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
        attribute: num('quota_virtual_machines', 'Quota: virtual machines.'),
        path: ['quota', 'virtualMachines'],
      },
      { attribute: num('quota_vm_vcpus', 'Quota: vCPUs of all virtual machines.'), path: ['quota', 'vmVcpus'] },
      {
        attribute: str('quota_vm_memory', 'Quota: memory of all virtual machines, e.g. `512g`.'),
        path: ['quota', 'vmMemory'],
      },
      {
        attribute: str('quota_vm_disk_bytes', 'Quota: disk sizes of all virtual machines (each disk once), e.g. `2t`.'),
        path: ['quota', 'vmDiskBytes'],
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
  {
    typeName: 'loadweaver_virtual_machine',
    kind: 'VirtualMachine',
    description:
      'A full virtual machine (QEMU / KVM): image, vCPUs / memory, replicated disks, one or more NICs, cloud-init, placement, HA, live migration and run strategy. Power actions (start / stop / reboot) and consoles stay in the console / API.',
    fields: VIRTUAL_MACHINE_FIELDS,
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

    if (value !== null && value !== undefined && !isUnknown(value))
      setPath(spec, field.path, toSpecValue(field.attribute, value));
  }

  return { ok: true, spec };
}

const camelCase = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** A Terraform value of an attribute in its spec form: nested objects get camelCase keys, null values are left out. */
export function toSpecValue(attribute: AttributeSchema, value: TfValue): unknown {
  const nested = attribute.nested;

  if (!nested || value === null || isUnknown(value)) return value;

  const one = (item: TfValue): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || isUnknown(item)) return item;

    const out: Record<string, unknown> = {};

    for (const a of nested.attributes) {
      const v = (item as TfObject)[a.name];

      if (v !== null && v !== undefined && !isUnknown(v)) out[camelCase(a.name)] = toSpecValue(a, v);
    }

    return out;
  };

  return nested.nesting === 'list' && Array.isArray(value) ? value.map(one) : one(value);
}

/** A spec value as the Terraform value of an attribute (nested: every attribute present, null when absent). */
export function fromSpecValue(attribute: AttributeSchema, value: unknown): TfValue {
  if (value === undefined || value === null) return null;

  const nested = attribute.nested;

  if (!nested) return attribute.type === 'string' && typeof value === 'number' ? String(value) : (value as TfValue);

  const one = (item: unknown): TfValue => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    return Object.fromEntries(
      nested.attributes.map((a) => [a.name, fromSpecValue(a, (item as Record<string, unknown>)[camelCase(a.name)])]),
    );
  };

  if (nested.nesting === 'list') return Array.isArray(value) ? value.map(one) : null;

  return one(value);
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

  for (const field of def.fields)
    next[field.attribute.name] = fromSpecValue(field.attribute, getPath(serverSpec, field.path));

  // Typed attributes keep their configured form while they mean what is stored: optional attributes the
  // configuration leaves out but the server fills with a default stay null, nested objects keep their nulls.
  const normalizedPrior = documentFromState(def, prior);

  if (normalizedPrior.ok) {
    const validated = validateDocument(normalizedPrior.resource);
    const priorSpec = validated.resource ? ((validated.resource.spec ?? {}) as Record<string, unknown>) : null;

    if (priorSpec)
      for (const field of def.fields)
        if (!field.attribute.computed && deepEqual(getPath(priorSpec, field.path), getPath(serverSpec, field.path)))
          next[field.attribute.name] = prior[field.attribute.name] ?? null;
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
