import type { FleetRole } from '../constants/fleet.constants';

import { maxRole, roleAtLeast, roleFor, type FleetClusterAccess } from './fleet-access.utils';

/**
 * Method / path allow-list of the REST relay (3.24): `/clusters/:id/api/<path>` is forwarded only when a rule
 * matches and the caller's grant on the cluster (or on the project in the path / query) reaches the rule's role.
 * Everything else is refused before the request leaves the fleet — the service credential behind the relay is
 * usually far more powerful than the caller.
 *
 * Deliberately not relayed: personal resources of the service user (VPN devices, registry tokens), the node agent's
 * join and the installer endpoints, the cluster's trusted fleets (the trust anchor is native) and public endpoints
 * (the Git account OAuth callback stays on the cluster's public URL). Join tokens are relayed for cluster-wide admins; approvals /
 * acceptances only with a signed identity claim to clusters that verify them (`approval` rules, 2026-10-26); search
 * favourites / recents, saved views and linked Git accounts are personal to the signed fleet person and relayed only
 * with that claim (`own` rules, 2026-10-27 / 2026-10-29). Project secrets are relayed since 2026-10-29 (`secret`
 * rules: always as the signed person), the backup key's recovery kit since 2026-10-30 (re-issue / hand-out / confirm:
 * `secret` rules for cluster-wide admins only, 3.20); Git connections reach project grants as the signed person (3.41).
 * {@link NEVER_RELAYED} enforces the hard exclusions even if a rule matched.
 */
export interface RelayRule {
  methods: readonly string[];
  /** Matched against the normalised path after `/api/`; a named group `project` marks project routes. */
  path: RegExp;
  role: FleetRole;
  /**
   * `path`: the project is the `project` group (project grants apply); `query`: the route filters by `?project=`
   * (project grants apply when it is given); absent: cluster-wide grants only.
   */
  project?: 'path' | 'query';
  /**
   * Query parameters forwarded for `project: 'query'` rules (everything else is refused, so the parameters the
   * cluster reads are exactly the ones the fleet authorised).
   */
  query?: readonly string[];
  /**
   * An approval / acceptance (3.24): relayed only with the caller's signed identity claim to a cluster that verifies
   * this fleet's claims; the cluster checks the person's role and the two-person rules.
   */
  approval?: boolean;
  /**
   * Any grant on the cluster reaches the rule (cluster-wide or a project's): for approvals whose project isn't in the
   * path — the cluster enforces the person's project role from the claim.
   */
  anyGrant?: boolean;
  /**
   * Person-scoped (2026-10-27, fleet cluster view = full parity): callers whose project grants (but no cluster-wide
   * grant) reach the role are relayed too — but only with the signed identity claim to a cluster that verifies it,
   * where the cluster scopes the request to the person's grants (`capRolesToFleetIdentity`). Cluster-wide grants
   * don't need the claim (as before).
   */
  personScoped?: boolean;
  /**
   * Personal to the acting person (2026-10-27, search favourites / recents, saved views): relayed only with the signed
   * identity claim to a verifying cluster, for every grant (cluster-wide too) — the cluster stores them for
   * `fleet:<iss>:<sub>`, never for the fleet's service account.
   */
  personal?: boolean;
  /**
   * Streamed upload (2026-10-27, release bundles): exempt from `FLEET_RELAY_MAX_REQUEST_BYTES`, forwarded without
   * buffering (backpressure, overall timeout, aborted when the caller disconnects); the claim binds the declared
   * length + SHA-256 (`X-Loadweaver-Content-SHA256`) the cluster checks after receipt.
   */
  stream?: boolean;
  /**
   * Project secrets (2026-10-29, user: "secrets management is supposed to work in standalone and fleet mode alike";
   * supersedes "never relayed"): always with the signed identity claim (API-key delegation included), so the cluster
   * applies its own secret rules to the person and audits them as on-behalf-of; the JSON body (the value) is bound
   * into the claim and only streamed through — never logged, stored or audited at the fleet (the fleet audit keeps
   * method, path = project + name, status); the answer is sent with `Cache-Control: no-store`. The backup key's
   * recovery kit (2026-10-30, user: "every function should also be available in fleet mode") uses the same flag:
   * cluster-wide admins only, the shares travel only in the streamed answer / bound body.
   */
  secret?: boolean;
  /**
   * Git account linking (3.41): the JSON body may name the console page the cluster's OAuth callback returns to
   * (`returnUrl`); the fleet forwards it only for one of its own console origins (`FLEET_CONSOLE_URL` /
   * `CORS_ORIGIN`), so the confirmation nonce never leaves for a foreign site.
   */
  consoleReturn?: boolean;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NAME = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const PROJECT = `projects/(?<project>${NAME})`;
/** A secret name in a path (the cluster validates it; this only keeps the segment plain). */
const SECRET_NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,252}';
/** A search item `Kind:key` as one path segment: `:` and `/` arrive percent-encoded (`%3A`, `%2F`). */
const FAVOURITE_ITEM = '[A-Za-z]{1,32}(?::|%3[Aa])(?:[A-Za-z0-9_.:-]|%2[Ff]|%3[Aa]){1,400}';
const GET = ['GET', 'HEAD'] as const;
const POST = ['POST'] as const;

function rule(
  methods: readonly string[],
  pattern: string,
  role: FleetRole,
  project?: 'path' | 'query',
  query?: readonly string[],
): RelayRule {
  return {
    methods,
    path: new RegExp(`^${pattern}$`),
    role,
    ...(project ? { project } : {}),
    ...(query ? { query } : {}),
  };
}

/** A person-scoped rule: project grants reach it through the signed identity claim (see {@link RelayRule}). */
function personal(methods: readonly string[], pattern: string, role: FleetRole): RelayRule {
  return { ...rule(methods, pattern, role), personScoped: true };
}

/** A personal rule: always the signed identity claim (see {@link RelayRule.personal}). */
function own(methods: readonly string[], pattern: string, role: FleetRole): RelayRule {
  return { ...rule(methods, pattern, role), personal: true };
}

/** A personal rule any grant on the cluster reaches (cluster-wide or a project's): linked Git accounts (3.41). */
function ownAnyGrant(methods: readonly string[], pattern: string): RelayRule {
  return { ...own(methods, pattern, 'viewer'), anyGrant: true };
}

/**
 * A read any grant on the cluster reaches (cluster-wide or a project's) that isn't about a project and isn't personal:
 * cluster-wide reference data such as the VM image catalog (3.42).
 */
function anyGrantRead(pattern: string): RelayRule {
  return { ...rule(GET, pattern, 'viewer'), anyGrant: true };
}

/** A project-secret rule: the signed identity is always required (see {@link RelayRule.secret}). */
function secret(
  methods: readonly string[],
  pattern: string,
  project?: 'path' | 'query',
  query?: readonly string[],
): RelayRule {
  return { ...rule(methods, pattern, 'operator', project, query), secret: true };
}

/** An approval rule (3.24): needs the signed identity; `anyGrant` when the project isn't in the path. */
function approval(pattern: string, role: FleetRole, options: { project?: 'path'; anyGrant?: boolean } = {}): RelayRule {
  return {
    ...rule(POST, pattern, role, options.project),
    approval: true,
    ...(options.anyGrant ? { anyGrant: true } : {}),
  };
}

/**
 * Paths that are never relayed for any role, checked before the rules: the node agent's join / installer and the
 * cluster's trusted fleets (the trust anchor of approvals through a fleet). The recovery kit left this list on
 * 2026-10-30 (relayed as `secret` rules for cluster-wide admins, see {@link RELAY_RULES}).
 */
export const NEVER_RELAYED: readonly RegExp[] = [/^nodes\/join$/, /^install(?:\/|$)/, /^trusted-fleets(?:\/|$)/];

export const RELAY_RULES: readonly RelayRule[] = [
  // ------------------------------------------------------------------------------------------- viewer (read)
  rule(GET, 'overview', 'viewer'),
  rule(GET, 'health/(?:tree|history)', 'viewer'),
  rule(GET, 'slos', 'viewer'),
  rule(GET, 'cluster', 'viewer'),
  rule(GET, `nodes(?:/${NAME}(?:/platform)?)?`, 'viewer'),
  rule(GET, 'alerts(?:/export|/silences)?', 'viewer'),
  rule(GET, `alerts/${UUID}`, 'viewer'),
  rule(GET, 'plans', 'viewer', 'query', ['project', 'status', 'limit']),
  personal(GET, `plans/${UUID}`, 'viewer'),
  personal(GET, 'resources(?:/export)?', 'viewer'),
  personal(GET, `resources/[A-Za-z]{1,64}/${NAME}`, 'viewer'),
  personal(GET, 'schemas(?:/[A-Za-z]{1,64})?', 'viewer'),
  personal(GET, 'topology(?:/trace)?', 'viewer'),
  // Workspace drafts (3.36): the cluster filters them by the acting person's project rights.
  personal(GET, 'drafts', 'viewer'),
  personal(GET, `drafts/${UUID}`, 'viewer'),
  rule(GET, 'metrics/(?:names|query|flows|events|export)', 'viewer'),
  rule(GET, 'logs(?:/export)?', 'viewer'),
  rule(GET, 'updates/(?:status|releases|rollouts)', 'viewer'),
  rule(GET, `updates/rollouts/${UUID}`, 'viewer'),
  rule(GET, 'backups', 'viewer', 'query', ['project', 'resource', 'includeDeleted', 'limit']),
  rule(GET, 'backups/restores', 'viewer', 'query', ['project']),
  rule(GET, 'backups/(?:status|restore-tests|diff|deletions)', 'viewer'),
  rule(GET, `backups/${UUID}(?:/files)?`, 'viewer'),
  rule(GET, 'backups/platform(?:/postgres/restores|/cutovers)?', 'viewer'),
  rule(GET, 'certificates', 'viewer'),
  rule(GET, 'dns/(?:failover|dnssec|zones)', 'viewer'),
  rule(GET, 'drift', 'viewer'),
  rule(GET, 'migrations', 'viewer'),
  rule(GET, 'autoscaling', 'viewer'),
  rule(GET, 'images/scans', 'viewer'),
  rule(GET, 'usage(?:/export)?', 'viewer'),
  rule(GET, 'reports(?:/files(?:/download|/archive)?)?', 'viewer'),
  rule(GET, 'dashboards', 'viewer'),
  rule(POST, 'dashboards/query', 'viewer'),
  rule(GET, 'access/me', 'viewer'),
  // Global search (cluster-wide grants: results span every project the service user sees).
  rule(GET, 'search', 'viewer'),
  // Favourites / recents per fleet person (2026-10-27): only with the signed claim, stored for `fleet:<iss>:<sub>`.
  own(GET, 'search/favorites', 'viewer'),
  own(['PUT', 'DELETE'], `search/favorites/${FAVOURITE_ITEM}`, 'viewer'),
  own(POST, 'search/recent', 'viewer'),
  // Saved views per fleet person (3.37): like favourites, only with the signed claim, stored for `fleet:<iss>:<sub>`.
  own([...GET, 'POST'], 'views', 'viewer'),
  own(['PATCH', 'DELETE'], `views/${UUID}`, 'viewer'),
  // Linked Git accounts per fleet person (3.41): only with the signed claim, stored for `fleet:<iss>:<sub>` (any grant:
  // project members comment on their project's pull requests). The OAuth callback stays on the cluster's public URL.
  ownAnyGrant(GET, 'git/accounts'),
  { ...ownAnyGrant(POST, 'git/accounts/(?:github|gitlab)/authorize'), consoleReturn: true },
  ownAnyGrant([...GET, 'DELETE'], 'git/accounts/pending/[A-Za-z0-9_-]{16,64}'),
  ownAnyGrant(POST, 'git/accounts/confirm'),
  ownAnyGrant(['DELETE'], `git/accounts/${UUID}`),
  rule(GET, `${PROJECT}/(?:usage(?:/export)?|members|settings|requests|cron-runs|incidents)`, 'viewer', 'path'),
  rule(GET, `${PROJECT}/deployments/${NAME}/status`, 'viewer', 'path'),
  // Virtual machines (3.35): list / status / snapshots / image imports.
  rule(GET, 'virtual-machines', 'viewer', 'query', ['project']),
  rule(GET, `${PROJECT}/virtual-machines(?:/${NAME}(?:/snapshots)?)?`, 'viewer', 'path'),
  rule(GET, `${PROJECT}/vm-images(?:/imports(?:/${UUID})?)?`, 'viewer', 'path'),
  // VM image catalog (3.42): shipped, cluster and live upstream entries; the same for every caller with a role.
  anyGrantRead('vm-images/catalog(?:/upstream)?'),

  // ---------------------------------------------------------------------------------------- operator (change)
  personal(POST, 'plans', 'operator'),
  // Dry-run previews and Workspace drafts (3.36): change-side like plans (`If-Match` is forwarded).
  personal(POST, 'topology/preview', 'operator'),
  personal(POST, 'drafts', 'operator'),
  personal(['PATCH'], `drafts/${UUID}`, 'operator'),
  personal(POST, `drafts/${UUID}/(?:preview|submit|discard)`, 'operator'),
  personal(POST, `plans/${UUID}/(?:apply|cancel|discard)`, 'operator'),
  rule(POST, 'drift/plans', 'operator'),
  personal(POST, 'backups/now', 'operator'),
  rule(POST, `backups/${UUID}/restore-test`, 'operator'),
  rule(POST, `alerts/${UUID}/acknowledge`, 'operator'),
  rule(POST, 'alerts/silences', 'operator'),
  rule(['DELETE'], `alerts/silences/${UUID}`, 'operator'),
  rule(POST, `nodes/${NAME}/(?:cordon|uncordon|drain)`, 'operator'),
  rule(POST, `dns/failover/[a-z0-9.-]{1,253}/failback`, 'operator'),
  rule(GET, 'live/(?:sessions|tunnels)', 'operator'),
  rule(POST, `${PROJECT}/incidents`, 'operator', 'path'),
  // VM power, re-imaging and snapshots (3.35); the cluster still checks the project role (developers need exec).
  rule(
    POST,
    `${PROJECT}/virtual-machines/${NAME}/(?:start|stop|force-off|shutdown|reboot|reset|reimage|snapshots)`,
    'operator',
    'path',
  ),
  rule(POST, `${PROJECT}/vm-images/import`, 'operator', 'path'),
  rule(['PUT'], `${PROJECT}/incidents/${UUID}`, 'operator', 'path'),
  // Custom certificates (3.41, as natively: infra operators and cluster admins): cluster-scoped, cluster-wide grants.
  rule(['PUT', 'DELETE'], 'certificates/[A-Za-z0-9._-]{1,255}', 'operator'),
  // Integrations hub (3.41): tests of the applied configuration; the cluster enforces admin for SIEM targets.
  rule(POST, 'integrations/test', 'operator'),

  // ------------------------------------------------------------------------------------------ admin (cluster)
  rule(GET, 'audit(?:/export)?', 'admin'),
  rule(GET, 'cluster/(?:siem|audit/verify|members)', 'admin'),
  rule(['PUT', 'DELETE'], 'cluster/members/[A-Za-z0-9._@-]{1,255}', 'admin'),
  rule(['PUT', 'DELETE'], `${PROJECT}/members/[A-Za-z0-9._@-]{1,255}`, 'admin', 'path'),
  rule(['PUT'], `${PROJECT}/settings`, 'admin', 'path'),
  rule(GET, 'access/export', 'admin'),
  // Access as YAML (2026-10-27, full parity): the import is cluster administration like the members routes.
  rule(POST, 'access/import', 'admin'),
  rule(POST, `nodes/${NAME}/(?:confirm-lost|leave)`, 'admin'),
  rule(GET, `live/sessions/${UUID}/recording`, 'admin'),
  // Replica files and backup contents leave the cluster's secrets boundary (env files, keys, dumps): admin only.
  rule(['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'], 'live/files(?:/content|/copy)?', 'admin'),
  rule(GET, `backups/${UUID}/(?:download|archive)`, 'admin'),
  rule(POST, 'reports/run', 'admin'),
  rule(GET, 'backups/keys', 'admin'),
  rule(POST, 'backups/keys/rotate', 'admin'),
  rule(POST, 'backups/keys/[0-9]{1,9}/escrow', 'admin'),
  // Recovery kit (3.20, 2026-10-30): re-issue / hand out a share / confirm as the signed person (`secret`: claim
  // always, the body — confirmed shares — bound into it and only streamed through, answer `no-store`). Cluster-wide
  // admin grants only (no project grants reach it); the cluster checks the person's own cluster-admin role.
  { ...rule(POST, 'backups/keys/[0-9]{1,9}/kit(?:/shares/[0-9]{1,3}|/confirm)?', 'admin'), secret: true },
  rule(GET, 'backups/platform/dr-info', 'admin'),
  // etcd snapshot download (2026-10-27): backup contents like `backups/<id>/download`, admin only.
  rule(GET, 'backups/platform/etcd/etcd-[0-9]{8}t[0-9]{6}z', 'admin'),
  rule(POST, 'backups/platform/postgres/restores', 'admin'),
  rule(['DELETE'], `backups/platform/postgres/restores/${UUID}`, 'admin'),
  rule(POST, 'backups/platform/opensearch/restore', 'admin'),
  rule(POST, 'backups/deletions', 'admin'),
  rule(POST, `backups/deletions/${UUID}/cancel`, 'admin'),
  rule(POST, 'backups/now/all', 'admin'),
  rule(POST, 'backups/platform/(?:copies|postgres|opensearch|etcd)/run', 'admin'),
  rule(POST, `backups/platform/(?:cutovers/${UUID}/cancel|postgres/restores/${UUID}/cutover)`, 'admin'),
  rule(GET, 'dr/status', 'admin'),
  rule(POST, 'updates/releases/[0-9A-Za-z.+-]{1,64}/download', 'admin'),
  // Air-gapped bundle upload (2026-10-27): streamed, exempt from the request size limit (the cluster enforces
  // `LOADWEAVER_BUNDLE_MAX_BYTES` and verifies the signature).
  { ...rule(POST, 'updates/bundles', 'admin'), stream: true },
  rule(POST, 'updates/rollouts', 'admin'),
  rule(POST, `updates/rollouts/${UUID}/(?:pause|resume|rollback|cancel)`, 'admin'),
  // Integrations hub (3.41): read-only status of env-configured integrations (never values), cluster admins.
  rule(GET, 'integrations', 'admin'),
  // Git connections (3.41, as natively): cluster-wide admins manage the cluster scope and every project; project
  // grants reach them only as the signed person (person-scoped): the cluster lists what the person may read and lets
  // project admins manage their own project's connection (GitHub App / memberships from Git stay stricter there).
  // Credentials are secret references; the webhook secret is streamed back once like a join token.
  personal(GET, 'git/connections', 'viewer'),
  personal(GET, `git/connections/${UUID}(?:/commits)?`, 'viewer'),
  personal(POST, `git/connections/${UUID}/(?:test|sync|export|host-key/reset|webhook-secret/rotate)`, 'admin'),
  personal(POST, 'git/connections', 'admin'),
  personal(['PATCH', 'DELETE'], `git/connections/${UUID}`, 'admin'),
  personal(GET, `git/connections/${UUID}/webhook-secret`, 'admin'),
  rule(GET, 'git/sops/recipient', 'viewer'),
  // Webhooks (shared notifications) and release announcements (shared updates) of the cluster (2026-10-27, full
  // parity): cluster-wide admins, as natively.
  rule(GET, 'admin/webhooks(?:/event-types)?', 'admin'),
  rule(GET, `admin/webhooks/${UUID}(?:/deliveries)?`, 'admin'),
  rule(POST, 'admin/webhooks', 'admin'),
  rule(['PUT', 'DELETE'], `admin/webhooks/${UUID}`, 'admin'),
  rule(POST, `admin/webhooks/${UUID}/test`, 'admin'),
  rule(GET, 'updates/announcements(?:/status)?', 'admin'),
  rule(POST, 'updates/announcements/check', 'admin'),
  rule(GET, 'posture/(?:plugins|integrations|certificates)', 'admin'),
  rule(POST, 'posture/integrations(?:/test)?', 'admin'),
  rule(['PATCH', 'DELETE'], `posture/integrations/${UUID}`, 'admin'),
  rule(POST, `posture/integrations/${UUID}/(?:test|sync)`, 'admin'),
  rule(['PUT'], 'posture/certificates', 'admin'),
  rule(GET, 'wallboards', 'admin'),
  // Wallboard tokens are read-only display tokens, issued by the service user for the caller.
  rule(POST, 'wallboards', 'admin'),
  rule(['DELETE'], `wallboards/${UUID}`, 'admin'),
  rule(GET, 'imports', 'admin'),
  rule(GET, `imports/${NAME}`, 'admin'),
  rule(POST, `imports/${NAME}/(?:discover|plan)`, 'admin'),
  rule(['PUT'], `imports/${NAME}/selection`, 'admin'),
  rule(['DELETE'], `imports/${NAME}`, 'admin'),
  // Join tokens (2026-10-26): cluster-wide admins only (project grants never match a rule without `project`). The
  // created token is streamed back once and never logged or stored by the fleet; the cluster audits the service user
  // with the caller as on-behalf-of. The node agent's `nodes/join` and the installer stay native (NEVER_RELAYED).
  rule(GET, 'join-tokens', 'admin'),
  rule(POST, 'join-tokens', 'admin'),
  rule(['DELETE'], `join-tokens/${UUID}`, 'admin'),

  // ------------------------------------------------------------- project secrets as the signed person (2026-10-29)
  // The cluster decides (writers = project admin / operator or cluster admin; `lw-` names cluster admins only);
  // `operator` here only keeps viewers from reaching it. Cluster-wide list: filtered by the cluster to the person.
  secret(GET, `${PROJECT}/secrets(?:/names)?`, 'path'),
  secret(['PUT', 'DELETE'], `${PROJECT}/secrets/${SECRET_NAME}`, 'path'),
  { ...secret(GET, 'secrets', 'query', ['project', 'q', 'limit']), personScoped: true },

  // ------------------------------------------------------------------- approvals with a signed identity (3.24)
  // Plans: any grant (the cluster checks operator / admin of each touched project and that it's a second person).
  approval(`plans/${UUID}/approve`, 'viewer', { anyGrant: true }),
  // Cross-project acceptances: operator of the accepting project.
  approval(`${PROJECT}/acceptances`, 'operator', { project: 'path' }),
  // Backup deletions: admin of the scope (project or cluster), checked by the cluster.
  approval(`backups/deletions/${UUID}/approve`, 'viewer', { anyGrant: true }),
  approval(`backups/platform/cutovers/${UUID}/approve`, 'admin'),
  approval(`updates/rollouts/${UUID}/approve`, 'admin'),
];

export type RelayDecision =
  | {
      allowed: true;
      role: FleetRole;
      project: string | null;
      rule: RelayRule;
      /** Relayed only with the caller's signed identity claim to a verifying cluster (person-scoped rules). */
      needsClaim?: boolean;
    }
  | { allowed: false; status: 400 | 403 | 404; reason: string };

const SAFE_PATH = /^[A-Za-z0-9._~\-/:@+]*$/;
const ENCODED_FAVOURITE = new RegExp(`^search/favorites/${FAVOURITE_ITEM}$`);

/**
 * The relayed path, or null when it is unsafe: no encoded characters, no `..` / `.` / empty segments, no
 * backslashes — so the path the fleet authorises is exactly the path the cluster routes.
 */
export function normalizeRelayPath(raw: string): string | null {
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '');

  // The one route with an encoded segment: a favourite's item (only `%2F` / `%3A`, decoded by the cluster into the
  // `:item` parameter — never into path segments).
  if (ENCODED_FAVOURITE.test(path)) return path;

  if (!path || path.length > 1024 || !SAFE_PATH.test(path)) return null;

  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;

  return path;
}

function queryProject(query: Record<string, unknown>): string | null | 'invalid' {
  const value = query['project'];

  if (value === undefined) return null;

  // Arrays (`?project=a&project=b`) are refused: the cluster might read another value than the one authorised.
  return typeof value === 'string' && new RegExp(`^${NAME}$`).test(value) ? value : 'invalid';
}

export function authorizeRelay(
  method: string,
  rawPath: string,
  query: Record<string, unknown>,
  access: FleetClusterAccess,
): RelayDecision {
  const path = normalizeRelayPath(rawPath);

  if (path === null) return { allowed: false, status: 400, reason: 'invalid path' };

  if (NEVER_RELAYED.some((pattern) => pattern.test(path)))
    return { allowed: false, status: 404, reason: `${path} is never relayed` };

  const verb = method.toUpperCase();
  const match = RELAY_RULES.find((r) => r.methods.includes(verb) && r.path.test(path));

  if (!match) return { allowed: false, status: 404, reason: `${verb} ${path} is not relayed` };

  // Approvals change things too, whatever role their rule names.
  if (access.readOnly && (match.role !== 'viewer' || match.approval))
    return { allowed: false, status: 403, reason: 'the cluster is in its read-only grace period' };

  let project: string | null = null;

  if (match.project === 'path') {
    project = match.path.exec(path)?.groups?.['project'] ?? null;
  } else if (match.project === 'query') {
    const unknown = Object.keys(query).filter((key) => !(match.query ?? ['project']).includes(key));

    if (unknown.length) return { allowed: false, status: 400, reason: `query parameter ${unknown[0]} is not relayed` };

    const fromQuery = queryProject(query);

    if (fromQuery === 'invalid') return { allowed: false, status: 400, reason: 'invalid project' };

    project = fromQuery;
  }

  const bestGrant = [...access.projects.values()].reduce<FleetRole | null>(
    (best, r) => maxRole(best, r),
    access.clusterRole,
  );
  // Person-scoped rules: a project grant may reach them, the cluster then scopes to the person (claim required).
  const needsClaim =
    !!match.personal || !!match.secret || (!!match.personScoped && !roleAtLeast(access.clusterRole, match.role));
  const role =
    match.anyGrant || match.personScoped ? bestGrant : match.project ? roleFor(access, project) : access.clusterRole;

  if (!roleAtLeast(role, match.role))
    return {
      allowed: false,
      status: 403,
      reason:
        !match.project && access.projects.size > 0 && !access.clusterRole
          ? 'needs a cluster-wide grant'
          : `needs the ${match.role} role`,
    };

  return { allowed: true, role: role as FleetRole, project, rule: match, ...(needsClaim ? { needsClaim: true } : {}) };
}

/** Socket namespaces of the control plane the console needs live, with the role they need (cluster-wide grants). */
export const SOCKET_RELAY_NAMESPACES: Readonly<Record<string, FleetRole>> = {
  plans: 'viewer',
  topology: 'viewer',
  logs: 'viewer',
  terminals: 'operator',
  // VM serial / VNC consoles (3.35): like terminals.
  consoles: 'operator',
};

/**
 * Streams the cluster filters per person (2026-10-27): project grants may attach with the signed per-user claim (the
 * cluster forwards only events of the person's projects); without a trusted fleet they keep the periodic refresh.
 */
export const PERSON_SCOPED_SOCKET_NAMESPACES: ReadonlySet<string> = new Set(['plans', 'topology']);

export function authorizeSocketNamespace(
  namespace: string,
  access: FleetClusterAccess,
): { allowed: true; needsClaim?: boolean } | { allowed: false; reason: string } {
  const role = Object.prototype.hasOwnProperty.call(SOCKET_RELAY_NAMESPACES, namespace)
    ? SOCKET_RELAY_NAMESPACES[namespace]
    : undefined;

  if (!role) return { allowed: false, reason: `namespace ${namespace} is not relayed` };

  // Terminals change things in replicas: not during the read-only grace.
  if (access.readOnly && role !== 'viewer')
    return { allowed: false, reason: 'the cluster is in its read-only grace period' };

  if (roleAtLeast(access.clusterRole, role)) return { allowed: true };

  // Project grants: only person-scoped streams, and only with the signed claim (the cluster filters by person).
  const best = [...access.projects.values()].reduce<FleetRole | null>((b, r) => maxRole(b, r), null);

  if (PERSON_SCOPED_SOCKET_NAMESPACES.has(namespace) && roleAtLeast(best, role))
    return { allowed: true, needsClaim: true };

  return { allowed: false, reason: `needs a cluster-wide ${role} grant` };
}
