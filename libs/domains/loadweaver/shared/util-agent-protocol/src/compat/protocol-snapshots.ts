import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { JsonSchema, JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';
import { z } from 'zod';

import { AGENT_TO_CONTROL_PLANE, CONTROL_PLANE_TO_AGENT } from '../lib/messages';
import { PROTOCOL_VERSION, type FieldGates, type MessageGates } from '../lib/versioning';

/**
 * Frozen agent-protocol schemas (3.26): on every release the current message schemas are written as JSON Schema
 * to `src/compat/v<PROTOCOL_VERSION>/` (see the README). The contract tests check the current control plane
 * against the latest snapshot, the protocol of the N-1 agents it must still serve. Test-only: not exported from the
 * library (it reads the snapshots from the source tree).
 */

export type ProtocolDirection = 'control-plane-to-agent' | 'agent-to-control-plane';

export const PROTOCOL_DIRECTIONS: readonly ProtocolDirection[] = ['control-plane-to-agent', 'agent-to-control-plane'];

export interface ProtocolSnapshot {
  protocolVersion: number;
  direction: ProtocolDirection;
  /** Message type → JSON Schema (draft 2020-12) of the payload the receiver accepts. */
  messages: Record<string, JsonSchemaObject>;
}

export const COMPAT_DIR = __dirname;

export function snapshotFile(version: number, direction: ProtocolDirection): string {
  return join(COMPAT_DIR, `v${version}`, `${direction}.json`);
}

/** The current schemas as a snapshot (what the receiver of each direction parses: zod input). */
export function currentSnapshot(direction: ProtocolDirection): ProtocolSnapshot {
  const catalog: Record<string, z.ZodType> =
    direction === 'control-plane-to-agent' ? CONTROL_PLANE_TO_AGENT : AGENT_TO_CONTROL_PLANE;
  const messages: Record<string, JsonSchemaObject> = {};

  for (const type of Object.keys(catalog).sort()) {
    messages[type] = z.toJSONSchema(catalog[type], {
      io: 'input',
      unrepresentable: 'any',
      target: 'draft-2020-12',
      // JSON Schema patterns have no flags: drop patterns of regexes with flags (e.g. `/i`) rather than freezing a
      // stricter schema than the agent really applies.
      override: (ctx) => {
        const checks = (ctx.zodSchema as { _zod?: { def?: { checks?: { _zod?: { def?: { pattern?: unknown } } }[] } } })
          ._zod?.def?.checks;
        const flagged = (checks ?? []).some((c) => {
          const pattern = c._zod?.def?.pattern;

          return pattern instanceof RegExp && pattern.flags.replace(/[gu]/g, '') !== '';
        });

        if (flagged) delete ctx.jsonSchema['pattern'];
      },
    }) as JsonSchemaObject;
  }

  return { protocolVersion: PROTOCOL_VERSION, direction, messages };
}

/** Protocol versions with a frozen snapshot, ascending. */
export function frozenVersions(): number[] {
  return readdirSync(COMPAT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
    .map((d) => Number(d.name.slice(1)))
    .sort((a, b) => a - b);
}

export function loadSnapshot(version: number, direction: ProtocolDirection): ProtocolSnapshot {
  const file = snapshotFile(version, direction);

  if (!existsSync(file)) throw new Error(`no frozen agent-protocol snapshot ${file}`);

  return JSON.parse(readFileSync(file, 'utf8')) as ProtocolSnapshot;
}

interface PathInfo {
  required: boolean;
  /** JSON-encoded `enum` / `const` values seen at the path (discriminated-union tags included). */
  values: Set<string> | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema | null {
  if (!ref.startsWith('#')) return null;

  let node: unknown = root;

  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const part = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');

    if (!isObject(node) || !(part in node)) return null;

    node = node[part];
  }

  return typeof node === 'boolean' || isObject(node) ? (node as JsonSchema) : null;
}

/**
 * Flattens a message schema into its field paths, in the gate path syntax (`a.b`, `list[].c`, `record.*.d`; the
 * payload root is `''`), with whether the field is required and which literal values it allows.
 */
export function schemaPaths(schema: JsonSchema): Map<string, PathInfo> {
  const out = new Map<string, PathInfo>();
  const info = (path: string): PathInfo => {
    let entry = out.get(path);

    if (!entry) {
      entry = { required: false, values: null };
      out.set(path, entry);
    }

    return entry;
  };

  const walk = (node: JsonSchema, path: string, refs: ReadonlySet<string>): void => {
    if (!isObject(node)) return;

    if (typeof node['$ref'] === 'string' && !refs.has(node['$ref'])) {
      const target = resolveRef(schema, node['$ref']);

      if (target !== null) walk(target, path, new Set([...refs, node['$ref']]));
    }

    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (Array.isArray(node[key])) for (const branch of node[key] as JsonSchema[]) walk(branch, path, refs);
    }

    const literals = [
      ...(Array.isArray(node['enum']) ? node['enum'] : []),
      ...('const' in node ? [node['const']] : []),
    ];

    if (literals.length > 0) {
      const entry = info(path);

      entry.values ??= new Set();
      literals.forEach((v) => entry.values?.add(JSON.stringify(v)));
    }

    if (isObject(node['properties'])) {
      const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);

      for (const [key, sub] of Object.entries(node['properties'])) {
        const child = path ? `${path}.${key}` : key;
        const entry = info(child);

        entry.required ||= required.has(key);
        walk(sub as JsonSchema, child, refs);
      }
    }

    if (isObject(node['additionalProperties'])) walk(node['additionalProperties'] as JsonSchema, `${path}.*`, refs);

    if (isObject(node['items'])) walk(node['items'] as JsonSchema, `${path}[]`, refs);

    if (Array.isArray(node['prefixItems']))
      for (const item of node['prefixItems'] as JsonSchema[]) walk(item, `${path}[]`, refs);
  };

  walk(schema, '', new Set());
  out.delete('');

  return out;
}

/** Whether `path` lies below a path in `set` (so only the topmost change is reported). */
function underAny(path: string, set: ReadonlySet<string>): boolean {
  for (const other of set) {
    if (path !== other && (path.startsWith(`${other}.`) || path.startsWith(`${other}[]`))) return true;
  }

  return false;
}

/**
 * The incompatibilities between the frozen N-1 protocol (`previous`) and the current one (3.26):
 * - control plane → agent (the N-1 agent parses strictly): every new field must be gated (`gates`), every new
 *   message type too (`messageGates`), no field the N-1 agent requires may become optional or disappear, and no
 *   literal value may be added (old agents reject it);
 * - agent → control plane (the N-1 agent sends): no field or message type an N-1 agent sends may disappear, new
 *   fields must be optional, and no literal value may be removed.
 * Returns human-readable findings; empty means compatible.
 */
export function protocolIncompatibilities(
  previous: ProtocolSnapshot,
  current: ProtocolSnapshot,
  gates: FieldGates,
  messageGates: MessageGates = {},
): string[] {
  const findings: string[] = [];
  const toAgent = current.direction === 'control-plane-to-agent';

  for (const type of Object.keys(previous.messages)) {
    if (!(type in current.messages)) findings.push(`${type}: message type removed`);
  }

  for (const [type, schema] of Object.entries(current.messages)) {
    const old = previous.messages[type];

    if (!old) {
      // An N-1 agent rejects an unknown message type; a new agent → control-plane type is harmless.
      if (toAgent && !messageGates[type as keyof MessageGates])
        findings.push(`${type}: new message type an N-1 agent doesn't know (CONTROL_PLANE_MESSAGE_GATES)`);

      continue;
    }

    const before = schemaPaths(old);
    const after = schemaPaths(schema);
    const added = new Set([...after.keys()].filter((p) => !before.has(p)));
    const removed = new Set([...before.keys()].filter((p) => !after.has(p)));
    const gated = new Set((gates[type as keyof FieldGates] ?? []).map((g) => g.path));

    for (const path of added) {
      if (underAny(path, added)) continue;

      if (toAgent && !gated.has(path))
        findings.push(`${type}.${path}: new field without a feature gate (CONTROL_PLANE_FIELD_GATES)`);

      if (!toAgent && after.get(path)?.required)
        findings.push(`${type}.${path}: new required field an N-1 agent doesn't send`);
    }

    for (const path of removed) {
      if (underAny(path, removed)) continue;

      if (!toAgent || before.get(path)?.required)
        findings.push(`${type}.${path}: field removed although an N-1 agent ${toAgent ? 'requires' : 'sends'} it`);
    }

    for (const [path, was] of before) {
      const now = after.get(path);

      if (!now) continue;

      if (toAgent && was.required && !now.required)
        findings.push(`${type}.${path}: required by an N-1 agent but optional now`);

      if (was.values && now.values) {
        const [from, to] = toAgent ? [was.values, now.values] : [now.values, was.values];
        const extra = [...to].filter((v) => !from.has(v));

        if (extra.length > 0)
          findings.push(
            toAgent
              ? `${type}.${path}: new value(s) ${extra.join(', ')} an N-1 agent rejects`
              : `${type}.${path}: value(s) ${extra.join(', ')} an N-1 agent may send are no longer accepted`,
          );
      }
    }
  }

  return findings;
}
