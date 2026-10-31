import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTAINER_ENV, PORT_ENV, VALKEY_PORT_ENV } from './postgres.container';

// Every test file gets its own database and Valkey key prefix: suites share the containers, not their state, so
// they pass in any order and combination.
const isolation = `it_${process.pid}_${randomBytes(4).toString('hex')}`;
const container = process.env[CONTAINER_ENV];

/** Creates the file's database; retried, since a previous suite's connections may still be closing. */
function createDatabase(name: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(
        'docker',
        ['exec', container as string, 'psql', '-U', 'postgres', '-qc', `CREATE DATABASE ${name} TEMPLATE template0`],
        { stdio: 'pipe' },
      );

      return;
    } catch (error) {
      if (attempt >= 10)
        throw new Error(`creating database ${name}: ${(error as { stderr?: Buffer }).stderr?.toString() ?? error}`);

      execFileSync('sleep', ['1']);
    }
  }
}

if (container) createDatabase(isolation);

// Configure the app before any module reads its environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: process.env[PORT_ENV] ?? '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  // The shared lab database is plain Postgres without TLS; the platform-backups lab covers TLS against Spilo.
  DB_SSL_MODE: 'disable',
  DB_DATABASE: container ? isolation : 'loadweaver',
  AUTHENTICATION_METHOD: 'api-key',
  STATIC_API_KEY: 'integration-test-api-key',
  ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  LOADWEAVER_CLUSTER_ID: 'it',
  LOADWEAVER_GRPC_HOSTNAMES: 'localhost',
  LOADWEAVER_GRPC_PORT: String(17000 + (process.pid % 2000)),
  LOADWEAVER_GRPC_ENDPOINTS: `localhost:${17000 + (process.pid % 2000)}`,
  RATE_LIMIT_ENABLED: 'false',
  // The test drives the workload controller tick by tick.
  LOADWEAVER_WORKLOAD_CONTROLLER: 'off',
  // Update rollout (3.26): tests drive the controller; no release checks against GitHub, no automatic plans.
  LOADWEAVER_ROLLOUT_CONTROLLER: 'off',
  LOADWEAVER_UPDATE_POLICY: 'off',
  LOADWEAVER_UPDATE_CHECK: 'off',
  LOADWEAVER_OBJECT_STORE: 'off',
  // No log store in the control-plane integration; the logs lab runs a real OpenSearch.
  OPENSEARCH_ENABLED: 'false',
  VALKEY_HOST: '127.0.0.1',
  VALKEY_PORT: process.env[VALKEY_PORT_ENV] ?? '6379',
  VALKEY_KEY_PREFIX: `loadweaver:${isolation}`,
  // Reports go to a scratch directory; the object-store test covers the Garage provider.
  FILE_STORAGE_PROVIDER: 'local',
  FILE_STORAGE_ROOT: mkdtempSync(join(tmpdir(), 'lw-it-files-')),
});
