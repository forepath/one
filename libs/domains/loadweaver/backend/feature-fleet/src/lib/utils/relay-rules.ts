import type { FleetRole } from '../constants/fleet.constants';

import { roleAtLeast, roleFor, type FleetClusterAccess } from './fleet-access.utils';

/**
 * Method / path allow-list of the REST relay (3.24): `/clusters/:id/api/<path>` is forwarded only when a rule
 * matches and the caller's grant on the cluster (or on the project in the path / query) reaches the rule's role.
 * Everything else is refused before the request leaves the fleet — the service credential behind the relay is
 * usually far more powerful than the caller.
 *
 * Deliberately not relayed: secrets, personal resources of the service user (VPN devices, Git account links,
 * search favourites, registry tokens), node joining / join tokens / installer endpoints, public endpoints, and every
 * approval / acceptance (four-eyes decisions stay native in the cluster's own console: through the fleet they would
 * all be made by the one service user). {@link NEVER_RELAYED} enforces the hard exclusions even if a rule matched.
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
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NAME = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const PROJECT = `projects/(?<project>${NAME})`;
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

/**
 * Paths that are never relayed for any role, checked before the rules: secrets, joining / join tokens / installer,
 * and approvals / acceptances (four-eyes stays native).
 */
export const NEVER_RELAYED: readonly RegExp[] = [
  /(?:^|\/)secrets(?:\/|$)/,
  /^join-tokens(?:\/|$)/,
  /^nodes\/join$/,
  /^install(?:\/|$)/,
  /(?:^|\/)approve$/,
  /(?:^|\/)approvals?(?:\/|$)/,
  /(?:^|\/)acceptances?(?:\/|$)/,
];

export const RELAY_RULES: readonly RelayRule[] = [
  // ------------------------------------------------------------------------------------------- viewer (read)
  rule(GET, 'overview', 'viewer'),
  rule(GET, 'health/(?:tree|history)', 'viewer'),
  rule(GET, 'slos', 'viewer'),
  rule(GET, 'cluster', 'viewer'),
  rule(GET, `nodes(?:/${NAME})?`, 'viewer'),
  rule(GET, 'alerts(?:/export|/silences)?', 'viewer'),
  rule(GET, `alerts/${UUID}`, 'viewer'),
  rule(GET, 'plans', 'viewer', 'query', ['project', 'status', 'limit']),
  rule(GET, `plans/${UUID}`, 'viewer'),
  rule(GET, 'resources(?:/export)?', 'viewer'),
  rule(GET, `resources/[A-Za-z]{1,64}/${NAME}`, 'viewer'),
  rule(GET, 'schemas(?:/[A-Za-z]{1,64})?', 'viewer'),
  rule(GET, 'topology(?:/trace)?', 'viewer'),
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
  rule(GET, `${PROJECT}/(?:usage(?:/export)?|members|settings|requests|cron-runs|incidents)`, 'viewer', 'path'),
  rule(GET, `${PROJECT}/deployments/${NAME}/status`, 'viewer', 'path'),

  // ---------------------------------------------------------------------------------------- operator (change)
  rule(POST, 'plans', 'operator'),
  // No `approve`: approvals stay native in the cluster (see NEVER_RELAYED).
  rule(POST, `plans/${UUID}/(?:apply|cancel|discard)`, 'operator'),
  rule(POST, 'drift/plans', 'operator'),
  rule(POST, 'backups/now', 'operator'),
  rule(POST, `backups/${UUID}/restore-test`, 'operator'),
  rule(POST, `alerts/${UUID}/acknowledge`, 'operator'),
  rule(POST, 'alerts/silences', 'operator'),
  rule(['DELETE'], `alerts/silences/${UUID}`, 'operator'),
  rule(POST, `nodes/${NAME}/(?:cordon|uncordon|drain)`, 'operator'),
  rule(POST, `dns/failover/[a-z0-9.-]{1,253}/failback`, 'operator'),
  rule(GET, 'live/(?:sessions|tunnels)', 'operator'),
  rule(POST, `${PROJECT}/incidents`, 'operator', 'path'),
  rule(['PUT'], `${PROJECT}/incidents/${UUID}`, 'operator', 'path'),

  // ------------------------------------------------------------------------------------------ admin (cluster)
  rule(GET, 'audit(?:/export)?', 'admin'),
  rule(GET, 'cluster/(?:siem|audit/verify|members)', 'admin'),
  rule(['PUT', 'DELETE'], 'cluster/members/[A-Za-z0-9._@-]{1,255}', 'admin'),
  rule(['PUT', 'DELETE'], `${PROJECT}/members/[A-Za-z0-9._@-]{1,255}`, 'admin', 'path'),
  rule(['PUT'], `${PROJECT}/settings`, 'admin', 'path'),
  rule(GET, 'access/export', 'admin'),
  rule(POST, `nodes/${NAME}/(?:confirm-lost|leave)`, 'admin'),
  rule(GET, `live/sessions/${UUID}/recording`, 'admin'),
  // Replica files and backup contents leave the cluster's secrets boundary (env files, keys, dumps): admin only.
  rule(['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'], 'live/files(?:/content|/copy)?', 'admin'),
  rule(GET, `backups/${UUID}/(?:download|archive)`, 'admin'),
  rule(['PUT', 'DELETE'], 'certificates/[A-Za-z0-9._-]{1,255}', 'admin'),
  rule(POST, 'reports/run', 'admin'),
  rule(GET, 'backups/keys', 'admin'),
  rule(POST, 'backups/keys/rotate', 'admin'),
  rule(POST, 'backups/deletions', 'admin'),
  rule(POST, `backups/deletions/${UUID}/cancel`, 'admin'),
  rule(POST, 'backups/now/all', 'admin'),
  rule(POST, 'backups/platform/(?:copies|postgres|opensearch|etcd)/run', 'admin'),
  rule(POST, `backups/platform/(?:cutovers/${UUID}/cancel|postgres/restores/${UUID}/cutover)`, 'admin'),
  rule(GET, 'dr/status', 'admin'),
  rule(POST, 'updates/releases/[0-9A-Za-z.+-]{1,64}/download', 'admin'),
  rule(POST, 'updates/rollouts', 'admin'),
  rule(POST, `updates/rollouts/${UUID}/(?:pause|resume|rollback|cancel)`, 'admin'),
  rule(GET, 'git/connections', 'admin'),
  rule(GET, `git/connections/${UUID}(?:/commits)?`, 'admin'),
  rule(POST, `git/connections/${UUID}/(?:test|sync|export)`, 'admin'),
  rule(GET, 'posture/(?:plugins|integrations|certificates)', 'admin'),
  rule(GET, 'wallboards', 'admin'),
  rule(GET, 'imports', 'admin'),
  rule(GET, `imports/${NAME}`, 'admin'),
];

export type RelayDecision =
  | { allowed: true; role: FleetRole; project: string | null; rule: RelayRule }
  | { allowed: false; status: 400 | 403 | 404; reason: string };

const SAFE_PATH = /^[A-Za-z0-9._~\-/:@+]*$/;

/**
 * The relayed path, or null when it is unsafe: no encoded characters, no `..` / `.` / empty segments, no
 * backslashes — so the path the fleet authorises is exactly the path the cluster routes.
 */
export function normalizeRelayPath(raw: string): string | null {
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '');

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

  if (access.readOnly && match.role !== 'viewer')
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

  const role = match.project ? roleFor(access, project) : access.clusterRole;

  if (!roleAtLeast(role, match.role))
    return {
      allowed: false,
      status: 403,
      reason:
        !match.project && access.projects.size > 0 && !access.clusterRole
          ? 'needs a cluster-wide grant'
          : `needs the ${match.role} role`,
    };

  return { allowed: true, role: role as FleetRole, project, rule: match };
}

/** Socket namespaces of the control plane the console needs live, with the role they need (cluster-wide grants). */
export const SOCKET_RELAY_NAMESPACES: Readonly<Record<string, FleetRole>> = {
  plans: 'viewer',
  topology: 'viewer',
  logs: 'viewer',
  terminals: 'operator',
};

export function authorizeSocketNamespace(
  namespace: string,
  access: FleetClusterAccess,
): { allowed: true } | { allowed: false; reason: string } {
  const role = Object.prototype.hasOwnProperty.call(SOCKET_RELAY_NAMESPACES, namespace)
    ? SOCKET_RELAY_NAMESPACES[namespace]
    : undefined;

  if (!role) return { allowed: false, reason: `namespace ${namespace} is not relayed` };

  // Streams carry data of every project the service user sees: project grants never open them.
  if (!roleAtLeast(access.clusterRole, role)) return { allowed: false, reason: `needs a cluster-wide ${role} grant` };

  // Terminals change things in replicas: not during the read-only grace.
  if (access.readOnly && role !== 'viewer')
    return { allowed: false, reason: 'the cluster is in its read-only grace period' };

  return { allowed: true };
}
