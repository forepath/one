import { readFileSync } from 'node:fs';
import { checkServerIdentity, type ConnectionOptions, type TlsOptions } from 'node:tls';

/**
 * TLS of the control plane's Postgres connections (TypeORM and everything derived from its options: contract
 * migrations, `COPY … FROM PROGRAM` for platform backups, metrics). Spilo refuses TCP logins without TLS from
 * anywhere but loopback, and the API reaches the leader through the agent's leader proxy, so on members the
 * connection is always TLS, verified against the cluster CA:
 *
 * - `DB_SSL_MODE`: `verify-full` (default with `NODE_ENV=production`): TLS, the server certificate must chain to the
 *   CA and carry `DB_SSL_SERVERNAME` (or `DB_HOST` when that is unset); `require`: TLS without verification;
 *   `disable` (default elsewhere): no TLS.
 * - `DB_SSL_CA` (PEM) or `DB_SSL_CA_FILE` (path): the CA bundle for `verify-full`.
 * - `DB_SSL_SERVERNAME`: the name checked in the certificate (the agent sets `postgres.loadweaver`).
 */
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full';

/** What the Postgres driver passes to `tls.connect` (TypeORM types it as `TlsOptions`). */
export type DatabaseTlsOptions = TlsOptions & Pick<ConnectionOptions, 'servername' | 'checkServerIdentity'>;

const MODES: readonly DatabaseSslMode[] = ['disable', 'require', 'verify-full'];

export function databaseSslMode(env: NodeJS.ProcessEnv): DatabaseSslMode {
  const raw = env['DB_SSL_MODE']?.trim().toLowerCase();

  if (!raw) return env['NODE_ENV'] === 'production' ? 'verify-full' : 'disable';

  if (!MODES.includes(raw as DatabaseSslMode))
    throw new Error(`DB_SSL_MODE must be one of ${MODES.join(', ')} (got "${raw}")`);

  return raw as DatabaseSslMode;
}

/** The `ssl` option of the Postgres driver for the environment; throws on an unusable configuration. */
export function databaseSsl(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): false | DatabaseTlsOptions {
  const mode = databaseSslMode(env);

  if (mode === 'disable') return false;

  if (mode === 'require') return { rejectUnauthorized: false };

  const inline = env['DB_SSL_CA'];
  const file = env['DB_SSL_CA_FILE']?.trim();
  const ca = inline?.trim() ? inline : file ? readFile(file) : '';

  if (!ca.includes('-----BEGIN CERTIFICATE-----'))
    throw new Error('DB_SSL_MODE=verify-full needs the CA certificate in DB_SSL_CA or DB_SSL_CA_FILE');

  const servername = env['DB_SSL_SERVERNAME']?.trim();

  // Without a server name the driver checks the host the API connects to (a name or an IP SAN). With one, it is
  // checked whatever the host is (the driver replaces `servername` with a host name for SNI).
  return servername
    ? {
        ca,
        rejectUnauthorized: true,
        servername,
        checkServerIdentity: (_host, cert) => checkServerIdentity(servername, cert),
      }
    : { ca, rejectUnauthorized: true };
}
