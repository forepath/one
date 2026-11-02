import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseProviderPackageSpec } from '@forepath/shared/backend/util-dynamic-provider-registry';

/** `GET /integrations` (3.41): one env-configured integration, without values that could be secret. */
export interface IntegrationEnvStatus {
  id: 'smtp' | 'otlp' | 'geoip' | 'releases' | 'postureSync' | 'kms' | 'auth' | 'plugins';
  /** Plain English; the console translates by id. */
  label: string;
  active: boolean;
  details: Record<string, string>;
}

/** Defaults of the schedules (`control-plane-queue.module.ts`). */
const DEFAULT_UPDATE_CHECK_CRON = '17 */6 * * *';
const DEFAULT_POSTURE_SYNC_CRON = '*/2 * * * *';
const DEFAULT_RELEASES_REPOSITORY = 'forepath/one';
const GEOIP_BUNDLED_FILE = 'dbip-country-lite.mmdb';

/** The `DYNAMIC_*` plugin variables and their detail keys. */
const PLUGIN_ENVS: ReadonlyArray<readonly [string, string]> = [
  ['DYNAMIC_DNS_PROVIDERS', 'dnsProviders'],
  ['DYNAMIC_FAILOVER_IP_PROVIDERS', 'failoverIpProviders'],
  ['DYNAMIC_REGISTRAR_PROVIDERS', 'registrarProviders'],
  ['DYNAMIC_KMS_PROVIDERS', 'kmsProviders'],
  ['DYNAMIC_POSTURE_PLUGINS', 'posturePlugins'],
];

function value(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]?.trim();

  return v ? v : undefined;
}

/**
 * A URL reduced to what is safe to show: scheme, host, port and path; user info, query and fragment (where tokens
 * hide) are dropped. Not a URL: null.
 */
export function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;

    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return null;
  }
}

/** Plugin module names of a `DYNAMIC_*` value: package specifiers / `file:` paths, credentials in URLs removed. */
export function pluginModules(raw: string | undefined): string[] | 'invalid' {
  try {
    return parseProviderPackageSpec(raw).map((entry) => {
      const specifier = entry.specifier;

      return /^[a-z][a-z0-9+.-]*:\/\//i.test(specifier) ? (safeUrl(specifier) ?? 'url') : specifier;
    });
  } catch {
    return 'invalid';
  }
}

/** Same resolution as the identity lib's `getAuthenticationMethod`, on the given env (pure, specced). */
function authMethod(env: NodeJS.ProcessEnv): 'api-key' | 'keycloak' | 'users' {
  const explicit = env['AUTHENTICATION_METHOD']?.toLowerCase().trim();

  if (explicit === 'api-key' || explicit === 'keycloak' || explicit === 'users') return explicit;

  return env['STATIC_API_KEY'] ? 'api-key' : 'keycloak';
}

/**
 * Read-only status of the env-configured integrations (3.41): which are active and their non-secret settings.
 * Never passwords, tokens, client secrets, user names or file contents — only names, hosts, schedules and paths.
 */
export function integrationEnvStatus(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): IntegrationEnvStatus[] {
  const smtpHost = value(env, 'SMTP_HOST');
  const smtpPort = value(env, 'SMTP_PORT');
  const smtp: IntegrationEnvStatus = {
    id: 'smtp',
    label: 'Email (SMTP)',
    active: !!smtpHost && !!smtpPort,
    details: {
      ...(smtpHost ? { server: `${smtpHost}:${smtpPort ?? '1025'}` } : {}),
      from: value(env, 'EMAIL_FROM') ?? 'noreply@localhost',
      authentication: value(env, 'SMTP_USER') && value(env, 'SMTP_PASSWORD') ? 'on' : 'off',
    },
  };

  const otlpEnabled = env['OTEL_ENABLED'] === 'true';
  const otlpEndpoint = safeUrl(value(env, 'OTEL_EXPORTER_OTLP_ENDPOINT'));
  const otlpMetricsEndpoint = safeUrl(value(env, 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'));
  const otlp: IntegrationEnvStatus = {
    id: 'otlp',
    label: 'OpenTelemetry (OTLP)',
    active: otlpEnabled,
    details: {
      enabled: otlpEnabled ? 'true' : 'false',
      ...(otlpEndpoint ? { endpoint: otlpEndpoint } : {}),
      ...(otlpMetricsEndpoint ? { metricsEndpoint: otlpMetricsEndpoint } : {}),
      ...(value(env, 'OTEL_SERVICE_NAME') ? { serviceName: value(env, 'OTEL_SERVICE_NAME') as string } : {}),
    },
  };

  const geoipCustom = value(env, 'LOADWEAVER_GEOIP_DB');
  const binaryDir = value(env, 'LOADWEAVER_AGENT_BINARY_DIR');
  const geoipPath = geoipCustom ?? (binaryDir ? join(binaryDir, GEOIP_BUNDLED_FILE) : undefined);
  const geoip: IntegrationEnvStatus = {
    id: 'geoip',
    label: 'GeoIP database',
    active: !!geoipPath && exists(geoipPath),
    details: {
      source: geoipCustom ? 'custom' : 'bundled',
      ...(geoipPath ? { path: geoipPath } : {}),
    },
  };

  const updateCheck = env['LOADWEAVER_UPDATE_CHECK'] !== 'off';
  const releases: IntegrationEnvStatus = {
    id: 'releases',
    label: 'Releases and update checks',
    active: updateCheck,
    details: {
      repository: value(env, 'LOADWEAVER_RELEASES_REPOSITORY') ?? DEFAULT_RELEASES_REPOSITORY,
      updateCheck: updateCheck ? 'on' : 'off',
      ...(updateCheck ? { cron: value(env, 'LOADWEAVER_UPDATE_CHECK_CRON') ?? DEFAULT_UPDATE_CHECK_CRON } : {}),
      rollout: env['LOADWEAVER_UPDATE_POLICY'] === 'off' ? 'off' : 'on',
    },
  };

  const postureCron = value(env, 'LOADWEAVER_POSTURE_SYNC_CRON');
  const postureSync: IntegrationEnvStatus = {
    id: 'postureSync',
    label: 'Device posture sync schedule',
    active: true,
    details: { cron: postureCron ?? DEFAULT_POSTURE_SYNC_CRON, source: postureCron ? 'env' : 'default' },
  };

  const kmsProvider = value(env, 'LOADWEAVER_MASTER_KEY_KMS');
  const vaultAddress = safeUrl(value(env, 'VAULT_ADDR'));
  const kms: IntegrationEnvStatus = {
    id: 'kms',
    label: 'Master key KMS',
    active: !!kmsProvider,
    details: kmsProvider
      ? {
          provider: kmsProvider,
          ...(kmsProvider === 'vault-transit'
            ? {
                ...(vaultAddress ? { address: vaultAddress } : {}),
                ...(value(env, 'VAULT_NAMESPACE') ? { namespace: value(env, 'VAULT_NAMESPACE') as string } : {}),
                mount: value(env, 'LOADWEAVER_VAULT_TRANSIT_MOUNT') ?? 'transit',
                key: value(env, 'LOADWEAVER_VAULT_TRANSIT_KEY') ?? 'loadweaver',
              }
            : {}),
        }
      : { provider: 'shamir' },
  };

  const method = authMethod(env);
  const keycloakUrl = safeUrl(value(env, 'KEYCLOAK_SERVER_URL') ?? value(env, 'KEYCLOAK_AUTH_SERVER_URL'));
  const auth: IntegrationEnvStatus = {
    id: 'auth',
    label: 'Authentication',
    active: true,
    details: {
      method,
      ...(method === 'keycloak'
        ? {
            ...(keycloakUrl ? { keycloakUrl } : {}),
            ...(value(env, 'KEYCLOAK_REALM') ? { realm: value(env, 'KEYCLOAK_REALM') as string } : {}),
            ...(value(env, 'KEYCLOAK_CLIENT_ID') ? { clientId: value(env, 'KEYCLOAK_CLIENT_ID') as string } : {}),
          }
        : {}),
    },
  };

  const pluginDetails: Record<string, string> = {};

  for (const [key, detail] of PLUGIN_ENVS) {
    const modules = pluginModules(env[key]);

    if (modules === 'invalid') pluginDetails[detail] = 'invalid';
    else if (modules.length > 0) pluginDetails[detail] = modules.join(', ');
  }

  const plugins: IntegrationEnvStatus = {
    id: 'plugins',
    label: 'Provider plugins',
    active: Object.keys(pluginDetails).length > 0,
    details: pluginDetails,
  };

  return [smtp, otlp, geoip, releases, postureSync, kms, auth, plugins];
}
