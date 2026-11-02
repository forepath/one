import { randomBytes } from 'crypto';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';

import { buildCertbotBootstrapScript } from '../../utils/cloud-init/certbot-bootstrap.script';
import { quoteShellLiteral } from '../../utils/cloud-init/work-dir.utils';

/**
 * Decabill service kind `loadweaver` (Loadweaver plan, section 4 "Decabill provisions Loadweaver"): one ordered server
 * becomes a single-node Loadweaver cluster (control plane, console, node agent) through the normal
 * `loadweaver-agent bootstrap` and the signed release (3.21, 3.26). Decabill provisions and bills only this node;
 * further nodes join with the customer's own join tokens / provider accounts and are never billed by Decabill.
 */

/** Host directory of the management endpoint (console server + TLS proxy). The cluster itself lives in /var/lib/loadweaver. */
export const LOADWEAVER_STACK_DIR = '/opt/loadweaver';
export const LOADWEAVER_PROVISIONING_LOG = '/var/log/loadweaver-provisioning.log';
export const LOADWEAVER_UPDATE_LOG = '/var/log/loadweaver-console-update.log';
export const LOADWEAVER_NGINX_CONTAINER = 'loadweaver-nginx';
export const LOADWEAVER_CONSOLE_CONTAINER = 'loadweaver-console-server';
/** Loadweaver API port on control-plane members (host network, see docs/loadweaver/deployment/host-requirements.md). */
export const LOADWEAVER_API_PORT = 3400;
/** Console server port (docs/port-allocation.md); published on loopback only, nginx terminates TLS in front of it. */
export const LOADWEAVER_CONSOLE_PORT = 4602;
export const LOADWEAVER_CONSOLE_IMAGE_REPOSITORY = 'ghcr.io/forepath/loadweaver-console-server';
/** Digest-pinned TLS proxy (same pin as elsewhere in the repository). */
export const LOADWEAVER_NGINX_IMAGE =
  'nginx:1.29.3-alpine@sha256:b3c656d55d7ad751196f21b7fd2e8d4da9cb430e32f646adcf92441b72f82b14';
export const LOADWEAVER_DEFAULT_RELEASE_BASE_URL = 'https://github.com/forepath/one/releases/download';
/** Where cloud-init keeps the firewall that keeps the API port off the public interfaces (L11). */
export const LOADWEAVER_CLOUD_FIREWALL_FILE = '/etc/loadweaver-cloud/firewall.nft';
/**
 * Request bodies through the proxy: the API's own parsers cap JSON at 3 MB and file-browser chunks at 10 MB, so 64m
 * is the default; the streamed uploads the control plane caps itself (release bundles, backup archives, registry
 * pushes) have no proxy limit, the console none at all (1m).
 */
export const LOADWEAVER_PROXY_BODY_LIMITS = { api: '64m', console: '1m' } as const;
/** Service-detail tab of the billing console (cluster endpoint, health, adding nodes, cancellation). */
export const LOADWEAVER_CLUSTER_TAB_ID = 'loadweaver-cluster';
/** Error code returned when a cancellation of a subscription with a Loadweaver cluster lacks the data-loss confirmation. */
export const LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED = 'LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED';
export const LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS = 7;
/**
 * Item config key (encrypted `configSnapshot`, never part of item responses) of the one-time admin claim token: the
 * first console registration of a fresh cluster must present it, so nobody who finds the URL first can become the
 * cluster administrator. Shown to the customer in the Cluster tab until the cluster reports it claimed, then wiped.
 */
export const LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY = 'loadweaverAdminClaimToken';
/** Item config key: when the cluster first reported the admin claim as done (token wiped at that point). */
export const LOADWEAVER_ADMIN_CLAIMED_AT_KEY = 'loadweaverAdminClaimedAt';
/** `lwc_` + 32 random bytes (base64url): high entropy, shell- and URL-safe. */
export const LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN = /^lwc_[A-Za-z0-9_-]{43}$/;
const MAX_TEARDOWN_GRACE_DAYS = 90;

/** Same form as Loadweaver's `RELEASE_VERSION_PATTERN` (util-release, not importable from the Decabill domain). */
export const LOADWEAVER_RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
/** The same check in the update command's shell (POSIX ERE). */
const SHELL_RELEASE_VERSION_ERE = '^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$';
const RELEASE_BASE_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/;
const FQDN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const NODE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CLUSTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SSH_PUBLIC_KEY_PATTERN =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( [^\r\n'"`$\\]*)?$/;
const LOCALE_PATTERN = /^(en|de)$/;
/** Node-side file the claim token is handed over in; removed right after `loadweaver-agent bootstrap` read it. */
export const LOADWEAVER_ADMIN_CLAIM_TOKEN_FILE = '/var/lib/loadweaver-cloud/admin-claim-token';

/** Node-side file the operator's SMTP password is handed over in; removed right after `bootstrap` read it. */
export const LOADWEAVER_SMTP_PASSWORD_FILE = '/var/lib/loadweaver-cloud/smtp-password';

/** New one-time admin claim token (one per provisioning). */
export function generateLoadweaverAdminClaimToken(): string {
  return `lwc_${randomBytes(32).toString('base64url')}`;
}

export interface LoadweaverCloudInitConfig {
  ssh: { publicKey: string };
  host: {
    hostname: string;
    /** Public name of the cluster: console, API (`/api`) and the agent stream's TLS name. */
    fqdn: string;
    /** Loadweaver node name of the first node. */
    nodeName: string;
  };
  cluster: {
    name?: string;
    /** One-time admin claim token (`--admin-claim-token-file`); the node keeps only its SHA-256. */
    adminClaimToken: string;
  };
  release: {
    version: string;
    /** `<baseUrl>/v<version>/<asset>`: GitHub release assets (signed manifest, agent binaries). */
    baseUrl: string;
    /** ECDSA P-256 public keys the release manifest must be signed with (`RELEASE_SIGNING_KEYS.loadweaver`). */
    trustedKeys: readonly string[];
  };
  console: {
    /**
     * The plan's explicit console digest (`loadweaverConsoleImageDigest`): pins the console and wins over the release.
     * Without it the node takes the digest from the release's signed, verified manifest (`consoleImage`), never a tag.
     */
    imageDigest?: string;
    defaultLocale: 'en' | 'de';
  };
  /**
   * Operator SMTP (`smtp` of the plan's provisioning defaults, like the sibling stacks): `bootstrap` email flags.
   * Absent without an SMTP host: the cluster starts without email.
   */
  email?: LoadweaverCloudInitEmail;
  letsEncryptEmail?: string;
}

export interface LoadweaverCloudInitEmail {
  host: string;
  port?: number;
  user?: string;
  /** Handed over in a root-only file (`--smtp-password-file`), never on the command line. */
  password?: string;
  from?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Operator SMTP settings from `effectiveConfig.smtp` (same shape as the `agenstra-controller` / `agenstra-manager` /
 * `decabill-billing` stacks: host, port, user, password, from). No host: no email (the siblings' MailHog defaults
 * don't apply to a public cluster). Invalid values fail closed here instead of failing `bootstrap` on the node.
 */
export function resolveLoadweaverEmailSettings(
  effectiveConfig: Record<string, unknown>,
): LoadweaverCloudInitEmail | undefined {
  const smtp = effectiveConfig['smtp'];

  if (!smtp || typeof smtp !== 'object' || Array.isArray(smtp)) return undefined;

  const raw = smtp as Record<string, unknown>;
  const host = stringValue(raw['host']);

  if (!host) return undefined;

  const user = stringValue(raw['user']);
  const password = typeof raw['password'] === 'string' && raw['password'] !== '' ? raw['password'] : undefined;
  const from = stringValue(raw['from']);

  for (const value of [host, user, password, from]) {
    if (value !== undefined && (CONTROL_CHARACTER_PATTERN.test(value) || value.length > 1024)) {
      throw new Error('Invalid SMTP settings for Loadweaver provisioning');
    }
  }

  const rawPort = raw['port'];
  const port = rawPort === undefined || rawPort === null || rawPort === '' ? undefined : Number(String(rawPort).trim());

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('Invalid SMTP port for Loadweaver provisioning');
  }

  if (!user !== !password) {
    throw new Error('Authenticated SMTP for Loadweaver provisioning needs both user and password');
  }

  return {
    host,
    ...(port !== undefined ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(from ? { from } : {}),
  };
}

/** Derives a valid Loadweaver node name from the reserved hostname (falls back to `n1`). */
export function loadweaverNodeName(hostname: string): string {
  const candidate = hostname
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');

  return NODE_NAME_PATTERN.test(candidate) ? candidate : 'n1';
}

/**
 * Builds the cloud-init config from plan defaults + requested config + operator environment.
 *
 * Secrets: none are generated here on purpose. `loadweaver-agent bootstrap` generates the cluster secrets (database
 * passwords, `ENCRYPTION_KEY`, `JWT_SECRET`, CA) on the node itself, so they never pass through Decabill, its database
 * or the provider's user-data. The first account registered in the console becomes the cluster administrator (the
 * sibling stacks' `users` mode) but only with the one-time admin claim token (`loadweaverAdminClaimToken`, generated
 * per provisioning by the contributor's `prepareProvisioningConfig`, stored in the encrypted item config): user-data
 * hands it to `loadweaver-agent bootstrap --admin-claim-token-file`, the control plane stores only its SHA-256 and
 * requires it while no account exists. Missing / malformed token fails closed.
 *
 * Release: `loadweaverVersion` from the plan / order (exact version), else `LOADWEAVER_CLOUD_RELEASE_VERSION`.
 * Console image: by the digest the release's signed manifest pins (`consoleImage`, verified on the node like the agent
 * binary); an optional `loadweaverConsoleImageDigest` of the plan pins it explicitly instead.
 */
export function buildLoadweaverCloudInitConfigFromRequest(
  effectiveConfig: Record<string, unknown>,
  hostname: string,
  baseDomain = 'spirde.com',
  env: NodeJS.ProcessEnv = process.env,
): LoadweaverCloudInitConfig {
  const fqdn = `${hostname}.${baseDomain}`.toLowerCase();

  if (!FQDN_PATTERN.test(fqdn)) {
    throw new Error('Loadweaver provisioning needs a valid host name under DNS_BASE_DOMAIN');
  }

  const version =
    stringValue(effectiveConfig['loadweaverVersion']) ?? stringValue(env['LOADWEAVER_CLOUD_RELEASE_VERSION']);

  if (!version || !LOADWEAVER_RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(
      'Loadweaver provisioning needs an exact release version (plan default loadweaverVersion or LOADWEAVER_CLOUD_RELEASE_VERSION)',
    );
  }

  const baseUrl = (
    stringValue(env['LOADWEAVER_CLOUD_RELEASE_BASE_URL']) ?? LOADWEAVER_DEFAULT_RELEASE_BASE_URL
  ).replace(/\/+$/, '');

  if (!RELEASE_BASE_URL_PATTERN.test(baseUrl)) {
    throw new Error('LOADWEAVER_CLOUD_RELEASE_BASE_URL must be a plain https URL');
  }

  const trustedKeys = RELEASE_SIGNING_KEYS.loadweaver;

  if (trustedKeys.length === 0) {
    throw new Error('No Loadweaver release signing key is compiled in; refusing to provision unverified releases');
  }

  const digest = stringValue(effectiveConfig['loadweaverConsoleImageDigest']);

  if (digest && !IMAGE_DIGEST_PATTERN.test(digest)) {
    throw new Error('loadweaverConsoleImageDigest must be sha256:<64 hex>');
  }

  const sshPublicKey = stringValue(effectiveConfig['sshPublicKey']) ?? '';

  if (sshPublicKey && !SSH_PUBLIC_KEY_PATTERN.test(sshPublicKey)) {
    throw new Error('Invalid provisioning SSH public key');
  }

  const adminClaimToken = stringValue(effectiveConfig[LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY]);

  if (!adminClaimToken || !LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN.test(adminClaimToken)) {
    throw new Error('Loadweaver provisioning needs a one-time admin claim token');
  }

  const clusterName = stringValue(effectiveConfig['clusterName']);
  const locale = stringValue(effectiveConfig['defaultLocale']);
  const letsEncryptEmail = stringValue(env['LETS_ENCRYPT_EMAIL']);
  const email = resolveLoadweaverEmailSettings(effectiveConfig);

  return {
    ssh: { publicKey: sshPublicKey },
    host: { hostname, fqdn, nodeName: loadweaverNodeName(hostname) },
    cluster: {
      ...(clusterName && CLUSTER_NAME_PATTERN.test(clusterName) ? { name: clusterName } : {}),
      adminClaimToken,
    },
    release: { version, baseUrl, trustedKeys },
    console: {
      ...(digest ? { imageDigest: digest } : {}),
      defaultLocale: locale && LOCALE_PATTERN.test(locale) ? (locale as 'en' | 'de') : 'en',
    },
    ...(email ? { email } : {}),
    ...(letsEncryptEmail ? { letsEncryptEmail } : {}),
  };
}

/** Runtime `/config.json` of the console: same origin for console, REST API and Socket.IO namespaces. */
export function buildLoadweaverConsoleRuntimeConfig(fqdn: string): Record<string, unknown> {
  const origin = `https://${fqdn}`;
  const socket = (name: string) => `${origin}/socket/${name}`;

  return {
    console: {
      urls: {
        restApi: `${origin}/api`,
        frontend: origin,
        websocket: {
          default: socket('plans'),
          plans: socket('plans'),
          logs: socket('logs'),
          terminals: socket('terminals'),
          tunnels: socket('tunnels'),
          topology: socket('topology'),
        },
      },
    },
    authentication: { config: { type: 'users', disableSignup: false } },
  };
}

function nginxServerBlocks(fqdn: string, certificate: { cert: string; key: string }): string {
  const proxyHeaders = `        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;`;
  const upgradeHeaders = `        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_cache_bypass $http_upgrade;`;
  const api = `http://127.0.0.1:${LOADWEAVER_API_PORT}`;
  // Streamed uploads the control plane caps itself (`LOADWEAVER_BUNDLE_MAX_BYTES`, the backup import's size cap).
  const streamedUpload = (path: string) => `    location = ${path} {
        limit_req zone=lw_api burst=60 nodelay;
        client_max_body_size 0;
        proxy_pass ${api};
${proxyHeaders}
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }`;

  // X-Forwarded-For is overwritten (not appended) with the peer address: the control plane trusts it from loopback
  // only (`LOADWEAVER_TRUST_PROXY=loopback`), so clients cannot spoof their throttler bucket (H1). The per-client
  // request limit covers the REST API, not the long-lived websocket connections.
  return `
server_tokens off;
limit_req_zone $binary_remote_addr zone=lw_api:10m rate=20r/s;
limit_req_status 429;

server {
    listen 80;
    listen [::]:80;
    server_name ${fqdn};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${fqdn};

    ssl_certificate ${certificate.cert};
    ssl_certificate_key ${certificate.key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    client_max_body_size ${LOADWEAVER_PROXY_BODY_LIMITS.api};

    location / {
        client_max_body_size ${LOADWEAVER_PROXY_BODY_LIMITS.console};
        proxy_pass http://127.0.0.1:${LOADWEAVER_CONSOLE_PORT};
${proxyHeaders}
    }

    location /api/ {
        limit_req zone=lw_api burst=60 nodelay;
        proxy_pass ${api};
${proxyHeaders}
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

${streamedUpload('/api/updates/bundles')}

${streamedUpload('/api/backups/imports')}

    # docker login / push / pull against the cluster's registry (token realm on /api/registry/token).
    location /v2/ {
        client_max_body_size 0;
        proxy_pass ${api};
${proxyHeaders}
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location /socket/ {
        proxy_pass ${api};
${proxyHeaders}
${upgradeHeaders}
    }

    location /socket.io/ {
        proxy_pass ${api};
${proxyHeaders}
${upgradeHeaders}
    }

    location = /config.json {
        default_type application/json;
        return 200 '${JSON.stringify(buildLoadweaverConsoleRuntimeConfig(fqdn))}';
    }
}
`;
}

/** Compose file of the management endpoint; the console image comes from `.env` so the update command can re-pin it. */
function buildManagementCompose(config: LoadweaverCloudInitConfig): string {
  const fqdn = config.host.fqdn;

  return `services:
  console:
    image: \${LOADWEAVER_CONSOLE_IMAGE}
    container_name: ${LOADWEAVER_CONSOLE_CONTAINER}
    command: ['/bin/sh', '-c', 'CONFIG=https://${fqdn}/config.json node server.cjs']
    environment:
      PORT: '${LOADWEAVER_CONSOLE_PORT}'
      NODE_ENV: production
      DEFAULT_LOCALE: ${config.console.defaultLocale}
      CONFIG_ALLOWED_HOSTS: ${fqdn}
      CSP_ENFORCE: 'true'
    ports:
      - '127.0.0.1:${LOADWEAVER_CONSOLE_PORT}:${LOADWEAVER_CONSOLE_PORT}'
    restart: unless-stopped

  nginx:
    image: ${LOADWEAVER_NGINX_IMAGE}
    container_name: ${LOADWEAVER_NGINX_CONTAINER}
    # Host network: the Loadweaver API runs with host networking on 127.0.0.1:${LOADWEAVER_API_PORT} (bootstrap).
    network_mode: host
    depends_on:
      - console
    volumes:
      - ${LOADWEAVER_STACK_DIR}/sites-enabled:/etc/nginx/conf.d:ro
      - ${LOADWEAVER_STACK_DIR}/ssl:/etc/nginx/ssl:ro
      - ${LOADWEAVER_STACK_DIR}/certbot-webroot:/var/www/certbot:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    restart: unless-stopped
`;
}

/**
 * nftables table of the Cloud node (L11): the control-plane API listens on every address of the host (host network,
 * `LOADWEAVER_API_PORT`) and the node's own Loadweaver table accepts anything on non-Loadweaver interfaces, so this
 * table drops the API port on every interface but loopback and Loadweaver's own (overlay, pod bridge: still filtered
 * by the Loadweaver table). The public way in is nginx on 443 (to 127.0.0.1). A table of its own, so the agent's
 * atomic replacement of the Loadweaver table never touches it; it only drops, so it never opens anything.
 */
export function buildLoadweaverCloudFirewall(): string {
  return `table inet loadweaver_cloud
delete table inet loadweaver_cloud
table inet loadweaver_cloud {
  chain input {
    type filter hook input priority filter - 10; policy accept;
    iifname "lo" accept
    iifname { "lw-*", "lwbr0", "lwk*" } accept
    tcp dport ${LOADWEAVER_API_PORT} counter drop comment "loadweaver-cloud: API only through the TLS proxy"
  }
}
`;
}

/** Loads the firewall at boot, before Docker and the agent start the API; again whenever nftables.service reloads. */
const FIREWALL_UNIT = `[Unit]
Description=Loadweaver Cloud firewall (API port ${LOADWEAVER_API_PORT} off the public interfaces)
DefaultDependencies=no
Wants=network-pre.target
Before=network-pre.target docker.service loadweaver-agent.service
After=nftables.service
PartOf=nftables.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f ${LOADWEAVER_CLOUD_FIREWALL_FILE}

[Install]
WantedBy=sysinit.target nftables.service
`;

const SSHD_CONFIG = `
Include /etc/ssh/sshd_config.d/*.conf
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;

/**
 * Cloud-init user-data (base64 shell script) for a fresh Debian 12 / 13 or Ubuntu 22.04 / 24.04 server:
 *
 * 1. SSH key for Decabill's platform automation (as the sibling stacks; key-only).
 * 2. Release manifest + signature from the release, verified with OpenSSL against the compiled Loadweaver release
 *    keys; product and version checked.
 * 3. Node agent binary for the architecture, checked against the SHA-256 the signed manifest lists.
 * 4. Docker CE (Docker's apt repository) with live-restore, as the Loadweaver installer sets it up.
 * 5. `loadweaver-agent bootstrap --name … --public-host <fqdn> --public-url https://<fqdn>`: generates the cluster
 *    secrets on the node, starts etcd, Postgres and the API, joins the node. With operator SMTP (`config.email`) also
 *    the email flags (`--smtp-host` … `--email-from`; password via the root-only `--smtp-password-file`).
 * 6. Node components from the local control plane (`/api/install/components.sh`: gVisor, WireGuard, nftables, BIRD,
 *    keepalived, storage userland) and the agent's systemd unit; `systemctl enable --now loadweaver-agent`.
 * 7. Management endpoint under /opt/loadweaver: console server + nginx (TLS, Let's Encrypt via Certbot like the
 *    sibling stacks) serving the console on `/` and the API on `/api`, `/socket`, `/socket.io`, `/v2`. The console
 *    image is pinned by digest: the plan's `loadweaverConsoleImageDigest`, else the one the verified manifest lists.
 *
 * Before the bootstrap starts the API, an nftables table (`buildLoadweaverCloudFirewall`, loaded at every boot) keeps
 * the API port off the public interfaces: the only public way in is nginx on 80 / 443.
 */
export function buildLoadweaverCloudInitUserData(config: LoadweaverCloudInitConfig): string {
  const marker = `LOADWEAVER_${randomBytes(16).toString('hex')}`;
  const { fqdn, nodeName } = config.host;
  const { version, baseUrl, trustedKeys } = config.release;
  const { email } = config;
  const releaseUrl = `${baseUrl}/v${version}`;

  if (!LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN.test(config.cluster.adminClaimToken)) {
    throw new Error('Loadweaver provisioning needs a one-time admin claim token');
  }
  const bootstrapArgs = [
    '--name',
    nodeName,
    '--public-host',
    fqdn,
    '--public-url',
    `https://${fqdn}`,
    ...(config.cluster.name ? ['--cluster-name', config.cluster.name] : []),
    '--admin-claim-token-file',
    LOADWEAVER_ADMIN_CLAIM_TOKEN_FILE,
    ...(email ? ['--smtp-host', email.host] : []),
    ...(email?.port !== undefined ? ['--smtp-port', String(email.port)] : []),
    ...(email?.user ? ['--smtp-user', email.user] : []),
    ...(email?.password ? ['--smtp-password-file', LOADWEAVER_SMTP_PASSWORD_FILE] : []),
    ...(email?.from ? ['--email-from', email.from] : []),
  ]
    .map(quoteShellLiteral)
    .join(' ');
  // Operator SMTP password: root-only file like the admin claim token (never on the command line or in the log).
  const smtpPasswordWrite = email?.password
    ? `(umask 077 && printf '%s' ${quoteShellLiteral(email.password)} > ${LOADWEAVER_SMTP_PASSWORD_FILE})\n`
    : '';
  const handoverFiles = email?.password
    ? `${LOADWEAVER_ADMIN_CLAIM_TOKEN_FILE} ${LOADWEAVER_SMTP_PASSWORD_FILE}`
    : LOADWEAVER_ADMIN_CLAIM_TOKEN_FILE;
  const keyFiles = trustedKeys
    .map(
      (pem, index) => `cat > /etc/loadweaver-cloud/release-keys/${index}.pem <<'${marker}'
${pem.trim()}
${marker}`,
    )
    .join('\n');
  const nginxBootstrap = nginxServerBlocks(fqdn, {
    cert: '/etc/nginx/ssl/bootstrap.crt',
    key: '/etc/nginx/ssl/bootstrap.key',
  });
  const nginxLetsEncrypt = nginxServerBlocks(fqdn, {
    cert: `/etc/letsencrypt/live/${fqdn}/fullchain.pem`,
    key: `/etc/letsencrypt/live/${fqdn}/privkey.pem`,
  });
  const planDigest = config.console.imageDigest;

  if (planDigest !== undefined && !IMAGE_DIGEST_PATTERN.test(planDigest)) {
    throw new Error('loadweaverConsoleImageDigest must be sha256:<64 hex>');
  }

  // The console by digest: the plan's explicit pin, else the one the verified manifest lists (never a tag).
  const consoleImageStep = planDigest
    ? `LW_CONSOLE_IMAGE='${LOADWEAVER_CONSOLE_IMAGE_REPOSITORY}@${planDigest}'
LW_CONSOLE_PIN=plan
log "Console image pinned by the plan: $LW_CONSOLE_IMAGE"`
    : `LW_CONSOLE_DIGEST="$(jq -r --arg r '${LOADWEAVER_CONSOLE_IMAGE_REPOSITORY}' '.consoleImage | select(. != null and .repository == $r) | .digest' "$LW_WORK/manifest.json")"
printf '%s' "$LW_CONSOLE_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' || die "the release manifest pins no console image digest"
LW_CONSOLE_IMAGE="${LOADWEAVER_CONSOLE_IMAGE_REPOSITORY}@$LW_CONSOLE_DIGEST"
LW_CONSOLE_PIN=manifest
log "Console image from the verified manifest: $LW_CONSOLE_IMAGE"`;
  const script = `#!/bin/bash
set -euo pipefail

# Cloud-init user-data for Decabill's loadweaver service kind: a single-node Loadweaver cluster ${version}.

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a ${LOADWEAVER_PROVISIONING_LOG}
}
die() {
    log "ERROR: $*"
    exit 1
}

log "Starting Loadweaver provisioning (cloud-init user-data)"

for i in {1..10}; do
    if curl -fsS -m 5 -o /dev/null https://github.com 2>/dev/null; then
        log "Network is ready"
        break
    fi
    [ "$i" -eq 10 ] && log "WARNING: network check failed, continuing anyway"
    sleep 2
done

. /etc/os-release
case "$ID:$VERSION_ID" in
    debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;
    *) die "unsupported OS $ID $VERSION_ID (Loadweaver supports Debian 12 / 13, Ubuntu 22.04 / 24.04)" ;;
esac
case "$(uname -m)" in
    x86_64|amd64) LW_ARCH=amd64 ;;
    aarch64|arm64) LW_ARCH=arm64 ;;
    *) die "unsupported architecture $(uname -m)" ;;
esac

export DEBIAN_FRONTEND=noninteractive
log "Installing prerequisites..."
apt-get update -q
apt-get install -y -q --no-install-recommends openssh-server ca-certificates curl gnupg jq openssl coreutils nftables

log "Configuring SSH (key only)..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh
cat > /root/.ssh/authorized_keys <<'${marker}'
${config.ssh.publicKey}
${marker}
chmod 600 /root/.ssh/authorized_keys
cat > /etc/ssh/sshd_config <<'${marker}'
${SSHD_CONFIG}
${marker}
systemctl restart ssh || service ssh restart

log "Fetching and verifying the Loadweaver ${version} release manifest..."
mkdir -p /etc/loadweaver-cloud/release-keys /var/lib/loadweaver-cloud
chmod 700 /var/lib/loadweaver-cloud
${keyFiles}
LW_WORK=/var/lib/loadweaver-cloud
curl -fsSL --retry 5 --proto '=https' "${releaseUrl}/loadweaver-bundle-${version}.manifest.json" -o "$LW_WORK/manifest.json"
curl -fsSL --retry 5 --proto '=https' "${releaseUrl}/loadweaver-bundle-${version}.manifest.sig" -o "$LW_WORK/manifest.sig"
jq -r '.signature' "$LW_WORK/manifest.sig" | base64 -d > "$LW_WORK/manifest.sig.der"
LW_VERIFIED=""
for key in /etc/loadweaver-cloud/release-keys/*.pem; do
    if openssl dgst -sha256 -verify "$key" -signature "$LW_WORK/manifest.sig.der" "$LW_WORK/manifest.json" >/dev/null 2>&1; then
        LW_VERIFIED=1
        break
    fi
done
[ -n "$LW_VERIFIED" ] || die "the release manifest is not signed by a trusted Loadweaver release key"
jq -e --arg v '${version}' '.product == "loadweaver" and .version == $v' "$LW_WORK/manifest.json" >/dev/null \\
    || die "the release manifest is not Loadweaver ${version}"

LW_AGENT_PATH="$(jq -r --arg a "$LW_ARCH" '.components["node-agent"].files[$a] // empty' "$LW_WORK/manifest.json")"
[ -n "$LW_AGENT_PATH" ] || die "the release has no node agent for $LW_ARCH"
LW_AGENT_SHA256="$(jq -r --arg p "$LW_AGENT_PATH" '.artifacts[] | select(.path == $p) | .sha256' "$LW_WORK/manifest.json")"
printf '%s' "$LW_AGENT_SHA256" | grep -Eq '^[0-9a-f]{64}$' || die "the manifest lists no checksum for the agent"

${consoleImageStep}

log "Installing the node agent ($LW_ARCH)..."
curl -fsSL --retry 5 --proto '=https' "${releaseUrl}/loadweaver-agent-${version}-linux-$LW_ARCH" -o "$LW_WORK/loadweaver-agent"
echo "$LW_AGENT_SHA256  $LW_WORK/loadweaver-agent" | sha256sum -c - >/dev/null || die "agent checksum mismatch"
install -m 0755 "$LW_WORK/loadweaver-agent" /usr/local/bin/loadweaver-agent
rm -f "$LW_WORK/loadweaver-agent"

log "Installing Docker Engine with live-restore..."
lw_docker_repository() {
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
}
if ! command -v docker >/dev/null 2>&1; then
    lw_docker_repository
    apt-get install -y -q --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
# Images with Docker preinstalled may lack the Compose plugin the management endpoint needs.
if ! docker compose version >/dev/null 2>&1; then
    log "Installing the Docker Compose plugin..."
    apt-cache show docker-compose-plugin >/dev/null 2>&1 || lw_docker_repository
    apt-get install -y -q --no-install-recommends docker-compose-plugin || die "Docker Compose is required for the management endpoint"
fi
mkdir -p /etc/docker
[ -s /etc/docker/daemon.json ] || echo '{}' > /etc/docker/daemon.json
jq '.["live-restore"] = true' /etc/docker/daemon.json > /etc/docker/daemon.json.loadweaver
mv /etc/docker/daemon.json.loadweaver /etc/docker/daemon.json
systemctl enable --now docker
systemctl restart docker
for i in {1..30}; do
    docker info >/dev/null 2>&1 && break
    [ "$i" -eq 30 ] && die "Docker did not start"
    sleep 2
done

log "Keeping the API port ${LOADWEAVER_API_PORT} off the public interfaces (nftables)..."
mkdir -p /etc/loadweaver-cloud
cat > ${LOADWEAVER_CLOUD_FIREWALL_FILE} <<'${marker}'
${buildLoadweaverCloudFirewall()}
${marker}
cat > /etc/systemd/system/loadweaver-cloud-firewall.service <<'${marker}'
${FIREWALL_UNIT}
${marker}
systemctl daemon-reload
systemctl enable --now loadweaver-cloud-firewall.service || die "failed to load the firewall"

log "Bootstrapping the cluster (node ${nodeName}, ${fqdn})..."
# One-time admin claim token: handed over in a root-only file (never on the command line or in the log); the control
# plane keeps only its SHA-256. The provider's metadata service still serves this user-data to the node itself.
(umask 077 && printf '%s' '${config.cluster.adminClaimToken}' > ${LOADWEAVER_ADMIN_CLAIM_TOKEN_FILE})
${smtpPasswordWrite}/usr/local/bin/loadweaver-agent bootstrap ${bootstrapArgs} || {
    rm -f ${handoverFiles}
    die "bootstrap failed"
}
rm -f ${handoverFiles}

log "Installing the node components from the local control plane..."
curl -fsS --retry 10 --retry-connrefused "http://127.0.0.1:${LOADWEAVER_API_PORT}/api/install/components.sh" -o "$LW_WORK/components.sh"
bash "$LW_WORK/components.sh"
curl -fsS --retry 10 --retry-connrefused "http://127.0.0.1:${LOADWEAVER_API_PORT}/api/install/loadweaver-agent.service" \\
    -o /etc/systemd/system/loadweaver-agent.service
systemctl daemon-reload
systemctl enable --now loadweaver-agent

log "Setting up the management endpoint (console + TLS proxy)..."
mkdir -p ${LOADWEAVER_STACK_DIR}/sites-enabled ${LOADWEAVER_STACK_DIR}/ssl ${LOADWEAVER_STACK_DIR}/certbot-webroot
cat > ${LOADWEAVER_STACK_DIR}/sites-enabled/default.conf <<'${marker}'
${nginxBootstrap}
${marker}
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
    -keyout ${LOADWEAVER_STACK_DIR}/ssl/bootstrap.key \\
    -out ${LOADWEAVER_STACK_DIR}/ssl/bootstrap.crt \\
    -subj "/O=Loadweaver/CN=${fqdn}" -addext "subjectAltName=DNS:${fqdn}" 2>/dev/null \\
    || log "WARNING: failed to generate the bootstrap certificate"
chmod 600 ${LOADWEAVER_STACK_DIR}/ssl/bootstrap.key
printf 'LOADWEAVER_VERSION=%s\\nLOADWEAVER_CONSOLE_IMAGE=%s\\nLOADWEAVER_CONSOLE_PIN=%s\\n' '${version}' "$LW_CONSOLE_IMAGE" "$LW_CONSOLE_PIN" \\
    > ${LOADWEAVER_STACK_DIR}/.env
cat > ${LOADWEAVER_STACK_DIR}/docker-compose.yaml <<'${marker}'
${buildManagementCompose(config)}
${marker}
cd ${LOADWEAVER_STACK_DIR}
docker compose up -d || {
    docker compose logs || true
    die "failed to start the management endpoint"
}

${buildCertbotBootstrapScript({
  stackName: 'loadweaver',
  stackDir: LOADWEAVER_STACK_DIR,
  nginxContainerName: LOADWEAVER_NGINX_CONTAINER,
  fqdn,
  letsEncryptEmail: config.letsEncryptEmail,
  letsEncryptNginxConfig: nginxLetsEncrypt,
})}

log "Loadweaver ${version} is running on ${fqdn}: register the first account at https://${fqdn} with the admin claim token from the billing console (it becomes the cluster administrator)."
`;

  return Buffer.from(script).toString('base64');
}

/**
 * Update command for Decabill's subscription-update scheduler. Loadweaver updates itself (control plane, agents, OS
 * packages) through its own rollout from signed release bundles, so this never pulls or recreates anything of the
 * cluster and never uses `--pull=always`. It only re-pins the management endpoint's console image to the release the
 * cluster's own rollout installed (`loadweaver-agent version`), so console and API stay on the same release: by the
 * digest that release's manifest lists (`consoleImage`), after verifying the manifest's signature against the compiled
 * Loadweaver release keys and its product / version, exactly as cloud-init does for the agent binary. Nothing changes
 * when the manifest can't be fetched or verified (logged, exit 1, retried on the next run). A console pinned by the
 * plan (`LOADWEAVER_CONSOLE_PIN=plan`, or a digest from before the pin was recorded) is kept as is.
 */
export function buildLoadweaverUpdateCommand(
  trustedKeys: readonly string[] = RELEASE_SIGNING_KEYS.loadweaver,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const baseUrl = (
    stringValue(env['LOADWEAVER_CLOUD_RELEASE_BASE_URL']) ?? LOADWEAVER_DEFAULT_RELEASE_BASE_URL
  ).replace(/\/+$/, '');

  if (!RELEASE_BASE_URL_PATTERN.test(baseUrl)) {
    throw new Error('LOADWEAVER_CLOUD_RELEASE_BASE_URL must be a plain https URL');
  }

  const envFile = `${LOADWEAVER_STACK_DIR}/.env`;
  const writeEnv = (image: string, pin: string) =>
    `printf 'LOADWEAVER_VERSION=%s\\nLOADWEAVER_CONSOLE_IMAGE=%s\\nLOADWEAVER_CONSOLE_PIN=%s\\n' "$V" "${image}" '${pin}' > ${envFile}`;
  // PEM lines are base64 and headers only: safe inside single quotes.
  const keys = trustedKeys.map((pem, index) => {
    const lines = pem
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        if (!/^[A-Za-z0-9+/= -]+$/.test(line)) throw new Error('unexpected character in a release signing key');

        return `'${line}'`;
      });

    return `printf '%s\\n' ${lines.join(' ')} > "$W/key-${index}.pem"`;
  });
  const fail = (message: string) => `{ log "ERROR: ${message}"; exit 1; }`;

  return [
    `log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a ${LOADWEAVER_UPDATE_LOG}; }`,
    `V="$(/usr/local/bin/loadweaver-agent version 2>/dev/null | tr -d '[:space:]')"`,
    `if ! printf '%s' "$V" | grep -Eq '${SHELL_RELEASE_VERSION_ERE}'; then log "ERROR: no valid agent version"; exit 1; fi`,
    `CUR="$(sed -n 's/^LOADWEAVER_VERSION=//p' ${envFile})"`,
    `if [ "$V" = "$CUR" ]; then log "Console already on $V"; exit 0; fi`,
    `IMG="$(sed -n 's/^LOADWEAVER_CONSOLE_IMAGE=//p' ${envFile})"`,
    `PIN="$(sed -n 's/^LOADWEAVER_CONSOLE_PIN=//p' ${envFile})"`,
    // Pinned by the plan: only the recorded version advances, so the check above doesn't repeat every run.
    `case "$PIN:$IMG" in plan:*|:*@sha256:*) ${writeEnv('$IMG', 'plan')}; log "Console stays pinned to $IMG (plan); cluster now on $V"; exit 0;; esac`,
    `W="$(mktemp -d)"`,
    `trap 'rm -rf "$W"' EXIT`,
    ...keys,
    `curl -fsSL --retry 5 --proto '=https' "${baseUrl}/v$V/loadweaver-bundle-$V.manifest.json" -o "$W/manifest.json" || ${fail('cannot fetch the release manifest of $V')}`,
    `curl -fsSL --retry 5 --proto '=https' "${baseUrl}/v$V/loadweaver-bundle-$V.manifest.sig" -o "$W/manifest.sig" || ${fail('cannot fetch the manifest signature of $V')}`,
    `jq -r '.signature' "$W/manifest.sig" | base64 -d > "$W/manifest.sig.der" || ${fail('malformed manifest signature of $V')}`,
    `OK=""`,
    `for key in "$W"/key-*.pem; do if openssl dgst -sha256 -verify "$key" -signature "$W/manifest.sig.der" "$W/manifest.json" >/dev/null 2>&1; then OK=1; break; fi; done`,
    `[ -n "$OK" ] || ${fail('the release manifest of $V is not signed by a trusted Loadweaver release key')}`,
    `jq -e --arg v "$V" '.product == "loadweaver" and .version == $v' "$W/manifest.json" >/dev/null || ${fail('the release manifest is not Loadweaver $V')}`,
    `D="$(jq -r --arg r '${LOADWEAVER_CONSOLE_IMAGE_REPOSITORY}' '.consoleImage | select(. != null and .repository == $r) | .digest' "$W/manifest.json")"`,
    `printf '%s' "$D" | grep -Eq '^sha256:[0-9a-f]{64}$' || ${fail('the release manifest of $V pins no console image digest')}`,
    writeEnv(`${LOADWEAVER_CONSOLE_IMAGE_REPOSITORY}@$D`, 'manifest'),
    `cd ${LOADWEAVER_STACK_DIR} && docker compose up -d console 2>&1 | tee -a ${LOADWEAVER_UPDATE_LOG} || ${fail('console update failed')}`,
    `log "Console re-pinned from $CUR to $V ($D, verified manifest)"`,
  ].join('; ');
}

/** True when a subscription item (config snapshot) runs the `loadweaver` service kind. */
export function isLoadweaverItem(item: { configSnapshot?: Record<string, unknown> | null }): boolean {
  return (item.configSnapshot?.['service'] as string | undefined)?.trim() === 'loadweaver';
}

/**
 * Data-safe teardown guard: a cancellation, withdrawal or instant cancel of a subscription that runs a Loadweaver
 * cluster deletes the cluster's only Decabill-provisioned node and its data, so the caller must confirm it explicitly.
 * Returns the error message (`LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED`) or null when the action may proceed.
 */
export function loadweaverTeardownConfirmationError(
  items: ReadonlyArray<{ configSnapshot?: Record<string, unknown> | null }>,
  confirmed: boolean | undefined,
): string | null {
  if (confirmed === true || !items.some((item) => isLoadweaverItem(item))) {
    return null;
  }

  return LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED;
}

/** Grace period between the cancellation's effective date and the deletion of the server (`LOADWEAVER_TEARDOWN_GRACE_DAYS`). */
export function resolveLoadweaverTeardownGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['LOADWEAVER_TEARDOWN_GRACE_DAYS'];

  if (raw === undefined || raw.trim() === '') {
    return LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS;
  }

  const days = Number(raw);

  if (!Number.isInteger(days) || days < 0) {
    return LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS;
  }

  return Math.min(days, MAX_TEARDOWN_GRACE_DAYS);
}

/** When the Decabill-provisioned server of a cancelled Loadweaver subscription may be deleted. */
export function loadweaverTeardownNotBefore(cancelEffectiveAt: Date, graceDays: number): Date {
  return new Date(cancelEffectiveAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
}

export type LoadweaverClusterHealth =
  | 'provisioning'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'unreachable'
  | 'failed'
  | 'removed';

export interface LoadweaverProbeResult {
  ok: boolean;
  /** HTTP status, absent on network / TLS errors and timeouts. */
  status?: number;
  /** `GET /api/install/claim-status` only: whether the first registration still needs the admin claim token. */
  claimRequired?: boolean;
  /**
   * `GET /api/install/claim-status` only: the cluster has the claim hash configured. Absent from older clusters —
   * then a `claimRequired: false` proves nothing (a member / restore without the hash answers the same).
   */
  claimConfigured?: boolean;
}

/** How long after provisioning an unreachable endpoint counts as still starting (bootstrap, certificates, DNS). */
export const LOADWEAVER_STARTUP_WINDOW_MS = 45 * 60 * 1000;

/**
 * Maps provisioning state + probes of the public endpoint (`GET /api/health` of the control plane, `GET /` of the
 * console) to the cluster status shown in the billing console.
 */
export function mapLoadweaverClusterHealth(input: {
  provisioningStatus: 'pending' | 'active' | 'failed';
  hasProviderReference: boolean;
  provisionedAt?: Date | null;
  api?: LoadweaverProbeResult;
  console?: LoadweaverProbeResult;
  now?: Date;
}): LoadweaverClusterHealth {
  if (input.provisioningStatus === 'failed') return 'failed';

  if (input.provisioningStatus === 'pending') return 'provisioning';

  if (!input.hasProviderReference) return 'removed';

  if (input.api?.ok) return input.console?.ok ? 'healthy' : 'degraded';

  const now = input.now ?? new Date();
  const since = input.provisionedAt ? now.getTime() - input.provisionedAt.getTime() : Number.POSITIVE_INFINITY;

  return since < LOADWEAVER_STARTUP_WINDOW_MS ? 'starting' : 'unreachable';
}
