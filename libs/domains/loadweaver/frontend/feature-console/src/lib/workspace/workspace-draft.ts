import type {
  ConsoleResource,
  Draft,
  DraftOp,
  JsonSchema,
  ResourceKey,
  TopologyChange,
} from '@forepath/loadweaver/frontend/data-access-console';
import { parse, parseDocument, stringify } from 'yaml';

import { workspaceResourceId, type WorkspaceItem } from './workspace-model';

/**
 * Workspace drafts in the console (3.36): pure helpers between the draft's ops, the declared resources, the model and
 * the editors (YAML + forms generated from `GET /schemas/{kind}`).
 */

export const API_VERSION = 'loadweaver.com/v1';

/** `Kind/project/name` (empty project for cluster-level kinds), as the API keys ops. */
export function draftOpKey(ref: ResourceKey): string {
  return `${ref.kind}/${ref.project ?? ''}/${ref.name}`;
}

/** The op of a resource in the draft, if any. */
export function draftOpOf(draft: Draft | null, ref: ResourceKey | null): DraftOp | null {
  if (!draft || !ref) return null;

  const key = draftOpKey(ref);

  return draft.ops.find((o) => draftOpKey(o) === key) ?? null;
}

/**
 * The declared resources as the draft would leave them: upserts replace / add their resource, deletions stay (they
 * are marked, not hidden, so the map can show what goes away).
 */
export function draftResources(
  resources: readonly ConsoleResource<unknown>[],
  draft: Draft | null,
): ConsoleResource<unknown>[] {
  if (!draft || draft.ops.length === 0) return [...resources];

  const byKey = new Map(
    resources.map((r) => [draftOpKey({ kind: r.kind, name: r.metadata.name, project: r.metadata.project ?? null }), r]),
  );

  for (const op of draft.ops) {
    if (op.op !== 'upsert' || !op.document) continue;

    try {
      const parsed = parse(op.document) as ConsoleResource<unknown> | null;

      if (parsed && typeof parsed === 'object' && parsed.kind && parsed.metadata?.name)
        byKey.set(draftOpKey(op), { ...parsed, spec: parsed.spec ?? {} });
    } catch {
      // An unparsable document stays in the draft (the editor shows its errors); the map keeps the current state.
    }
  }

  return [...byKey.values()];
}

/** What the draft does to each item (before a preview): created / updated / deleted resources. */
export function draftChanges(draft: Draft | null, existing: ReadonlySet<string>): Record<string, TopologyChange> {
  const out: Record<string, TopologyChange> = {};

  for (const op of draft?.ops ?? []) {
    const id = workspaceResourceId(op);

    out[id] = op.op === 'delete' ? 'delete' : existing.has(draftOpKey(op)) ? 'update' : 'create';
  }

  return out;
}

/** The YAML document of an item's resource (the draft's version if the draft changes it). */
export function resourceDocument(item: WorkspaceItem, draft: Draft | null = null): string | null {
  const op = draftOpOf(draft, item.resource);

  if (op?.op === 'upsert' && op.document) return op.document;

  if (!item.resource) return null;

  const labels = item.data['labels'] as Record<string, string> | undefined;

  return stringify(
    {
      apiVersion: API_VERSION,
      kind: item.resource.kind,
      metadata: {
        name: item.resource.name,
        ...(item.resource.project ? { project: item.resource.project } : {}),
        ...(labels && Object.keys(labels).length ? { labels } : {}),
      },
      spec: (item.data['spec'] as Record<string, unknown> | undefined) ?? {},
    },
    { lineWidth: 0 },
  );
}

/** A new resource's starting document (palette create): name, project, the kind's required spec fields empty. */
export function newResourceDocument(
  kind: string,
  name: string,
  project: string | null,
  schema: JsonSchema | null = null,
  spec: Record<string, unknown> = {},
): string {
  const fields = schemaFormFields(schema).filter((f) => f.required && !(f.path[0] in spec));
  const defaults = Object.fromEntries(
    fields.map((f) => [f.path[0], f.type === 'boolean' ? false : f.type === 'number' ? 0 : (f.options?.[0] ?? '')]),
  );

  return stringify(
    {
      apiVersion: API_VERSION,
      kind,
      metadata: { name, ...(project ? { project } : {}) },
      spec: { ...defaults, ...spec },
    },
    { lineWidth: 0 },
  );
}

/** The resource key a YAML document declares (null if it doesn't parse into one). */
export function documentRef(document: string): ResourceKey | null {
  try {
    const parsed = parse(document) as Partial<ConsoleResource<unknown>> | null;

    if (!parsed?.kind || !parsed.metadata?.name) return null;

    return { kind: parsed.kind, name: parsed.metadata.name, project: parsed.metadata.project ?? null };
  } catch {
    return null;
  }
}

/** One generated form field: a scalar of the spec (top level or one object deep). */
export interface SchemaFormField {
  path: string[];
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options?: string[];
  required: boolean;
  description?: string;
}

type SchemaObject = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  description?: string;
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  default?: unknown;
};

function scalarType(s: SchemaObject): SchemaFormField['type'] | null {
  if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === 'string')) return 'enum';

  const types = Array.isArray(s.type) ? s.type.filter((t) => t !== 'null') : [s.type];

  if (types.length !== 1) return null;

  switch (types[0]) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return null;
  }
}

/**
 * Form fields generated from a kind's JSON Schema (3.36): the spec's scalar properties (strings, numbers, booleans,
 * enums), top level and one nested object deep. Lists, maps and deeper structures are edited in the YAML tab.
 */
export function schemaFormFields(schema: JsonSchema | null): SchemaFormField[] {
  if (!schema || typeof schema !== 'object') return [];

  const root = schema as SchemaObject;
  const spec = root.properties?.['spec'] ?? root;
  const fields: SchemaFormField[] = [];
  const walk = (node: SchemaObject, path: string[], depth: number) => {
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const type = scalarType(child);
      const required = (node.required ?? []).includes(key);

      if (type)
        fields.push({
          path: [...path, key],
          label: [...path, key].join('.'),
          type,
          ...(type === 'enum' ? { options: (child.enum as string[]).slice() } : {}),
          required,
          ...(child.description ? { description: child.description } : {}),
        });
      else if (depth < 1 && child.properties) walk(child, [...path, key], depth + 1);
    }
  };

  walk(spec, [], 0);

  return fields;
}

/** A spec field's value in a YAML document. */
export function documentField(document: string, path: readonly string[]): unknown {
  try {
    return parseDocument(document).getIn(['spec', ...path]);
  } catch {
    return undefined;
  }
}

/** Sets (or, with `undefined` / `''`, removes) a spec field, keeping the rest of the document (comments included). */
export function withDocumentField(document: string, path: readonly string[], value: unknown): string {
  const doc = parseDocument(document);

  if (value === undefined || value === '') doc.deleteIn(['spec', ...path]);
  else doc.setIn(['spec', ...path], value);

  return doc.toString({ lineWidth: 0 });
}
