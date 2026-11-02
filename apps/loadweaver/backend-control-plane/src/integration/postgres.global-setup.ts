import {
  CONTAINER_ENV,
  docker,
  PORT_ENV,
  POSTGRES_IMAGE,
  VALKEY_CONTAINER_ENV,
  VALKEY_IMAGE,
  VALKEY_PORT_ENV,
} from './postgres.container';

/**
 * Starts a throwaway Postgres for the integration suite (small: 512 MB memory limit incl. the tmpfs data; every test
 * file gets its own database, dropped when the file is done).
 * Fails loudly when Docker is unavailable: integration tests are never skipped silently (section 6).
 */
export default async function globalSetup(): Promise<void> {
  const name = `lw-cp-it-${process.pid}-${Date.now()}`;

  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '--memory',
    '512m',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=384m',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_DB=loadweaver',
    '-p',
    '127.0.0.1::5432',
    POSTGRES_IMAGE,
  ]);
  process.env[CONTAINER_ENV] = name;

  const mapping = docker(['port', name, '5432/tcp']).split('\n')[0];
  const port = mapping.slice(mapping.lastIndexOf(':') + 1);

  process.env[PORT_ENV] = port;

  const valkey = `lw-cp-it-valkey-${process.pid}-${Date.now()}`;

  docker(['run', '-d', '--rm', '--name', valkey, '--memory', '64m', '-p', '127.0.0.1::6379', VALKEY_IMAGE]);
  process.env[VALKEY_CONTAINER_ENV] = valkey;

  const valkeyMapping = docker(['port', valkey, '6379/tcp']).split('\n')[0];

  process.env[VALKEY_PORT_ENV] = valkeyMapping.slice(valkeyMapping.lastIndexOf(':') + 1);

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'loadweaver', '-h', '127.0.0.1']);

      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error('Postgres for the integration tests did not become ready');
}
