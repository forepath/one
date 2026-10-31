import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  controlPlaneApiSpec,
  controlPlaneImages,
  postgresEtcdHosts,
  postgresSpec,
  type MemberContext,
} from './control-plane-containers';
import { logStoreSpec } from './log-store';
import {
  openSearchBackupSettings,
  POSTGRES_CLONE_CONTAINER,
  postgresCloneSpec,
  installSpiloWalgConfig,
  SPILO_BACKUP_SCHEDULE_NEVER,
  SPILO_WALG_CONFIG,
  spiloBackupEnvironment,
} from './platform-backups';

const secret = 'a'.repeat(64);
const base: ControlPlaneRole = {
  role: 'member',
  members: [
    { name: 'n1', address: '10.93.0.1', witness: false },
    { name: 'n2', address: '10.93.0.2', witness: false },
  ],
  automaticFailover: false,
  scope: 'lw-abc',
  environment: { DB_PASSWORD: 'super' },
  logStore: { clusterName: 'lw-abc', heapMb: 512, httpPort: 9200, transportPort: 9300 },
};
const withBackups: ControlPlaneRole = {
  ...base,
  platformBackups: {
    gatewayPort: 7480,
    bucket: 'lw-platform',
    region: 'garage',
    postgres: { accessKeyId: 'LWPBPOSTGRES0000N1', secretAccessKey: secret },
    opensearch: { accessKeyId: 'LWPBOPENSEARCH00N1', secretAccessKey: secret },
  },
};
const ctx: MemberContext = {
  nodeName: 'n1',
  address: '10.93.0.1',
  stateDir: '/var/lib/loadweaver',
  images: controlPlaneImages({}),
};

describe('control-plane data backups on members', () => {
  it('leaves Spilo, OpenSearch and the API unchanged without the feature (no restart on upgrade)', () => {
    expect(spiloBackupEnvironment(base)).toEqual({});
    expect(postgresSpec(ctx, base).env).not.toHaveProperty('USE_WALG_BACKUP');
    expect(openSearchBackupSettings(base)).toBeNull();
    expect(logStoreSpec('n1', '10.93.0.1', base, '/d', 'os').cmd).toBeUndefined();
    expect(controlPlaneApiSpec(ctx, base).env).not.toHaveProperty('LOADWEAVER_BACKUP_GATEWAY_LISTEN');
  });

  it('archives WAL through the gateway with the spike settings and disables Spilo retention', () => {
    const env = postgresSpec(ctx, withBackups).env;

    expect(env).toMatchObject({
      USE_WALG_BACKUP: 'true',
      USE_WALG_RESTORE: 'true',
      WAL_S3_BUCKET: 'lw-platform',
      AWS_ENDPOINT: 'http://127.0.0.1:7480',
      AWS_REGION: 'garage',
      AWS_S3_FORCE_PATH_STYLE: 'true',
      WALG_DISABLE_S3_SSE: 'true',
      WALG_PREVENT_WAL_OVERWRITE: 'true',
      AWS_ACCESS_KEY_ID: 'LWPBPOSTGRES0000N1',
      BACKUP_SCHEDULE: SPILO_BACKUP_SCHEDULE_NEVER,
      // Bounded archive reads: the gateway lives in the API, which waits for this database after a restart.
      WAL_RESTORE_TIMEOUT: '10',
    });
    expect(postgresSpec(ctx, withBackups).hash).not.toBe(postgresSpec(ctx, base).hash);
    // Without the pushed secret nothing is configured (a row read back from the database).
    expect(
      spiloBackupEnvironment({
        ...withBackups,
        platformBackups: { ...withBackups.platformBackups!, postgres: { accessKeyId: 'LWPBPOSTGRES0000N1' } },
      }),
    ).toEqual({});
  });

  it('bounds WAL-G retries with a read-only config file wherever it archives (live 3.43: a shutdown hung on a push)', () => {
    expect(JSON.parse(SPILO_WALG_CONFIG)).toEqual({ S3_MAX_RETRIES: '2' });
    expect(postgresSpec(ctx, withBackups).binds).toContain(
      '/var/lib/loadweaver/postgres-walg.json:/home/postgres/.walg.json:ro',
    );
    // Without archiving nothing changes (no bind, same hash as before: no restart on upgrade).
    expect(postgresSpec(ctx, base).binds).toEqual(['/var/lib/loadweaver/postgres:/home/postgres/pgdata']);
  });

  it('writes the WAL-G config file once, readable by Spilo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-walg-'));

    try {
      expect(await installSpiloWalgConfig(dir)).toBe(true);
      expect(await installSpiloWalgConfig(dir)).toBe(false);
      expect(await readFile(join(dir, 'postgres-walg.json'), 'utf8')).toBe(SPILO_WALG_CONFIG);
      expect((await stat(join(dir, 'postgres-walg.json'))).mode & 0o777).toBe(0o644);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs the API gateway on loopback', () => {
    expect(controlPlaneApiSpec(ctx, withBackups).env['LOADWEAVER_BACKUP_GATEWAY_LISTEN']).toBe('127.0.0.1:7480');
  });

  it('configures the OpenSearch repository client through a start script, secrets only in the keystore', () => {
    const spec = logStoreSpec('n1', '10.93.0.1', withBackups, '/d', 'os');

    expect(spec.cmd?.[0]).toBe('bash');
    expect(spec.cmd?.[2]).toContain('plugins/repository-s3');
    expect(spec.cmd?.[2]).toContain('s3.client.default.path_style_access=true');
    expect(spec.cmd?.[2]).not.toContain(secret);
    expect(spec.env['LW_BACKUP_S3_ENDPOINT']).toBe('127.0.0.1:7480');
    // Dotted (lower-case) env names become -E settings; the credentials must not.
    expect(Object.keys(spec.env).filter((k) => k.startsWith('s3.'))).toEqual([]);
  });

  it('clones into its own scope and ports, from the source scope up to the target time', () => {
    const role: ControlPlaneRole = {
      ...withBackups,
      platformBackups: {
        ...withBackups.platformBackups!,
        postgresClone: {
          id: 'r1',
          scope: 'lw-abc-r1',
          sourceScope: 'lw-abc',
          targetTime: '2026-10-19 10:00:00+00:00',
          pgPort: 5442,
          apiPort: 8018,
        },
      },
    };
    const spec = postgresCloneSpec(ctx, role, '/var/lib/loadweaver/postgres-pitr', postgresEtcdHosts(role));

    expect(spec?.name).toBe(POSTGRES_CLONE_CONTAINER);
    expect(spec?.env).toMatchObject({
      SCOPE: 'lw-abc-r1',
      PGPORT: '5442',
      APIPORT: '8018',
      CLONE_SCOPE: 'lw-abc',
      CLONE_METHOD: 'CLONE_WITH_WALE',
      CLONE_USE_WALG_RESTORE: 'true',
      CLONE_WAL_S3_BUCKET: 'lw-platform',
      CLONE_AWS_ENDPOINT: 'http://127.0.0.1:7480',
      CLONE_TARGET_TIME: '2026-10-19 10:00:00+00:00',
      ETCD3_HOSTS: '10.93.0.1:2379,10.93.0.2:2379',
      WAL_S3_BUCKET: 'lw-platform',
    });
    // WAL-G's bounded retries like the member's Spilo (live 3.43).
    expect(spec?.binds).toEqual([
      '/var/lib/loadweaver/postgres-pitr:/home/postgres/pgdata',
      '/var/lib/loadweaver/postgres-walg.json:/home/postgres/.walg.json:ro',
    ]);
    expect(postgresCloneSpec(ctx, withBackups, '/x', '')).toBeNull();
  });
});
