import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TlsOptions } from 'node:tls';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BackupEntity,
  ClusterEntity,
  DrEnvelopeService,
  GarageAdminClient,
  gatewayAccessKeyId,
  issuePostgresServerCertificate,
  MetricsStore,
  gatewaySecret,
  NodeEntity,
  ObjectStoreGenerationEntity,
  objectStorePorts,
  objectStoreSecrets,
  PLATFORM_BUCKET,
  PlatformBackupStateEntity,
  PlatformBackupsService,
  PlatformObjectStore,
  PlatformRestoreEntity,
  platformBackupsRole,
  walgPrefix,
  withPlatformBackupSecrets,
  type DrEnvelope,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  choosePostgresTls,
  controlPlaneApiSpec,
  controlPlaneImages,
  logStoreSpec,
  postgresCloneSpec,
  postgresEtcdHosts,
  postgresSpec,
  type MemberContext,
} from '@forepath/loadweaver/backend/feature-node-agent';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';
import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCertificateAuthority } from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { docker } from './postgres.container';
import { removeContainers, startGarage, type GarageContainer } from './garage.containers';

/**
 * Control-plane data backups end to end (3.20, M6 step 3b), with the real images: Spilo (Postgres + TimescaleDB +
 * WAL-G) archiving through the control plane's S3 gateway into Garage, a base backup by the scheduler (with its DR
 * envelope), an overwrite of an archived WAL segment refused, point-in-time recovery into a new scope with exactly
 * the rows up to the target time, WAL-G retention under a delete grant; OpenSearch snapshots through the gateway
 * restored into a fresh node; etcd snapshots restored with `etcdutl`. The control plane runs as the real app
 * against Spilo; the test plays the agent with the agent's own container specs.
 */

const run = `${process.pid}-${Date.now()}`;
const GATEWAY_PORT = 17480 + (process.pid % 400);
const GATEWAY_HOST = `host.docker.internal:${GATEWAY_PORT}`;
const execFileAsync = promisify(execFile);
const PASSWORD = 'postgres';
const OPENSEARCH_S3_IMAGE = `loadweaver-opensearch-s3-lab:${COMPONENT_IMAGES.opensearch.split('@sha256:')[1].slice(0, 12)}`;

/** Removes one container mid-test (the shared helper also drops Garage's config directory). */
function rmContainer(name: string): void {
  try {
    docker(['rm', '-f', name]);
  } catch {
    // gone
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;

  while (Date.now() < deadline) {
    try {
      const value = await fn();

      if (value) return value;
    } catch (error) {
      last = error;
    }

    await sleep(1_000);
  }

  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`);
}

function port(container: string, inner: number): number {
  const mapping = docker(['port', container, `${inner}/tcp`]).split('\n')[0];

  return Number(mapping.slice(mapping.lastIndexOf(':') + 1));
}

function psql(container: string, sql: string, portNumber = 5432, db = 'postgres'): string {
  return docker([
    'exec',
    '-e',
    `PGPASSWORD=${PASSWORD}`,
    container,
    'psql',
    '-h',
    '/var/run/postgresql',
    '-p',
    String(portNumber),
    '-U',
    'postgres',
    '-d',
    db,
    '-tAqc',
    sql,
  ]);
}

/** `docker run` args for an agent container spec (env / cmd), in the lab's network namespace. */
function runArgs(
  spec: { name: string; image: string; env: Record<string, string>; cmd?: string[] },
  extra: string[],
): string[] {
  return [
    'run',
    '-d',
    '--name',
    spec.name,
    ...extra,
    ...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    spec.image,
    ...(spec.cmd ?? []),
  ];
}

describe('control-plane data backups (lab)', () => {
  const env = { ...process.env };
  const names = {
    net: `lw-pb-lab-net-${run}`,
    etcd: `lw-pb-lab-etcd-${run}`,
    spilo: `lw-pb-lab-spilo-${run}`,
    clone: `lw-pb-lab-clone-${run}`,
    garage: `lw-pb-lab-garage-${run}`,
    os1: `lw-pb-lab-os1-${run}`,
    os2: `lw-pb-lab-os2-${run}`,
    etcdRestore: `lw-pb-lab-etcd-restore-${run}`,
  };
  const containers = Object.values(names).filter((n) => n !== names.net);
  const workDir = mkdtempSync(join(tmpdir(), 'lw-pb-lab-'));
  let garage: GarageContainer;
  let app: INestApplication;
  let dataSource: DataSource;
  let backups: PlatformBackupsService;
  let scope: string;
  let role: ControlPlaneRole;
  let caCertificatePem: string;
  const ctx: MemberContext = {
    nodeName: 'n1',
    address: '127.0.0.1',
    stateDir: '/unused',
    images: controlPlaneImages({}),
  };
  const ports = { pg: 0, clonePg: 0, cloneApi: 0, etcd: 0 };
  const key = () => process.env['ENCRYPTION_KEY'] as string;

  beforeAll(async () => {
    // A previous run that died in the app's start (Nest exits the process) leaves its containers behind: this lab runs
    // one at a time, so everything named lw-pb-lab-* is stale.
    for (const stale of docker(['ps', '-aq', '--filter', 'name=lw-pb-lab-']).split('\n').filter(Boolean))
      rmContainer(stale);

    for (const stale of docker(['network', 'ls', '-q', '--filter', 'name=lw-pb-lab-']).split('\n').filter(Boolean)) {
      try {
        docker(['network', 'rm', stale]);
      } catch {
        // in use elsewhere
      }
    }

    docker(['network', 'create', names.net]);

    // Garage (the cluster's object store), reached by the gateway on mapped ports.
    const generation = 1;
    const garagePorts = objectStorePorts(generation);
    const secrets = objectStoreSecrets(key(), generation);

    garage = startGarage({
      name: names.garage,
      replicationFactor: 1,
      ports: garagePorts,
      rpcSecret: secrets.rpcSecret,
      adminToken: secrets.adminToken,
      rpcPublicAddress: '127.0.0.1',
    });

    const admin = new GarageAdminClient(garage.adminUrl, secrets.adminToken);
    const id = await until('garage', async () => await admin.selfId());
    const layout = await admin.layout();

    await admin.stageLayout([{ id, zone: 'lab', capacity: 1024 ** 3, tags: ['n1'] }], []);
    await admin.applyLayout(layout.version + 1);

    // The member's network namespace: etcd owns it (Spilo, its clone and the gateway client share it, like host
    // networking on a member); the gateway in this process is reached as host.docker.internal.
    docker([
      'run',
      '-d',
      '--name',
      names.etcd,
      '--network',
      names.net,
      '--add-host',
      'host.docker.internal:host-gateway',
      ...['2379', '5432', '5442', '8008', '8018'].flatMap((p) => ['-p', `127.0.0.1::${p}`]),
      '--memory',
      '256m',
      COMPONENT_IMAGES.etcd,
      'etcd',
      '--name',
      'n1',
      '--data-dir',
      '/var/lib/etcd',
      '--listen-client-urls',
      'http://0.0.0.0:2379',
      '--advertise-client-urls',
      'http://127.0.0.1:2379',
    ]);
    ports.pg = port(names.etcd, 5432);
    ports.clonePg = port(names.etcd, 5442);
    ports.cloneApi = port(names.etcd, 8018);
    ports.etcd = port(names.etcd, 2379);

    // The control plane's view: platform backups on, gateway on all interfaces of this test host.
    scope = 'lw-lab';
    role = {
      role: 'member',
      members: [{ name: 'n1', address: '127.0.0.1', witness: false }],
      automaticFailover: false,
      scope,
      environment: {
        DB_USERNAME: 'postgres',
        DB_PASSWORD: PASSWORD,
        LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl',
        LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'admin',
      },
      logStore: { clusterName: 'lw-lab', heapMb: 512, httpPort: 9200, transportPort: 9300 },
    };
    role.platformBackups = withPlatformBackupSecrets(
      platformBackupsRole('n1', 'member', undefined, null, {
        ENCRYPTION_KEY: key(),
        LOADWEAVER_BACKUP_GATEWAY_PORT: String(GATEWAY_PORT),
      })!,
      key(),
    );

    // The member's Postgres certificate from a cluster CA, as the control plane pushes it and the agent installs it.
    const ca = await createCertificateAuthority({ commonName: `Loadweaver cluster CA ${scope}`, validityDays: 30 });

    caCertificatePem = ca.certificatePem;
    role.postgresTls = await issuePostgresServerCertificate(ca, scope, 'n1', '127.0.0.1');
    ctx.postgresTls = choosePostgresTls(null, role.postgresTls);

    const spilo = postgresSpec(ctx, role);

    docker(
      runArgs(
        {
          ...spilo,
          name: names.spilo,
          env: { ...spilo.env, AWS_ENDPOINT: `http://${GATEWAY_HOST}` },
        },
        ['--network', `container:${names.etcd}`, '--memory', '1g'],
      ),
    );
    await until('Spilo primary', async () => psql(names.spilo, 'SELECT NOT pg_is_in_recovery()') === 't', 180_000);
    psql(names.spilo, 'CREATE DATABASE loadweaver');

    // The API's database TLS exactly as the agent renders it (verify-full against the CA, the shared name).
    const apiEnv = controlPlaneApiSpec(ctx, role).env;

    expect(apiEnv['DB_SSL_MODE']).toBe('verify-full');
    Object.assign(process.env, {
      DB_SSL_MODE: apiEnv['DB_SSL_MODE'],
      DB_SSL_CA: apiEnv['DB_SSL_CA'],
      DB_SSL_SERVERNAME: apiEnv['DB_SSL_SERVERNAME'],
      DB_HOST: '127.0.0.1',
      DB_PORT: String(ports.pg),
      DB_DATABASE: 'loadweaver',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: PASSWORD,
      LOADWEAVER_CLUSTER_ID: scope,
      LOADWEAVER_BACKUP_GATEWAY_LISTEN: `0.0.0.0:${GATEWAY_PORT}`,
      // The test drives the scheduler.
      LOADWEAVER_PLATFORM_BACKUPS: 'off',
      LOADWEAVER_ETCD_ENDPOINT: `http://127.0.0.1:${ports.etcd}`,
    });
    // Imported only now: the app's TypeORM configuration reads the database settings at import time.
    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    dataSource = app.get(DataSource);
    backups = app.get(PlatformBackupsService);

    // A member n1 holding object-store generation 1 (its S3 / admin ports are this lab's Garage).
    await dataSource.getRepository(NodeEntity).save(
      dataSource.getRepository(NodeEntity).create({
        name: 'n1',
        site: 'lab',
        wireguardPublicKey: 'x'.repeat(44),
        joinedAt: new Date(),
        controlPlane: true,
        witness: false,
        overlayV4: '127.0.0.1',
        protocolFeatures: ['platform-backups'],
        // A member that can hold a master-key share (the backup key is wrapped with the master key).
        sealPublicKey: generateSealKeyPair().publicKey,
        connected: true,
      }),
    );
    await dataSource.getRepository(ObjectStoreGenerationEntity).save(
      dataSource.getRepository(ObjectStoreGenerationEntity).create({
        generation,
        replicationFactor: 1,
        state: 'active',
        holders: ['n1'],
        garageNodes: { n1: id },
        observedMembers: ['n1'],
        observedSince: new Date(),
        stateChangedAt: new Date(),
        copy: null,
      }),
    );

    const store = app.get(PlatformObjectStore) as unknown as { endpoint: (n: NodeEntity, p: number) => string };

    store.endpoint = (_n, p) => (p === garagePorts.admin ? garage.adminUrl : garage.s3Url);
    (backups as unknown as { patroniUrl: () => string }).patroniUrl = () =>
      `http://127.0.0.1:${ports.cloneApi}/patroni`;
    expect((await dataSource.getRepository(ClusterEntity).findOneOrFail({ where: {} })).clusterId).toBe(scope);
  }, 600_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    Object.assign(process.env, env);
    removeContainers(containers);

    try {
      docker(['network', 'rm', names.net]);
    } catch {
      // gone
    }

    // etcdutl wrote root-owned files into the work directory.
    try {
      docker(['run', '--rm', '-v', `${workDir}:/work`, COMPONENT_IMAGES['node-shell'], 'rm', '-rf', '/work/restored']);
    } catch {
      // nothing to remove
    }

    rmSync(workDir, { recursive: true, force: true });
  }, 120_000);

  const client = (role: 'postgres' | 'opensearch') => {
    const id = gatewayAccessKeyId(key(), role, 'n1');

    return new S3Client({
      endpoint: `http://127.0.0.1:${GATEWAY_PORT}`,
      region: 'garage',
      forcePathStyle: true,
      credentials: { accessKeyId: id, secretAccessKey: gatewaySecret(key(), id) },
      maxAttempts: 1,
    });
  };

  async function archived(): Promise<{ count: number; failed: number; last: string }> {
    const [row] = await dataSource.query(
      'SELECT archived_count::int AS count, failed_count::int AS failed, last_archived_wal AS last FROM pg_stat_archiver',
    );

    return row;
  }

  async function switchAndArchive(): Promise<void> {
    const before = (await archived()).count;

    await dataSource.query('SELECT pg_switch_wal()');
    await until('WAL archived', async () => (await archived()).count > before, 120_000);
  }

  /** A connection of the test process to Spilo through Docker's port mapping (not loopback for Spilo). */
  async function connect(ssl: false | (TlsOptions & { servername?: string })): Promise<DataSource> {
    return await new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: ports.pg,
      username: 'postgres',
      password: PASSWORD,
      database: 'loadweaver',
      ssl,
    }).initialize();
  }

  it('connects the API with TLS verified against the cluster CA; Spilo refuses plain TCP logins', async () => {
    const [session] = await dataSource.query(
      `SELECT s.ssl, host(inet_client_addr()) AS client FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
    );

    expect(session.ssl).toBe(true);
    // Not a loopback login: Spilo's pg_hba asks for TLS here.
    expect(session.client).not.toMatch(/^(127\.|::1$)/);
    await expect(connect(false)).rejects.toThrow(/no encryption|pg_hba/);
    // Another CA or another name is refused by the API's verification.
    const other = await createCertificateAuthority({ commonName: 'another CA', validityDays: 1 });

    await expect(connect({ ca: other.certificatePem, servername: 'postgres.loadweaver' })).rejects.toThrow();
    await expect(connect({ ca: caCertificatePem, servername: 'api.loadweaver' })).rejects.toThrow(/api\.loadweaver/);
  });

  it("keeps metrics on Spilo's Apache-licensed TimescaleDB: hypertables, roll-ups by the control plane", async () => {
    const [{ license }] = await dataSource.query(`SELECT current_setting('timescaledb.license') AS license`);

    expect(license).toBe('apache');

    const metrics = app.get(MetricsStore);

    await until('metrics setup', async () => metrics.mode);
    expect(metrics.mode).toBe('hypertables');
    expect(await metrics.setup()).toBe(false);
    await metrics.rollup();
    await metrics.retention();
  });

  let targetTime: Date;
  let firstBackup: string;

  it('archives WAL continuously and takes a base backup with its DR envelope (TimescaleDB included)', async () => {
    expect(scope).toBe(scope.toLowerCase());
    // The app's metrics store may be creating the extension at the same moment.
    await until('timescaledb', async () => {
      await dataSource.query('CREATE EXTENSION IF NOT EXISTS timescaledb');

      return true;
    });
    await dataSource.query('CREATE TABLE lab_rows (at timestamptz NOT NULL, n int NOT NULL)');
    await dataSource.query(`SELECT create_hypertable('lab_rows', 'at')`);
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(1, 100) g`);

    const result = await backups.run('postgres', { type: 'system' });

    expect(result).toMatchObject({ kind: 'postgres', status: 'succeeded' });
    firstBackup = result.backup as string;
    expect(firstBackup).toMatch(/^base_[0-9A-F]{24}$/);

    const row = await dataSource
      .getRepository(BackupEntity)
      .findOneOrFail({ where: { resource: 'platform/postgres', snapshotId: firstBackup } });

    expect(row.status).toBe('succeeded');
    expect(row.bytes).toBeGreaterThan(1_000_000);

    // The envelope next to the backup opens with the backup key.
    const s3 = await app.get(PlatformObjectStore).client();
    const envelope = JSON.parse(
      (await (
        await s3.send(new GetObjectCommand({ Bucket: PLATFORM_BUCKET, Key: `dr-envelope/${firstBackup}.json` }))
      ).Body?.transformToString()) as string,
    ) as DrEnvelope;

    s3.destroy();
    expect((await app.get(DrEnvelopeService).open(envelope)).env.ENCRYPTION_KEY).toBe(key());
    expect((await archived()).failed).toBe(0);
  }, 300_000);

  it('refuses to overwrite an archived WAL segment and to delete without a retention grant', async () => {
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(101, 200) g`);
    await switchAndArchive();

    const { last } = await archived();
    const pg = client('postgres');
    const walKey = `${walgPrefix(scope)}wal_005/${last}.br`;
    const lz4Key = `${walgPrefix(scope)}wal_005/${last}.lz4`;
    const existing = await pg
      .send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: walKey }))
      .then(() => walKey)
      .catch(() => lz4Key);

    await expect(
      pg.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: existing, Body: 'forged' })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });

    // WAL-G's own delete (as a compromised Spilo would run it) is refused without a grant: the backup stays.
    // Asynchronously: the gateway WAL-G talks to runs in this process.
    const result = await execFileAsync(
      'docker',
      ['exec', names.spilo, 'bash', '-c', 'envdir /run/etc/wal-e.d/env wal-g delete everything FORCE --confirm'],
      { timeout: 120_000 },
    ).then(
      () => 'deleted',
      () => 'refused',
    );

    expect(result).toBe('refused');

    await pg.send(
      new HeadObjectCommand({
        Bucket: PLATFORM_BUCKET,
        Key: `${walgPrefix(scope)}basebackups_005/${firstBackup}_backup_stop_sentinel.json`,
      }),
    );
    pg.destroy();
  }, 180_000);

  it('refuses multi-object deletes without a grant, reading the keys exactly as the client signed them', async () => {
    const pg = client('postgres');
    const sentinel = `${walgPrefix(scope)}basebackups_005/${firstBackup}_backup_stop_sentinel.json`;
    const remove = async (keys: string[]) =>
      await pg
        .send(
          new DeleteObjectsCommand({
            Bucket: PLATFORM_BUCKET,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: false },
          }),
        )
        .then(
          () => 'deleted',
          (error: { name?: string }) => error.name,
        );

    // The AWS SDK's body (XML-escaped keys) parses: refused for the missing grant, not as malformed XML.
    expect(await remove([sentinel, `${walgPrefix(scope)}wal_005/a&b<c>'"`])).toBe('AccessDenied');
    // A key outside the client's prefix next to one inside it.
    expect(await remove([`${walgPrefix(scope)}wal_005/x`, 'opensearch/other'])).toBe('AccessDenied');

    // Still there.
    await pg.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: sentinel }));
    pg.destroy();
  });

  it('restores to a point in time into a new scope with exactly the rows up to the target', async () => {
    [{ now: targetTime }] = await dataSource.query('SELECT now() AS now');
    await sleep(1_500);
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(201, 300) g`);
    await switchAndArchive();

    const restore = await backups.requestRestore({ targetTime: targetTime.toISOString() }, { type: 'system' });

    expect(restore).toMatchObject({ state: 'requested', node: 'n1', sourceScope: scope });
    expect(restore.scope).not.toBe(scope);

    // The agent's part: the clone from the member's desired state.
    const row = await dataSource.getRepository(PlatformRestoreEntity).findOneByOrFail({ id: restore.id });
    const cloneRole: ControlPlaneRole = {
      ...role,
      platformBackups: {
        ...role.platformBackups!,
        ...platformBackupsRole('n1', 'member', undefined, row, {
          ENCRYPTION_KEY: key(),
          LOADWEAVER_BACKUP_GATEWAY_PORT: String(GATEWAY_PORT),
        }),
        postgres: role.platformBackups!.postgres,
        opensearch: role.platformBackups!.opensearch,
      },
    };
    const spec = postgresCloneSpec(ctx, cloneRole, '/unused', postgresEtcdHosts(cloneRole));

    expect(spec?.env['CLONE_TARGET_TIME']).toContain('+00:00');
    docker(
      runArgs(
        {
          ...spec!,
          name: names.clone,
          env: {
            ...spec!.env,
            AWS_ENDPOINT: `http://${GATEWAY_HOST}`,
            CLONE_AWS_ENDPOINT: `http://${GATEWAY_HOST}`,
          },
        },
        ['--network', `container:${names.etcd}`, '--memory', '1g'],
      ),
    );

    await until(
      'the clone to become primary',
      async () => {
        await backups.watchRestores();

        return (
          (await dataSource.getRepository(PlatformRestoreEntity).findOneByOrFail({ id: restore.id })).state === 'ready'
        );
      },
      300_000,
    );

    expect(psql(names.clone, 'SELECT count(*) FROM lab_rows', 5442, 'loadweaver')).toBe('200');
    expect(psql(names.clone, 'SELECT max(n) FROM lab_rows', 5442, 'loadweaver')).toBe('200');
    expect(
      psql(
        names.clone,
        `SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name = 'lab_rows'`,
        5442,
        'loadweaver',
      ),
    ).toBe('1');
    // The running cluster is untouched.
    expect((await dataSource.query('SELECT count(*)::int AS c FROM lab_rows'))[0].c).toBe(300);

    const discarded = await backups.discardRestore(restore.id, { type: 'system' });

    expect(discarded.state).toBe('discarded');
    rmContainer(names.clone);
  }, 600_000);

  it('applies retention through WAL-G under a delete grant and keeps the catalog in step', async () => {
    const second = await backups.run('postgres', { type: 'system' });

    expect(second.status).toBe('succeeded');

    const deleted = await backups.retention('postgres', scope, 1);

    expect(deleted).toEqual([firstBackup]);

    const rows = await dataSource.getRepository(BackupEntity).find({ where: { resource: 'platform/postgres' } });

    expect(rows.find((r) => r.snapshotId === firstBackup)?.deletedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.snapshotId === second.backup)?.deletedAt).toBeNull();

    const s3 = await app.get(PlatformObjectStore).client();

    await expect(
      s3.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: `dr-envelope/${firstBackup}.json` })),
    ).rejects.toMatchObject({ name: 'NotFound' });
    s3.destroy();
    // The grant is gone again.
    expect(await dataSource.query('SELECT count(*)::int AS c FROM lw_platform_backup_grants')).toEqual([{ c: 0 }]);
  }, 300_000);

  it('snapshots etcd through the scheduler and restores it with etcdutl', async () => {
    const put = (k: string, v: string) =>
      fetch(`http://127.0.0.1:${ports.etcd}/v3/kv/put`, {
        method: 'POST',
        body: JSON.stringify({ key: Buffer.from(k).toString('base64'), value: Buffer.from(v).toString('base64') }),
      });

    await put('/lab/key', 'before-snapshot');

    // The scheduler: etcd's schedule (hourly at :15) is due once the kind was first seen more than an hour ago.
    await dataSource.getRepository(PlatformBackupStateEntity).save({
      kind: 'etcd',
      firstSeenAt: new Date(Date.now() - 2 * 3_600_000),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      lastBackup: null,
      runningUntil: null,
    });
    process.env['OPENSEARCH_ENABLED'] = 'false';

    const results = await backups.tick();
    const etcd = results.find((r) => r.kind === 'etcd');

    expect(etcd).toMatchObject({ status: 'succeeded' });
    // Not due again right away.
    expect((await backups.tick()).find((r) => r.kind === 'etcd')).toBeUndefined();
    await put('/lab/key', 'after-snapshot');

    const { body } = await backups.etcdSnapshotStream(etcd!.backup as string, { type: 'system' });
    const chunks: Buffer[] = [];

    for await (const c of body as AsyncIterable<Buffer>) chunks.push(c);

    writeFileSync(join(workDir, 'snapshot.db'), Buffer.concat(chunks));
    execFileSync('chmod', ['-R', 'a+rwx', workDir]);

    // The documented restore: etcdutl into a fresh data directory, then a single-member etcd from it.
    docker([
      'run',
      '--rm',
      '-v',
      `${workDir}:/work`,
      COMPONENT_IMAGES.etcd,
      'etcdutl',
      'snapshot',
      'restore',
      '/work/snapshot.db',
      '--data-dir',
      '/work/restored',
      '--name',
      'n1',
      '--initial-cluster',
      'n1=http://127.0.0.1:2380',
      '--initial-advertise-peer-urls',
      'http://127.0.0.1:2380',
    ]);
    docker([
      'run',
      '-d',
      '--name',
      names.etcdRestore,
      '-v',
      `${workDir}:/work`,
      '-p',
      '127.0.0.1::2379',
      COMPONENT_IMAGES.etcd,
      'etcd',
      '--name',
      'n1',
      '--data-dir',
      '/work/restored',
      '--listen-client-urls',
      'http://0.0.0.0:2379',
      '--advertise-client-urls',
      'http://127.0.0.1:2379',
    ]);

    const restoredPort = port(names.etcdRestore, 2379);
    const value = await until('restored etcd', async () => {
      const res = await fetch(`http://127.0.0.1:${restoredPort}/v3/kv/range`, {
        method: 'POST',
        body: JSON.stringify({ key: Buffer.from('/lab/key').toString('base64') }),
      });
      const json = (await res.json()) as { kvs?: { value: string }[] };

      return json.kvs?.[0] ? Buffer.from(json.kvs[0].value, 'base64').toString() : null;
    });

    expect(value).toBe('before-snapshot');
    rmContainer(names.etcdRestore);

    // Retention of etcd snapshots (the control plane's own objects).
    expect((await backups.run('etcd', { type: 'system' })).status).toBe('succeeded');
    expect(await backups.retention('etcd', scope, 1)).toEqual([etcd!.backup]);
  }, 300_000);

  it('snapshots OpenSearch through the gateway and restores an index into a fresh node', async () => {
    // Stop Postgres' clone memory first; build the release's derived image (repository-s3) once.
    try {
      docker(['image', 'inspect', OPENSEARCH_S3_IMAGE]);
    } catch {
      execFileSync(
        'docker',
        [
          'build',
          '-t',
          OPENSEARCH_S3_IMAGE,
          '-f',
          join(__dirname, '../../../../../libs/domains/loadweaver/shared/util-release/images/opensearch-s3.Dockerfile'),
          join(__dirname, '../../../../../libs/domains/loadweaver/shared/util-release/images'),
        ],
        { stdio: 'pipe', timeout: 900_000 },
      );
    }

    const start = (name: string) => {
      const spec = logStoreSpec(
        'n1',
        '_site_',
        { ...role, logStore: { ...role.logStore!, heapMb: 512 } },
        '/unused',
        OPENSEARCH_S3_IMAGE,
      );

      docker(
        runArgs({ ...spec, name, env: { ...spec.env, LW_BACKUP_S3_ENDPOINT: GATEWAY_HOST } }, [
          '--network',
          names.net,
          '--add-host',
          'host.docker.internal:host-gateway',
          '-p',
          '127.0.0.1::9200',
          '--memory',
          String(spec.memoryBytes),
          '--tmpfs',
          '/usr/share/opensearch/data:uid=1000,gid=1000',
        ]),
      );

      const url = `http://127.0.0.1:${port(name, 9200)}`;

      return url;
    };
    const os1 = start(names.os1);
    const ready = async (url: string) =>
      await until(
        'OpenSearch',
        async () => ((await (await fetch(`${url}/_cluster/health`)).json()) as { status?: string }).status !== 'red',
        180_000,
      );

    await ready(os1);
    await fetch(`${os1}/logs-lab/_bulk?refresh=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: Array.from({ length: 50 }, (_, i) => `{"index":{}}\n{"n":${i}}\n`).join(''),
    });
    process.env['OPENSEARCH_ENABLED'] = 'true';
    process.env['OPENSEARCH_NODE'] = os1;

    const first = await backups.run('opensearch', { type: 'system' });

    expect(first).toMatchObject({ status: 'succeeded' });

    // A second snapshot rewrites index.latest (whitelisted) and adds index-N (new).
    await fetch(`${os1}/logs-lab/_doc?refresh=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"n":50}',
    });

    const second = await backups.run('opensearch', { type: 'system' });

    expect(second).toMatchObject({ status: 'succeeded' });
    // Retention deletes the first snapshot under a grant.
    expect(await backups.retention('opensearch', scope, 1)).toEqual([first.backup]);

    // A fresh node with the same repository: restore the index (renamed).
    const os2 = start(names.os2);

    await ready(os2);
    process.env['OPENSEARCH_NODE'] = os2;
    await (backups as unknown as { openSearch: () => { ensureRepository(b: string, p: string): Promise<void> } })
      .openSearch()
      .ensureRepository(PLATFORM_BUCKET, `opensearch/${scope}`);

    const restored = await backups.restoreOpenSearch(
      { snapshot: second.backup as string, indices: ['logs-lab'] },
      { type: 'system' },
    );

    expect(restored).toEqual({ indices: ['restored-logs-lab'], failedShards: 0 });

    const count = await until('restored documents', async () => {
      const res = (await (await fetch(`${os2}/restored-logs-lab/_count`)).json()) as { count?: number };

      return res.count ?? null;
    });

    expect(count).toBe(51);
    rmContainer(names.os1);
    rmContainer(names.os2);
  }, 1_200_000);
});
