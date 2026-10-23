import { isMap, parseDocument, stringify } from 'yaml';

import type { ConsoleResource, JsonSchema, JsonSchemaIssue, ResourceKey } from '../types/resources.types';
import { checkJsonSchema, hasOwnKey } from './json-schema';

/** `apiVersion` of every Loadweaver resource. */
export const LOADWEAVER_API_VERSION = 'loadweaver.com/v1';

/** RFC 1123 label: resource, project and node names. */
export const RESOURCE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A resource as the YAML the editor, Git and the export use (`apiVersion`, `kind`, `metadata`, `spec`). */
export function resourceToYaml(resource: ConsoleResource<unknown>): string {
  return stringify(
    { apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata, spec: resource.spec },
    { lineWidth: 0 },
  );
}

const STARTER_SPECS: Record<string, Record<string, unknown>> = {
  Deployment: {
    compose: 'services:\n  web:\n    image: nginx:1.27\n',
  },
  WorkloadGroup: { selector: { matchLabels: { app: 'web' } }, exposed: false },
  Policy: {
    mode: 'enforce',
    action: 'allow',
    from: [{ builtin: 'internet' }],
    to: [{ group: 'web' }],
    rules: [{ protocol: 'tcp', ports: [443] }],
  },
  DnsRecord: { zone: 'example', name: 'www', type: 'A', values: ['203.0.113.10'] },
  // Full VM (3.35): an OCI VM image of the project, boot disk from the image, one NIC.
  VirtualMachine: {
    image: 'registry.lw/<project>/debian-13:latest',
    cpu: { vcpus: 2 },
    memory: '4Gi',
    disks: [{ name: 'root', size: '20Gi', source: 'image' }],
    nics: [{ name: 'eth0', groups: [] }],
    runStrategy: 'Always',
    cloudInit: { sshAuthorizedKeys: [] },
  },
  // Backups (3.20): hourly 24 / daily 14 / monthly 12, a nightly restore test.
  BackupPolicy: {
    selector: { deployments: { matchLabels: { tier: 'critical' } } },
    schedules: ['0 * * * *'],
    timeZone: 'UTC',
    retention: { keepLast: 3, hourly: 24, daily: 14, weekly: 0, monthly: 12, yearly: 0 },
    targets: [],
    hooks: true,
    restoreTest: { schedule: '30 3 * * *' },
  },
  BackupTarget: {
    type: 's3',
    endpoint: 'https://s3.example.com',
    bucket: 'loadweaver-backups',
    region: 'us-east-1',
    prefix: '',
    credentials: 'secret://ops/offsite-s3',
    objectLock: { mode: 'COMPLIANCE', days: 30 },
  },
};

function starterSpec(kind: string, project?: string | null): Record<string, unknown> {
  const spec = STARTER_SPECS[kind] ?? {};

  if (kind !== 'VirtualMachine') return spec;

  return { ...spec, image: String(spec['image']).replace('<project>', project || 'my-project') };
}

/** A starting point for a new resource of a kind: envelope, a placeholder name and a few spec fields for common kinds. */
export function resourceTemplate(kind: string, project?: string | null): string {
  const name = `new-${kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`.slice(0, 63);

  return stringify(
    {
      apiVersion: LOADWEAVER_API_VERSION,
      kind,
      metadata: project ? { name, project } : { name },
      spec: starterSpec(kind, project),
    },
    { lineWidth: 0 },
  );
}

/** What a resource's YAML text declares, or null when it doesn't parse into a resource head. */
export function resourceKeyOf(text: string): ResourceKey | null {
  const doc = parseDocument(text);

  if (doc.errors.length > 0) return null;

  const value = doc.toJS() as unknown;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { kind, metadata } = value as { kind?: unknown; metadata?: { name?: unknown; project?: unknown } };

  if (typeof kind !== 'string' || typeof metadata?.name !== 'string') return null;

  return { kind, name: metadata.name, project: typeof metadata.project === 'string' ? metadata.project : null };
}

/** `spec.compose` of a Deployment's YAML text (null when absent or the text doesn't parse). */
export function composeOf(text: string): string | null {
  const doc = parseDocument(text);

  if (doc.errors.length > 0) return null;

  const compose = doc.getIn(['spec', 'compose']);

  return typeof compose === 'string' ? compose : null;
}

/** Sets `spec.compose` in a Deployment's YAML text (other content and comments stay); null when it doesn't parse. */
export function withCompose(text: string, compose: string): string | null {
  const doc = parseDocument(text);

  if (doc.errors.length > 0 || !isMap(doc.contents)) return null;

  doc.setIn(['spec', 'compose'], compose);

  return doc.toString({ lineWidth: 0 });
}

/**
 * Checks a parsed resource document against the published JSON Schema of its `kind`. Without a schema for the kind
 * yet (still loading) only the envelope is checked; an unknown kind is reported on `kind`.
 */
export function checkResourceDocument(
  document: unknown,
  schemas: Record<string, JsonSchema>,
  knownKinds: readonly string[],
): JsonSchemaIssue[] {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return [{ path: [], message: 'must be a resource (apiVersion, kind, metadata, spec)' }];
  }

  const kind = (document as { kind?: unknown }).kind;

  if (typeof kind !== 'string') return [{ path: [], message: 'missing property "kind"' }];

  const schema = hasOwnKey(schemas, kind) ? schemas[kind] : undefined;

  if (schema !== undefined) return checkJsonSchema(schema, document);

  if (knownKinds.length > 0 && !knownKinds.includes(kind)) {
    return [{ path: ['kind'], message: `unknown kind "${kind}" (one of ${knownKinds.join(', ')})` }];
  }

  return [];
}

/** Compose files: a `services` mapping, each service with an image (builds aren't supported; the server checks the rest). */
export function checkComposeDocument(document: unknown): JsonSchemaIssue[] {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return [{ path: [], message: 'must be a compose file (a mapping with services)' }];
  }

  const services = (document as { services?: unknown }).services;

  if (typeof services !== 'object' || services === null || Array.isArray(services)) {
    return [{ path: [], message: 'missing property "services"' }];
  }

  return Object.entries(services as Record<string, unknown>).flatMap(([name, service]) =>
    typeof service !== 'object' || service === null
      ? [{ path: ['services', name], message: 'must be a service definition' }]
      : !('image' in service)
        ? [{ path: ['services', name], message: 'missing property "image" (build is not supported)' }]
        : [],
  );
}
