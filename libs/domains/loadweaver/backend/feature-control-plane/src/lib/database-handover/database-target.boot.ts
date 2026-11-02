import { POSTGRES_TLS_SERVER_NAME } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Logger } from '@nestjs/common';
import { Client, type ClientConfig } from 'pg';

import { databaseDeployment, quoteIdent } from './database-handover.utils';
import {
  databaseStateDir,
  databaseTarget,
  readDatabaseTargetFile,
  type ExternalDatabase,
} from './database-target.runtime';
import { DEFAULT_DATABASE_PROXY_PORT, MembersLeaderProxy, membersProxy } from './members-leader-proxy';

/** Minimal query surface of a pg client (fakes in tests). */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export function externalDatabaseFrom(env: NodeJS.ProcessEnv, ssl: ClientConfig['ssl']): ExternalDatabase {
  return {
    host: env['DB_HOST'] || 'localhost',
    port: parseInt(env['DB_PORT'] || '5432', 10),
    user: env['DB_USERNAME'] || 'postgres',
    password: env['DB_PASSWORD'] || 'postgres',
    database: env['DB_DATABASE'] || 'loadweaver',
    ssl,
  };
}

/**
 * Lifts a write freeze a handover left on the external database (database-level `default_transaction_read_only`): a
 * crash in the middle of a handover, or the end of a successful one (the process now writes to the members; only the
 * subscription writes here). Only the database setting is touched.
 */
export async function liftDatabaseFreeze(client: SqlClient, database: string): Promise<boolean> {
  const { rows } = await client.query<{ setconfig: string[] | null }>(
    `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
      WHERE d.datname = $1 AND s.setrole = 0`,
    [database],
  );

  if (!rows.some((r) => (r.setconfig ?? []).some((c) => c.startsWith('default_transaction_read_only=')))) return false;

  await client.query('SET default_transaction_read_only = off');
  await client.query(`ALTER DATABASE ${quoteIdent(database)} RESET default_transaction_read_only`);

  return true;
}

/**
 * A dedicated pg client emits `error` when its server goes away while it is idle (e.g. the members' Postgres restarts
 * for `wal_level = logical`, live 3.43); without a listener that is an uncaught exception that ends the process. The
 * pending / next query still fails, which is where the handover handles it.
 */
export function guardClientErrors<T extends { on(event: 'error', listener: (error: Error) => void): unknown }>(
  client: T,
): T {
  client.on('error', () => undefined);

  return client;
}

export async function connectExternal(external: ExternalDatabase, timeoutMs = 5_000): Promise<Client> {
  const client = new Client({
    host: external.host,
    port: external.port,
    user: external.user,
    password: external.password,
    database: external.database,
    ssl: external.ssl,
    connectionTimeoutMillis: timeoutMs,
    application_name: 'loadweaver-database-handover',
  });

  guardClientErrors(client);
  await client.connect();

  return client;
}

/**
 * Boot step of the database handover (3.43), run by `main.ts` before TypeORM reads its settings: decides on-node vs
 * external, loads the target file from the state volume, lifts a leftover freeze, and on the members' target starts the
 * in-process leader proxy and points `DB_HOST` / `DB_PORT` / TLS at it (the external settings are kept for the
 * fallback and the external copy). `externalSsl`: the TLS settings of the original environment (`databaseSsl`).
 */
export async function prepareDatabaseTarget(env: NodeJS.ProcessEnv, externalSsl: unknown): Promise<void> {
  const logger = new Logger('DatabaseHandover');
  const deployment = databaseDeployment(env);

  databaseTarget.deployment = deployment;

  if (deployment !== 'external') return;

  const external = externalDatabaseFrom(env, externalSsl as ClientConfig['ssl']);
  const file = await readDatabaseTargetFile(databaseStateDir(env));

  databaseTarget.external = external;
  databaseTarget.file = file;

  try {
    const client = await connectExternal(external);

    try {
      if (await liftDatabaseFreeze(client, external.database))
        logger.warn('Lifted the write freeze of a handover from the external database');
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    logger.warn(`External database not checked for a leftover freeze: ${(error as Error).message}`);
  }

  if (file?.target !== 'members' || !file.caCertificatePem) {
    logger.log("Control-plane database: external (handed over to the members once one's Postgres leader is up)");

    return;
  }

  const port = parseInt(env['LOADWEAVER_DATABASE_PROXY_PORT'] || String(DEFAULT_DATABASE_PROXY_PORT), 10);
  const proxy = new MembersLeaderProxy(file.members, port);

  await proxy.start();
  membersProxy.current = proxy;
  databaseTarget.startedInFallback = databaseTarget.fallback;
  env['DB_HOST'] = '127.0.0.1';
  env['DB_PORT'] = String(port);
  env['DB_SSL_MODE'] = 'verify-full';
  env['DB_SSL_CA'] = file.caCertificatePem;
  env['DB_SSL_CA_FILE'] = '';
  env['DB_SSL_SERVERNAME'] = POSTGRES_TLS_SERVER_NAME;
  logger.log(
    databaseTarget.fallback
      ? 'Control-plane database: members (none reachable: read-only from the external copy until one is back)'
      : 'Control-plane database: members (through the in-process leader proxy)',
  );
}
