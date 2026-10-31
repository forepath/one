import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { parseAllDocuments } from 'yaml';
import {
  parseResourceDocuments,
  stringifyResourceDocuments,
  type Resource,
} from '@forepath/loadweaver/shared/util-model';

import type { GitCommitState } from '../entities/git.entity';
import type { PlanStatus } from '../entities/plan.entity';
import { canonicalJson } from '../utils/canonical-json.utils';

/** Kinds Git never deletes: the cluster resource and joined nodes (they leave by draining). */
export const UNDELETABLE_KINDS: ReadonlySet<string> = new Set(['Cluster', 'Node']);

/** The access document of a scope (memberships from Git, 3.29). */
export const ACCESS_FILE = 'access.yaml';

export function resourceKey(kind: string, project: string | null | undefined, name: string): string {
  return `${kind}/${project ?? ''}/${name}`;
}

/** The scope a connection carries (3.29 scope rule). */
export interface ConnectionScope {
  /** null = the cluster connection. */
  project: string | null;
  /** Projects that have their own connection (the cluster connection doesn't carry them). */
  ownConnections: ReadonlySet<string>;
}

/**
 * A project connection carries only that project's resources; the cluster connection carries cluster-level resources
 * and the resources of projects without their own connection.
 */
export function inScope(resource: { project: string | null | undefined }, scope: ConnectionScope): boolean {
  const project = resource.project ?? null;

  return scope.project !== null ? project === scope.project : project === null || !scope.ownConnections.has(project);
}

export interface GitResource {
  resource: Resource;
  path: string;
}

/** Parses the resource files of a commit; duplicates across files and invalid documents are issues. */
export function collectGitResources(files: readonly { path: string; text: string }[]): {
  resources: GitResource[];
  issues: string[];
} {
  const resources: GitResource[] = [];
  const issues: string[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const parsed = parseResourceDocuments(file.text);

    if (parsed.ok === false) {
      issues.push(
        ...parsed.issues
          .slice(0, 10)
          .map((i) => `${file.path} (document ${i.document + 1})${i.path ? ` ${i.path}` : ''}: ${i.message}`),
      );
      continue;
    }

    for (const resource of parsed.resources) {
      const key = resourceKey(resource.kind, resource.metadata.project, resource.metadata.name);
      const other = seen.get(key);

      if (other) {
        issues.push(`${file.path}: ${key} is also defined in ${other}`);
        continue;
      }

      seen.set(key, file.path);
      resources.push({ resource, path: file.path });
    }
  }

  return { resources, issues };
}

/** Stored body of a resource row and of a (normalized) resource, comparable with `canonicalJson`. */
export function bodyOf(resource: Resource): Record<string, unknown> {
  return {
    labels: resource.metadata.labels ?? {},
    annotations: resource.metadata.annotations ?? {},
    spec: resource.spec,
  };
}

export interface ClusterRow {
  kind: string;
  name: string;
  project: string | null;
  generation: number;
  body: Record<string, unknown>;
}

export interface SyncStateRow {
  kind: string;
  projectKey: string;
  name: string;
  path: string;
  generation: number;
}

export interface GitDiff {
  /** Resources that are new or differ from the cluster. */
  changed: GitResource[];
  /** Resources identical in Git and the cluster. */
  unchanged: GitResource[];
  /** Resources of the scope missing in Git. */
  deletions: ClusterRow[];
  /** `git-conflict` plan warnings: resources changed outside Git since the last sync. */
  conflicts: Record<string, unknown>[];
}

/**
 * Compares a commit's resources (normalized, in scope) with the scope's resources in the cluster. A connected scope's
 * Git content is complete: what is missing is a deletion (never the cluster resource or nodes). A resource changed
 * outside Git since the last sync (its generation moved, or it appeared without ever being in Git) is a conflict.
 */
export function diffAgainstCluster(
  git: readonly GitResource[],
  cluster: readonly ClusterRow[],
  states: readonly SyncStateRow[],
): GitDiff {
  const rows = new Map(cluster.map((r) => [resourceKey(r.kind, r.project, r.name), r]));
  const synced = new Map(states.map((s) => [resourceKey(s.kind, s.projectKey || null, s.name), s]));
  const everSynced = states.length > 0;
  const inGit = new Set<string>();
  const diff: GitDiff = { changed: [], unchanged: [], deletions: [], conflicts: [] };
  const conflict = (row: ClusterRow, message: string) =>
    diff.conflicts.push({
      level: 'warning',
      path: 'git-conflict',
      kind: row.kind,
      name: row.name,
      ...(row.project ? { project: row.project } : {}),
      message: `${row.kind} ${row.project ? `${row.project}/` : ''}${row.name} ${message}`,
    });
  const changedOutside = (row: ClusterRow, key: string): boolean => {
    const state = synced.get(key);

    return state ? state.generation !== row.generation : everSynced;
  };

  for (const entry of git) {
    const key = resourceKey(entry.resource.kind, entry.resource.metadata.project, entry.resource.metadata.name);
    const row = rows.get(key);

    inGit.add(key);

    if (row && canonicalJson(row.body) === canonicalJson(bodyOf(entry.resource))) {
      diff.unchanged.push(entry);
      continue;
    }

    diff.changed.push(entry);

    if (row && changedOutside(row, key))
      conflict(row, 'was changed outside Git since the last sync; this plan overwrites that change with Git');
  }

  for (const row of cluster) {
    const key = resourceKey(row.kind, row.project, row.name);

    if (inGit.has(key) || UNDELETABLE_KINDS.has(row.kind)) continue;

    diff.deletions.push(row);

    if (changedOutside(row, key))
      conflict(
        row,
        'is missing in Git but was created or changed outside Git since the last sync; this plan deletes it',
      );
  }

  return diff;
}

/** Where a commit stands, from its plan. */
export function commitStateOf(status: PlanStatus, approved: boolean): GitCommitState {
  switch (status) {
    case 'pending':
      return approved ? 'approved' : 'pending';
    case 'applying':
    case 'rolling-back':
      return 'applying';
    case 'applied':
      return 'applied';
    case 'discarded':
      return 'discarded';
    default:
      return 'failed';
  }
}

export type CommitStatusState = 'pending' | 'success' | 'failure' | 'error';

/** The `loadweaver/plan` commit status of a commit state. */
export function commitStatusOf(
  state: GitCommitState,
  planId: string | null,
  reason?: string | null,
): { state: CommitStatusState; description: string } {
  const plan = planId ? `plan ${planId.slice(0, 8)}` : 'no plan';
  const short = (text: string) => (text.length > 130 ? `${text.slice(0, 127)}...` : text);

  switch (state) {
    case 'pending':
      return { state: 'pending', description: `${plan} waits for approval / apply` };
    case 'approved':
      return { state: 'pending', description: `${plan} approved, waits for apply` };
    case 'applying':
      return { state: 'pending', description: `${plan} is applying` };
    case 'applied':
      return { state: 'success', description: `${plan} applied` };
    case 'no-changes':
      return { state: 'success', description: 'no changes: the cluster matches this commit' };
    case 'synced':
      return { state: 'success', description: 'written by Loadweaver' };
    case 'discarded':
      return { state: 'error', description: `${plan} was discarded` };
    case 'rejected':
      return { state: 'failure', description: short(`rejected: ${reason ?? 'push rejected'}`) };
    default:
      return { state: 'failure', description: short(reason ? `failed: ${reason}` : `${plan} failed`) };
  }
}

/**
 * Replaces (or removes, `resource` null) one resource's document in a multi-document YAML file; the other documents
 * keep their text and comments. Returns null when the file has no documents left.
 */
export function replaceResourceDocument(text: string, key: string, resource: Resource | null): string | null {
  const parsed = text.trim() ? parseAllDocuments(text) : [];
  const docs = Array.isArray(parsed) ? parsed : [];
  const out: string[] = [];
  let replaced = false;

  for (const doc of docs) {
    const value = doc.toJS({ maxAliasCount: 50 }) as Partial<Resource> | null;

    if (value === null || value === undefined) continue;

    const docKey =
      value && typeof value === 'object' && value.kind && value.metadata
        ? resourceKey(value.kind, value.metadata.project, value.metadata.name)
        : null;

    if (docKey === key) {
      if (resource && !replaced) out.push(stringifyResourceDocuments([resource]));

      replaced = true;
      continue;
    }

    out.push(doc.toString({ lineWidth: 0 }).replace(/^---\s*\n/, ''));
  }

  if (!replaced && resource) out.push(stringifyResourceDocuments([resource]));

  if (out.length === 0) return null;

  return out.map((d) => (d.endsWith('\n') ? d : `${d}\n`)).join('---\n');
}

/**
 * The webhook secret of a connection: HKDF from `ENCRYPTION_KEY`, the connection id and its rotatable salt (a new
 * random salt revokes a leaked secret); nothing secret is stored. A null salt is the original derivation.
 */
export function webhookSecret(encryptionKey: string, connectionId: string, salt: string | null = null): string {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(encryptionKey, 'utf8'),
      Buffer.alloc(0),
      `loadweaver/git-webhook/${connectionId}${salt ? `/${salt}` : ''}`,
      32,
    ),
  ).toString('hex');
}

/** A fresh webhook salt (rotation, new connections). */
export function newWebhookSalt(): string {
  return randomBytes(24).toString('hex');
}

/** The provider's delivery id of a webhook (GitHub / Gitea `X-*-Delivery`, GitLab `X-Gitlab-Event-UUID`). */
export function webhookDeliveryId(headers: Record<string, string | string[] | undefined>): string | null {
  for (const name of ['x-github-delivery', 'x-gitea-delivery', 'x-gogs-delivery', 'x-gitlab-event-uuid']) {
    const value = headers[name];
    const id = (Array.isArray(value) ? value[0] : value)?.trim();

    if (id && /^[A-Za-z0-9._:-]{1,128}$/.test(id)) return id;
  }

  return null;
}

/**
 * Whether a delivery is about the connection's repository (GitHub / Gitea `repository.full_name`, GitLab
 * `project.path_with_namespace`, case-insensitive). Deliveries for another repository (a webhook secret reused on
 * several repositories, a misconfigured hook) are ignored; deliveries without the field only for plain Git.
 */
export function payloadMatchesRepo(provider: string, payload: unknown, repo: string): boolean {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    repository?: { full_name?: unknown };
    project?: { path_with_namespace?: unknown };
  };
  const name =
    provider === 'gitlab'
      ? (p.project?.path_with_namespace ?? null)
      : (p.repository?.full_name ?? p.project?.path_with_namespace ?? null);

  if (typeof name !== 'string') return provider === 'git';

  return name.toLowerCase() === repo.toLowerCase();
}

/** Provider user ids of a push (GitHub / Gitea `sender.id`, GitLab `user_id`) and the new head, if present. */
export function pushSender(payload: unknown): { userIds: string[]; after: string | null } {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    sender?: { id?: unknown };
    user_id?: unknown;
    after?: unknown;
    checkout_sha?: unknown;
  };
  const ids = [p.sender?.id, p.user_id]
    .filter((v) => typeof v === 'number' || typeof v === 'string')
    .map(String)
    .filter((v) => /^\d{1,20}$/.test(v));
  const after = [p.after, p.checkout_sha].find((v) => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v));

  return { userIds: [...new Set(ids)], after: (after as string | undefined) ?? null };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');

  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verifies a webhook delivery (constant time): GitHub / Gitea `X-Hub-Signature-256: sha256=<hmac>`, Gitea
 * `X-Gitea-Signature: <hmac>`, GitLab `X-Gitlab-Token: <secret>`.
 */
export function verifyWebhook(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  secret: string,
): boolean {
  const header = (name: string) => {
    const value = headers[name.toLowerCase()];

    return Array.isArray(value) ? value[0] : value;
  };
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  const hub = header('x-hub-signature-256');

  if (hub) return safeEqual(hub.trim().toLowerCase(), `sha256=${hmac}`);

  const gitea = header('x-gitea-signature');

  if (gitea) return safeEqual(gitea.trim().toLowerCase(), hmac);

  const gitlab = header('x-gitlab-token');

  if (gitlab) return safeEqual(gitlab, secret);

  return false;
}

export type WebhookEvent =
  | { kind: 'push'; branch: string | null }
  | { kind: 'pull-request' }
  | { kind: 'comment' }
  | { kind: 'ping' }
  | { kind: 'other' };

/** The provider's event name of a delivery (lower case): `push`, `pull_request`, `issue_comment`, `note hook`, ... */
export function webhookEventName(headers: Record<string, string | string[] | undefined>): string {
  const header = (name: string) => {
    const value = headers[name];

    return (Array.isArray(value) ? value[0] : value)?.toLowerCase() ?? '';
  };

  return header('x-github-event') || header('x-gitea-event') || header('x-gogs-event') || header('x-gitlab-event');
}

/** What a (verified) delivery is about. */
export function webhookEvent(headers: Record<string, string | string[] | undefined>, payload: unknown): WebhookEvent {
  const event = webhookEventName(headers);
  const ref = payload && typeof payload === 'object' ? (payload as { ref?: unknown }).ref : undefined;
  const branch = typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;

  if (event === 'push' || event === 'push hook') return { kind: 'push', branch };

  if (event === 'pull_request' || event === 'merge request hook') return { kind: 'pull-request' };

  if (event === 'issue_comment' || event === 'note hook') return { kind: 'comment' };

  if (event === 'ping' || event === 'system hook') return { kind: 'ping' };

  return { kind: 'other' };
}

/**
 * `loadweaver plan <project|path>` (3.30): only the changes and deletions of one project, or of files below one path
 * (deletions by the file they were synced from).
 */
export function limitDiff(
  diff: GitDiff,
  states: readonly SyncStateRow[],
  limit?: { project?: string; path?: string },
): GitDiff {
  if (!limit?.project && !limit?.path) return diff;

  const below = (file: string | undefined) =>
    !!file && !!limit.path && (file === limit.path || file.startsWith(`${limit.path}/`));
  const statePath = (d: ClusterRow) =>
    states.find((s) => s.kind === d.kind && s.name === d.name && (s.projectKey || null) === d.project)?.path;

  const changed = diff.changed.filter((r) =>
    limit.project ? (r.resource.metadata.project ?? null) === limit.project : below(r.path),
  );
  const deletions = diff.deletions.filter((d) => (limit.project ? d.project === limit.project : below(statePath(d))));
  const kept = new Set([
    ...changed.map((r) => resourceKey(r.resource.kind, r.resource.metadata.project, r.resource.metadata.name)),
    ...deletions.map((d) => resourceKey(d.kind, d.project, d.name)),
  ]);

  return {
    changed,
    unchanged: diff.unchanged,
    deletions,
    conflicts: diff.conflicts.filter((c) =>
      kept.has(resourceKey(String(c['kind']), (c['project'] as string | undefined) ?? null, String(c['name']))),
    ),
  };
}

/** Where plans are linked in the console: `LOADWEAVER_CONSOLE_URL`, else `LOADWEAVER_PUBLIC_URL`; null without. */
export function consoleBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env['LOADWEAVER_CONSOLE_URL'] || env['LOADWEAVER_PUBLIC_URL'] || '').trim().replace(/\/+$/, '');

  return /^https?:\/\/[^\s]+$/.test(url) ? url : null;
}

/**
 * Commit subject / pull request title of a plan written to Git (3.29); a plan submitted from a Workspace draft (3.36)
 * leads with the draft's title so reviewers see what it is about.
 */
export function planGitTitle(
  plan: { id: string; source?: { draft?: { id: string; title: string } } | null },
  author: string,
  short = false,
): string {
  const id = short ? plan.id.slice(0, 8) : plan.id;
  const base = `Loadweaver plan ${id} by ${author}`;
  const draft = plan.source?.draft?.title?.replace(/\s+/g, ' ').trim();

  return draft ? `${draft} (${base})` : base;
}
