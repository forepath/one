/**
 * Egress guard sidecar contract (must match `apps/agenstra/backend-agent-manager/egress-guard/*`).
 *
 * The guard owns the network namespace shared with its agent (`NetworkMode: container:<guard>`).
 * Only the guard has CAP_NET_ADMIN. Squid marks its upstream sockets (SO_MARK, which requires
 * CAP_NET_ADMIN and therefore cannot be forged by the agent) and netfilter exempts only marked
 * traffic from redirection. dnsmasq runs as a dedicated UID that may only reach the upstream
 * resolvers on port 53 (UIDs alone are not trusted: a root agent can switch to any UID).
 */
export const EGRESS_GUARD_DEFAULT_IMAGE = 'ghcr.io/forepath/agenstra-manager-egress-guard:latest';

/** Container label marking guard sidecars (value `1`). */
export const EGRESS_GUARD_LABEL = 'io.agenstra.egress-guard';
/** Container label carrying the owning agent id. */
export const EGRESS_GUARD_AGENT_LABEL = 'io.agenstra.agent-id';
export const EGRESS_GUARD_NAME_PREFIX = 'agenstra-egress-';

export const EGRESS_GUARD_PROXY_UID = 10901;
export const EGRESS_GUARD_DNS_UID = 10902;
/** Netfilter mark set by Squid on its upstream connections (`tcp_outgoing_mark`). */
export const EGRESS_GUARD_PROXY_MARK = '0x4147';
/** Guard-managed chain listing the upstream DNS resolvers dnsmasq may reach (filled at guard boot). */
export const EGRESS_GUARD_RESOLVERS_CHAIN = 'AGENSTRA_EGRESS_RESOLVERS';

/** Explicit forward proxy (HTTP_PROXY / HTTPS_PROXY), loopback only. */
export const EGRESS_GUARD_EXPLICIT_PROXY_PORT = 3128;
/** Transparent plaintext HTTP interception listener. */
export const EGRESS_GUARD_HTTP_INTERCEPT_PORT = 3129;
/** Transparent TLS peek / splice / terminate listener (never decrypts). */
export const EGRESS_GUARD_HTTPS_INTERCEPT_PORT = 3130;
/** DNS policy proxy (dnsmasq), loopback only. */
export const EGRESS_GUARD_DNS_PORT = 5353;

/** Guard state directory (root-only): staged / active / previous policy bundles. */
export const EGRESS_GUARD_STATE_DIR = '/var/lib/agenstra-egress';
export const EGRESS_GUARD_ACTIVE_DIR = `${EGRESS_GUARD_STATE_DIR}/active`;
export const EGRESS_GUARD_STAGED_DIR_NAME = 'staged';
export const EGRESS_GUARD_CLI = '/usr/local/bin/agenstra-egress';

/** Log line markers emitted on the guard's stdout (parsed by the egress events collector). */
export const EGRESS_GUARD_WEB_LOG_MARKER = 'AGENSTRA_EGRESS';
export const EGRESS_GUARD_EVENT_LOG_MARKER = 'AGENSTRA_GUARD';

/** Netfilter rule comment prefix for counted (blocked / observed) non-web categories. */
export const EGRESS_GUARD_COUNTER_COMMENT_PREFIX = 'agenstra:';

/** Explicit proxy URL injected into the agent environment while a guard is active. */
export const EGRESS_GUARD_PROXY_URL = `http://127.0.0.1:${EGRESS_GUARD_EXPLICIT_PROXY_PORT}`;
export const EGRESS_GUARD_NO_PROXY_DEFAULTS = ['localhost', '127.0.0.1', '::1'] as const;

/** Proxy env keys managed while a guard is active (upper- and lower-case variants). */
export const EGRESS_GUARD_PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

/** Agent ports published / reached through the guard (OpenCode serve, VNC websockify). */
export const EGRESS_GUARD_FORWARDED_AGENT_PORTS = [4096, 6080] as const;

export const EGRESS_GUARD_READY_TIMEOUT_MS = 30_000;
export const EGRESS_GUARD_DEFAULT_MEMORY_MB = 256;
export const EGRESS_EVENTS_DEFAULT_POLL_INTERVAL_MS = 15_000;
export const EGRESS_EVENTS_DEFAULT_RETENTION_HOURS = 72;
export const EGRESS_EVENTS_MAX_PAGE_SIZE = 1000;

export function resolveEgressGuardImage(env: NodeJS.ProcessEnv = process.env): string {
  return env['AGENT_EGRESS_GUARD_IMAGE']?.trim() || EGRESS_GUARD_DEFAULT_IMAGE;
}

/**
 * Git over SSH through the guard (TCP 22): the guard's DNS proxy (dnsmasq) adds the addresses it
 * resolves for curated Git hosting providers to these ipsets, and netfilter only accepts TCP 22 to
 * addresses in them. The agent can therefore reach port 22 exclusively on addresses the guard itself
 * resolved for those host names (no arbitrary IPs, no spoofed DNS answers). Entries expire with the
 * set timeout and are refreshed by every resolution.
 */
export const EGRESS_GIT_SSH_SET_V4 = 'agenstra_git_ssh4';
export const EGRESS_GIT_SSH_SET_V6 = 'agenstra_git_ssh6';
export const EGRESS_GIT_SSH_PORT = 22;
/** Counter category of accepted Git SSH connections (reported as `allowed` network events). */
export const EGRESS_GIT_SSH_COUNTER_CATEGORY = 'git_ssh';

/**
 * Curated Git hosting providers reachable over SSH by default (subdomains included, e.g.
 * `ssh.github.com`, `altssh.gitlab.com`). Extend with `AGENT_EGRESS_GIT_SSH_HOSTS` for self-hosted
 * servers; an entry on the policy deny list always wins.
 */
export const EGRESS_GIT_SSH_DEFAULT_HOSTS: readonly string[] = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'ssh.dev.azure.com',
  'vs-ssh.visualstudio.com',
  'codeberg.org',
  'gitea.com',
  'git.sr.ht',
  'gitee.com',
  'framagit.org',
  'salsa.debian.org',
  'gitlab.gnome.org',
  'gitlab.freedesktop.org',
  'invent.kde.org',
  'git.launchpad.net',
  'git.code.sf.net',
  'source.developers.google.com',
];

const GIT_SSH_HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Git SSH hosts for the guard: the curated defaults plus `AGENT_EGRESS_GIT_SSH_HOSTS` (comma or
 * whitespace separated host names). `AGENT_EGRESS_GIT_SSH_ENABLED=false` disables Git over SSH.
 * Invalid entries are ignored (every value ends up in dnsmasq configuration).
 */
export function resolveEgressGitSshHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  if ((env['AGENT_EGRESS_GIT_SSH_ENABLED'] ?? 'true').trim().toLowerCase() === 'false') {
    return [];
  }

  const extra = (env['AGENT_EGRESS_GIT_SSH_HOSTS'] ?? '')
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter((host) => GIT_SSH_HOST_PATTERN.test(host));

  return [...new Set([...EGRESS_GIT_SSH_DEFAULT_HOSTS, ...extra])].sort();
}

export function egressGuardContainerName(agentId: string): string {
  return `${EGRESS_GUARD_NAME_PREFIX}${agentId}`;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveEgressGuardMemoryBytes(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env['AGENT_EGRESS_GUARD_MEMORY_MB'], EGRESS_GUARD_DEFAULT_MEMORY_MB) * 1024 * 1024;
}

export function resolveEgressEventsPollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env['AGENT_EGRESS_EVENTS_POLL_INTERVAL_MS'], EGRESS_EVENTS_DEFAULT_POLL_INTERVAL_MS);
}

export function resolveEgressEventsRetentionHours(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env['AGENT_EGRESS_EVENTS_RETENTION_HOURS'], EGRESS_EVENTS_DEFAULT_RETENTION_HOURS);
}
