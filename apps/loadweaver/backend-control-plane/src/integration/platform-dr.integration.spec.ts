import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  activePlatformState,
  BackupDeletionEntity,
  BackupEntity,
  BackupRetentionEntity,
  BackupSchedulerService,
  DrRecoveryEntity,
  DrRecoveryService,
  drRestore,
  drToolRequestSchema,
  GarageAdminClient,
  JoinTokenEntity,
  MasterKeyEntity,
  NetworkStateService,
  NodeEntity,
  NodesService,
  ObjectStoreGenerationEntity,
  objectStorePorts,
  objectStoreSecrets,
  PLATFORM_BUCKET,
  PlatformBackupsService,
  PlatformCopyEntity,
  PlatformCopyService,
  PlatformCredentialsService,
  PlatformCutoverEntity,
  PlatformCutoverService,
  PlatformObjectStore,
  PlatformRestoreEntity,
  platformBackupsRole,
  ResourceEntity,
  ResourceStoreService,
  walgPrefix,
  withPlatformBackupSecrets,
  withPlatformState,
  type DrToolResult,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  applyPostgresCutover,
  CLONE_MARKER,
  controlPlaneImages,
  etcdRestoreArgs,
  postgresCloneSpec,
  postgresEtcdHosts,
  postgresRestoreScript,
  postgresSpec,
  writeScopeMarker,
  type MemberContext,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { LOADWEAVER_API_VERSION, type Resource } from '@forepath/loadweaver/shared/util-model';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { startFakeObjectLockS3 } from './fake-object-lock-s3';
import { removeContainers, startGarage, type GarageContainer } from './garage.containers';
import { docker } from './postgres.container';

/**
 * Disaster recovery and the remaining backup gaps (3.20, M6 step 3c), with the real images: Spilo + WAL-G through the
 * control plane's gateway into Garage (as in the platform-backups lab), plus a second, independent Garage (same pinned
 * image) as the cluster's external S3 target:
 * - the platform bucket is copied there encrypted, verified (size + ETag, newest envelope read back);
 * - object lock: Garage has no S3 Object Lock, so the lock path (bucket lock check, compliance retention on every
 *   upload, no pruning while locked, refused deletes kept) runs against an in-test fake S3 (`fake-object-lock-s3.ts`).
 *   Object lock is NOT lab-verified against a real lock-capable S3 provider;
 * - shortening the platform retention and deleting a platform backup wait for a second admin and the delay;
 * - a cut-over to a point-in-time clone: plan, second admin, final base backup, the clone's database learns the
 *   cut-over, the test plays the member's agent with the agent's own cut-over code, the API continues on the clone;
 * - the fresh-node side of a whole-cluster disaster recovery: the DR tool (2 of 3 kit shares) against the external
 *   copy, etcd restored with `etcdutl`, Postgres with the agent's WAL-G restore script, Patroni adopting it;
 * - the restored control plane's recovery: previous nodes lost, object store retired, join token, master key handed
 *   over and re-sealed to the new member.
 */

const run = `${process.pid}-${Date.now()}`;
const GATEWAY_PORT = 17880 + (process.pid % 100);
const GATEWAY_HOST = `host.docker.internal:${GATEWAY_PORT}`;
const PASSWORD = 'postgres';
/** The external target's own key (Garage format: `GK` + 24 hex, 64 hex secret). */
const EXTERNAL = {
  accessKeyId: `GK${randomBytes(12).toString('hex')}`,
  secretAccessKey: randomBytes(32).toString('hex'),
  bucket: 'lw-dr',
};
/** The test process reaches Spilo through Docker's port mapping without TLS (lab only, as before step 3c). */
const LAB_SPILO_ENV = { ALLOW_NOSSL: 'true' };
const execFileAsync = promisify(execFile);
const LOCKED_CREDENTIALS = 'secret://ops/locked-target';

function rmContainer(name: string): void {
  try {
    docker(['rm', '-f', name]);
  } catch {
    // gone
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function runArgs(spec: { name: string; image: string; env: Record<string, string>; cmd?: string[] }, extra: string[]) {
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

/** Root-owned files the containers left in a host directory go with a throw-away root container. */
function rootRm(dir: string): void {
  try {
    docker([
      'run',
      '--rm',
      '-v',
      `${dir}:/work`,
      COMPONENT_IMAGES['node-shell'],
      'sh',
      '-c',
      'rm -rf /work/* /work/.??*',
    ]);
  } catch {
    // nothing to remove
  }

  rmSync(dir, { recursive: true, force: true });
}

describe('disaster recovery and platform backup gaps (lab)', () => {
  const env = { ...process.env };
  const names = {
    net: `lw-dr-lab-net-${run}`,
    etcd: `lw-dr-lab-etcd-${run}`,
    spilo: `lw-dr-lab-spilo-${run}`,
    spilo2: `lw-dr-lab-spilo2-${run}`,
    clone: `lw-dr-lab-clone-${run}`,
    garage: `lw-dr-lab-garage-${run}`,
    external: `lw-dr-lab-external-${run}`,
    drEtcd: `lw-dr-lab-dr-etcd-${run}`,
    drSpilo: `lw-dr-lab-dr-spilo-${run}`,
  };
  const containers = Object.values(names).filter((n) => n !== names.net);
  const stateDir = mkdtempSync(join(tmpdir(), 'lw-dr-lab-state-'));
  const drDir = mkdtempSync(join(tmpdir(), 'lw-dr-lab-fresh-'));
  let garage: GarageContainer;
  let app: INestApplication;
  let dataSource: DataSource;
  let backups: PlatformBackupsService;
  let copies: PlatformCopyService;
  let cutovers: PlatformCutoverService;
  let external: GarageContainer;
  let externalS3: S3Client;
  let scope: string;
  let role: ControlPlaneRole;
  const ctx: MemberContext = { nodeName: 'n1', address: '127.0.0.1', stateDir, images: controlPlaneImages({}) };
  const ports = { pg: 0, patroni: 0, clonePg: 0, cloneApi: 0, etcd: 0 };
  const key = () => process.env['ENCRYPTION_KEY'] as string;
  const target = {
    type: 's3' as const,
    endpoint: '',
    bucket: EXTERNAL.bucket,
    region: 'garage',
    prefix: 'cluster-a/',
    credentials: 'secret://ops/dr-target',
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const address = app.getHttpServer().address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method,
      headers: { authorization: 'Bearer integration-test-api-key', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  beforeAll(async () => {
    for (const stale of docker(['ps', '-aq', '--filter', 'name=lw-dr-lab-']).split('\n').filter(Boolean))
      rmContainer(stale);

    docker(['network', 'create', names.net]);

    // The external target: a second, independent Garage with its own key and bucket.
    const externalPorts = objectStorePorts(9);
    const externalAdminToken = randomBytes(24).toString('base64url');

    external = startGarage({
      name: names.external,
      replicationFactor: 1,
      ports: externalPorts,
      rpcSecret: randomBytes(32).toString('hex'),
      adminToken: externalAdminToken,
      rpcPublicAddress: '127.0.0.1',
    });

    const externalAdmin = new GarageAdminClient(external.adminUrl, externalAdminToken);
    const externalId = await until('external garage', async () => await externalAdmin.selfId());
    const externalLayout = await externalAdmin.layout();

    await externalAdmin.stageLayout([{ id: externalId, zone: 'offsite', capacity: 1024 ** 3, tags: ['x'] }], []);
    await externalAdmin.applyLayout(externalLayout.version + 1);
    await until('external bucket', async () => {
      await externalAdmin.ensureKey(EXTERNAL.accessKeyId, EXTERNAL.secretAccessKey, 'lab-offsite');
      await externalAdmin.ensureBucket(EXTERNAL.bucket, EXTERNAL.accessKeyId);

      return true;
    });
    target.endpoint = external.s3Url;
    externalS3 = new S3Client({
      endpoint: external.s3Url,
      region: 'garage',
      forcePathStyle: true,
      credentials: { accessKeyId: EXTERNAL.accessKeyId, secretAccessKey: EXTERNAL.secretAccessKey },
    });

    // Garage generation 1 (the cluster's object store).
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

    // The member's network namespace (etcd owns it; Spilo, its clone and the adopted clone share it).
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
    ports.patroni = port(names.etcd, 8008);
    ports.clonePg = port(names.etcd, 5442);
    ports.cloneApi = port(names.etcd, 8018);
    ports.etcd = port(names.etcd, 2379);

    scope = 'lw-drlab';
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
    };
    role.platformBackups = withPlatformBackupSecrets(
      platformBackupsRole('n1', 'member', undefined, null, {
        ENCRYPTION_KEY: key(),
        LOADWEAVER_BACKUP_GATEWAY_PORT: String(GATEWAY_PORT),
      })!,
      key(),
    );

    // The member's data directories on this host, like `<state>/postgres` on a node (the cut-over moves them).
    mkdirSync(join(stateDir, 'postgres'), { recursive: true });
    await writeScopeMarker(stateDir, scope);

    const spilo = postgresSpec(ctx, role);

    docker(
      runArgs(
        {
          ...spilo,
          name: names.spilo,
          env: { ...spilo.env, ...LAB_SPILO_ENV, AWS_ENDPOINT: `http://${GATEWAY_HOST}` },
        },
        [
          '--network',
          `container:${names.etcd}`,
          '--memory',
          '1g',
          '-v',
          `${join(stateDir, 'postgres')}:/home/postgres/pgdata`,
        ],
      ),
    );
    await until('Spilo primary', async () => psql(names.spilo, 'SELECT NOT pg_is_in_recovery()') === 't', 180_000);
    psql(names.spilo, 'CREATE DATABASE loadweaver');

    Object.assign(process.env, {
      DB_SSL_MODE: 'disable',
      DB_HOST: '127.0.0.1',
      DB_PORT: String(ports.pg),
      DB_DATABASE: 'loadweaver',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: PASSWORD,
      LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl',
      LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'admin',
      LOADWEAVER_CLUSTER_ID: scope,
      LOADWEAVER_BACKUP_GATEWAY_LISTEN: `0.0.0.0:${GATEWAY_PORT}`,
      LOADWEAVER_PLATFORM_BACKUPS: 'off',
      LOADWEAVER_PLATFORM_CLONE_SSL: 'disable',
      LOADWEAVER_ETCD_ENDPOINT: `http://127.0.0.1:${ports.etcd}`,
      LOADWEAVER_BACKUPS: 'off',
    });

    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    dataSource = app.get(DataSource);
    backups = app.get(PlatformBackupsService);
    copies = app.get(PlatformCopyService);
    cutovers = app.get(PlatformCutoverService);

    await dataSource.getRepository(NodeEntity).save(
      dataSource.getRepository(NodeEntity).create({
        name: 'n1',
        site: 'default',
        wireguardPublicKey: 'x'.repeat(44),
        joinedAt: new Date(),
        controlPlane: true,
        witness: false,
        overlayV4: '127.0.0.1',
        protocolFeatures: ['platform-backups', 'platform-cutover'],
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
    Object.assign(cutovers as unknown as Record<string, unknown>, {
      cloneDatabase: () => ({ host: '127.0.0.1', port: ports.clonePg }),
      patroniUrl: () => `http://127.0.0.1:${ports.patroni}/patroni`,
    });
    // The target's credentials secret (the secrets API is covered elsewhere).
    (app.get(PlatformCredentialsService) as unknown as Record<string, unknown>)['providerConfig'] = async (
      ref: string,
    ) => {
      expect([target.credentials, LOCKED_CREDENTIALS]).toContain(ref);

      return ref === LOCKED_CREDENTIALS
        ? { accessKeyId: 'fake', secretAccessKey: 'fake' }
        : { accessKeyId: EXTERNAL.accessKeyId, secretAccessKey: EXTERNAL.secretAccessKey };
    };

    const backupTarget = {
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'BackupTarget',
      metadata: { name: 'offsite' },
      spec: target,
    } as Resource;

    await app.get(ResourceStoreService).upsert(dataSource.manager, backupTarget, 'system');
  }, 600_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    externalS3?.destroy();
    Object.assign(process.env, env);
    removeContainers(containers);

    try {
      docker(['network', 'rm', names.net]);
    } catch {
      // gone
    }

    rootRm(stateDir);
    rootRm(drDir);
  }, 120_000);

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

  const externalKeys = async (prefix: string) =>
    ((await externalS3.send(new ListObjectsV2Command({ Bucket: EXTERNAL.bucket, Prefix: prefix }))).Contents ?? []).map(
      (c) => c.Key as string,
    );

  let firstBackup: string;

  it('copies the platform bucket to the external target (second Garage): encrypted, verified', async () => {
    await until('timescaledb', async () => {
      await dataSource.query('CREATE EXTENSION IF NOT EXISTS timescaledb');

      return true;
    });
    await dataSource.query('CREATE TABLE lab_rows (at timestamptz NOT NULL, n int NOT NULL)');
    await dataSource.query(`SELECT create_hypertable('lab_rows', 'at')`);
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(1, 100) g`);

    const base = await backups.run('postgres', { type: 'system' });

    expect(base.status).toBe('succeeded');
    firstBackup = base.backup as string;
    expect((await backups.run('etcd', { type: 'system' })).status).toBe('succeeded');
    await switchAndArchive();

    // A declared external target: no pin.
    expect((await backups.status()).pins).toEqual([]);

    const started = Date.now();
    const [result] = await copies.run();
    const seconds = (Date.now() - started) / 1000;

    expect(result).toMatchObject({ target: 'offsite', status: 'succeeded', error: null });
    expect(result.copied).toBeGreaterThan(5);
    process.stderr.write(`[dr-lab] first external copy: ${result.copied} objects in ${seconds.toFixed(1)} s\n`);

    const sentinel = `cluster-a/platform/${walgPrefix(scope)}basebackups_005/${firstBackup}_backup_stop_sentinel.json`;
    const keys = await externalKeys('cluster-a/platform/');

    expect(keys).toEqual(
      expect.arrayContaining([
        sentinel,
        `cluster-a/platform/dr-envelope/${firstBackup}.json`,
        'cluster-a/platform/dr/cluster.json',
        'cluster-a/platform/dr/keys.json',
      ]),
    );
    expect(keys.some((k) => k.includes('/wal_005/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('cluster-a/platform/etcd/'))).toBe(true);

    // Ciphertext only: the sentinel's JSON is not readable on the target.
    const stored = Buffer.from(
      await (
        await externalS3.send(new GetObjectCommand({ Bucket: EXTERNAL.bucket, Key: sentinel }))
      ).Body!.transformToByteArray(),
    );

    expect(stored.subarray(0, 4).toString()).toBe('LWPC');
    expect(stored.toString('latin1')).not.toContain('FinishTime');

    // State: verified (the newest envelope was read back and opened), the catalog knows the copy.
    const status = await backups.status();

    expect(status.copies[0]).toMatchObject({ target: 'offsite', lastStatus: 'succeeded', declared: true });
    expect(status.copies[0].verifiedEnvelope).toMatch(/^dr-envelope\/(base_|etcd-)/);
    // No object lock declared (Garage has none): copied, not locked.
    expect(status.kinds.find((k) => k.kind === 'postgres')!.backups[0].targets).toEqual([
      expect.objectContaining({ target: 'offsite', lockedUntil: null }),
    ]);

    // Incremental: only what changed since (through the API: its routes come before `backups/:id`).
    const again = await api('POST', '/backups/platform/copies/run');

    expect(again.status).toBe(200);
    expect(again.json[0].copied).toBeLessThan(5);
    expect((await api('GET', '/backups/platform')).json.copies[0]).toMatchObject({ target: 'offsite' });
  }, 600_000);

  it('object lock on an external S3 target: checked, compliance retention per object, no deletes while locked (fake S3)', async () => {
    // Garage has no S3 Object Lock: this runs against the in-test fake (records the lock headers, refuses deletes
    // within retention). Not a verification against a real lock-capable provider.
    const fake = await startFakeObjectLockS3('lw-locked', null);
    const lockedTarget = {
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'BackupTarget',
      metadata: { name: 'locked' },
      spec: {
        type: 's3',
        endpoint: fake.url,
        bucket: 'lw-locked',
        region: 'us-east-1',
        prefix: '',
        credentials: LOCKED_CREDENTIALS,
        objectLock: { mode: 'COMPLIANCE', days: 1 },
      },
    } as Resource;
    const lockedRun = async () => (await copies.run()).find((r) => r.target === 'locked')!;

    try {
      await app.get(ResourceStoreService).upsert(dataSource.manager, lockedTarget, 'system');

      // Declared lock, bucket without object lock: refused, nothing uploaded.
      const noLock = await lockedRun();

      expect(noLock.status).toBe('failed');
      expect(fake.puts).toEqual([]);

      // Bucket locks in another mode than declared: refused.
      fake.lock = { mode: 'GOVERNANCE', days: 1 };
      expect((await lockedRun()).error).toContain('GOVERNANCE mode');
      fake.lock = { mode: 'COMPLIANCE', days: 1 };

      const before = Date.now();
      const copied = await lockedRun();

      expect(copied).toMatchObject({ status: 'succeeded', error: null });
      expect(copied.copied).toBeGreaterThan(5);

      // Every copied object carries compliance retention for the declared days.
      const data = fake.puts.filter((p) => p.key.startsWith('platform/') && !p.key.startsWith('platform/dr/'));

      expect(data.length).toBe(copied.copied);

      for (const put of data) {
        expect(put.mode).toBe('COMPLIANCE');
        expect(put.retainUntil!.getTime()).toBeGreaterThanOrEqual(before + 86_400_000 - 5_000);
      }

      const kind = (await backups.status()).kinds.find((k) => k.kind === 'postgres')!;

      expect(kind.backups[0].targets).toEqual(
        expect.arrayContaining([expect.objectContaining({ target: 'locked', lockedUntil: expect.any(String) })]),
      );

      // Pruning: objects retention removed from the bucket. One whose lock ended in the bookkeeping but that the target
      // still holds under retention → the target refuses, the copy keeps it; one still locked in the bookkeeping is
      // never attempted; one whose retention really ended goes.
      const now = new Date();
      const plant = (key: string, retainUntil: Date | null) =>
        fake.objects.set(`platform/${key}`, {
          body: Buffer.from('x'),
          etag: 'x',
          metadata: {},
          mode: retainUntil ? 'COMPLIANCE' : null,
          retainUntil,
          lastModified: now,
        });
      const row = (key: string, lockedUntil: Date | null) =>
        dataSource.getRepository(PlatformCopyEntity).create({
          target: 'locked',
          key,
          etag: 'x',
          size: 1,
          storedSize: 1,
          generation: 1,
          copiedAt: now,
          lockedUntil,
        });

      plant('gone/refused', new Date(Date.now() + 3_600_000));
      plant('gone/locked', new Date(Date.now() + 3_600_000));
      await dataSource
        .getRepository(PlatformCopyEntity)
        .save([row('gone/refused', null), row('gone/locked', new Date(Date.now() + 3_600_000))]);

      const refused = await lockedRun();

      expect(refused).toMatchObject({ status: 'succeeded', pruned: 0 });
      expect(fake.refusedDeletes).toEqual(['platform/gone/refused']);
      expect(fake.objects.has('platform/gone/refused')).toBe(true);
      expect(fake.objects.has('platform/gone/locked')).toBe(true);
      expect(
        await dataSource.getRepository(PlatformCopyEntity).countBy({ target: 'locked', key: 'gone/refused' }),
      ).toBe(1);

      // The retention on the target ended: pruned.
      fake.objects.get('platform/gone/refused')!.retainUntil = new Date(Date.now() - 1_000);
      expect((await lockedRun()).pruned).toBe(1);
      expect(fake.objects.has('platform/gone/refused')).toBe(false);
      expect(fake.objects.has('platform/gone/locked')).toBe(true);
    } finally {
      await app.get(ResourceStoreService).remove(dataSource.manager, { kind: 'BackupTarget', name: 'locked' });
      await dataSource.query(`DELETE FROM lw_platform_copies WHERE target = 'locked'`);
      await dataSource.query(`DELETE FROM lw_platform_copy_targets WHERE target = 'locked'`);
      await dataSource.query(
        `UPDATE lw_backups SET targets = COALESCE((SELECT jsonb_agg(t) FROM jsonb_array_elements(targets) t WHERE t->>'target' <> 'locked'), '[]'::jsonb) WHERE targets::text LIKE '%locked%'`,
      );
      await fake.close();
    }
  }, 600_000);

  it('keeps the longer platform retention until a second admin approved the shortening and the delay passed', async () => {
    const cluster = await dataSource.getRepository(ResourceEntity).findOneOrFail({ where: { kind: 'Cluster' } });

    await dataSource
      .getRepository(ResourceEntity)
      .update(
        { id: cluster.id },
        { spec: { ...cluster.spec, backups: { platform: { etcd: { keep: 1 } } } }, updatedBy: 'user:alice' },
      );
    expect(await backups.effectiveKeep('etcd', 1)).toBe(48);
    expect(await backups.effectiveKeep('etcd', 1)).toBe(48); // one request, not one per pass

    for (let i = 0; i < 2; i++) {
      await sleep(1_100); // snapshot names are per second
      expect((await backups.run('etcd', { type: 'system' })).deleted).toEqual([]);
    }

    const kind = (await backups.status()).kinds.find((k) => k.kind === 'etcd')!;

    expect(kind).toMatchObject({ keep: 1, effectiveKeep: 48, retentionRequest: { keep: 1, state: 'pending' } });

    const request = await dataSource
      .getRepository(BackupDeletionEntity)
      .findOneOrFail({ where: { kind: 'retention', state: 'pending' } });

    expect(request).toMatchObject({ scope: 'cluster', requestedBy: 'user:alice' });
    expect((await api('POST', `/backups/deletions/${request.id}/approve`)).status).toBe(201);

    const scheduler = app.get(BackupSchedulerService);

    await scheduler.tick();
    expect(await backups.effectiveKeep('etcd', 1)).toBe(48);

    await dataSource
      .getRepository(BackupDeletionEntity)
      .update({ id: request.id }, { notBefore: new Date(Date.now() - 1000) });
    await scheduler.tick();
    expect(
      (
        await dataSource
          .getRepository(BackupRetentionEntity)
          .findOneOrFail({ where: { policy: 'cluster:backups.platform/etcd' } })
      ).effective,
    ).toEqual({ keep: 1 });

    await sleep(1_100);

    const last = await backups.run('etcd', { type: 'system' });

    expect(last.deleted.length).toBe(3);
  }, 300_000);

  it('deletes a platform backup only after a second admin and the delay', async () => {
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(101, 150) g`);

    const second = await backups.run('postgres', { type: 'system' });

    expect(second.status).toBe('succeeded');

    const row = await dataSource
      .getRepository(BackupEntity)
      .findOneOrFail({ where: { resource: 'platform/postgres', snapshotId: firstBackup } });
    const request = await api('POST', '/backups/deletions', { backupIds: [row.id], reason: 'lab' });

    expect(request.status).toBe(201);
    expect((await api('POST', `/backups/deletions/${request.json.id}/approve`)).status).toBe(403);
    await dataSource.getRepository(BackupDeletionEntity).update({ id: request.json.id }, { requestedBy: 'admin-2' });
    expect((await api('POST', `/backups/deletions/${request.json.id}/approve`)).status).toBe(201);

    const scheduler = app.get(BackupSchedulerService);
    const s3 = await app.get(PlatformObjectStore).client();
    const sentinel = `${walgPrefix(scope)}basebackups_005/${firstBackup}_backup_stop_sentinel.json`;

    await scheduler.tick();
    await s3.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: sentinel }));

    await dataSource
      .getRepository(BackupDeletionEntity)
      .update({ id: request.json.id }, { notBefore: new Date(Date.now() - 1000) });
    await scheduler.tick();
    await expect(s3.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: sentinel }))).rejects.toThrow();
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: `dr-envelope/${firstBackup}.json` })),
    ).rejects.toThrow();
    s3.destroy();
    expect((await dataSource.getRepository(BackupEntity).findOneByOrFail({ id: row.id })).deletedAt).not.toBeNull();
  }, 300_000);

  let cloneScopeName: string;

  it('cuts the control-plane database over to a point-in-time clone (second admin, final backup, members switch)', async () => {
    const [{ now: targetTime }] = await dataSource.query('SELECT now() AS now');

    await sleep(1_500);
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(151, 300) g`);
    await switchAndArchive();

    const restore = await backups.requestRestore(
      { targetTime: (targetTime as Date).toISOString() },
      { type: 'system' },
    );

    cloneScopeName = restore.scope;

    // The agent's part: the clone in its own data directory, marked with the restore id.
    const restoreRow = await dataSource.getRepository(PlatformRestoreEntity).findOneByOrFail({ id: restore.id });
    const cloneRole: ControlPlaneRole = {
      ...role,
      platformBackups: {
        ...role.platformBackups!,
        ...platformBackupsRole('n1', 'member', undefined, restoreRow, {
          ENCRYPTION_KEY: key(),
          LOADWEAVER_BACKUP_GATEWAY_PORT: String(GATEWAY_PORT),
        }),
        postgres: role.platformBackups!.postgres,
        opensearch: role.platformBackups!.opensearch,
      },
    };
    const cloneDir = join(stateDir, 'postgres-pitr');
    const spec = postgresCloneSpec(ctx, cloneRole, cloneDir, postgresEtcdHosts(cloneRole))!;

    mkdirSync(cloneDir, { recursive: true });
    writeFileSync(join(cloneDir, CLONE_MARKER), `${restore.id}\n`);
    docker(
      runArgs(
        {
          ...spec,
          name: names.clone,
          env: {
            ...spec.env,
            ...LAB_SPILO_ENV,
            AWS_ENDPOINT: `http://${GATEWAY_HOST}`,
            CLONE_AWS_ENDPOINT: `http://${GATEWAY_HOST}`,
          },
        },
        ['--network', `container:${names.etcd}`, '--memory', '1g', '-v', `${cloneDir}:/home/postgres/pgdata`],
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

    // The plan: refused for a restore that isn't ready; data loss stated; the requester can't approve.
    const plan = await api('POST', `/backups/platform/postgres/restores/${restore.id}/cutover`);

    expect(plan.status).toBe(201);
    expect(plan.json).toMatchObject({ state: 'planned', node: 'n1', scope: restore.scope, previousScope: scope });
    expect(plan.json.plan.warnings[0]).toContain('is lost');
    expect((await api('POST', `/backups/platform/cutovers/${plan.json.id}/approve`)).status).toBe(403);
    await dataSource.getRepository(PlatformCutoverEntity).update({ id: plan.json.id }, { requestedBy: 'user:alice' });
    expect((await api('POST', `/backups/platform/cutovers/${plan.json.id}/approve`)).json.state).toBe('approved');

    // Final base backup, the cut-over written into the clone, members switch with the next desired state.
    const finalBefore = (
      await dataSource
        .getRepository(BackupEntity)
        .find({ where: { resource: 'platform/postgres', status: 'succeeded' } })
    ).length;

    const switching = await until(
      'the switch to start',
      async () => {
        await cutovers.tick();

        const current = await dataSource.getRepository(PlatformCutoverEntity).findOneByOrFail({ id: plan.json.id });

        expect(current.state).not.toBe('failed');

        return current.state === 'switching' ? current : null;
      },
      300_000,
    );

    expect(switching.finalBackup).toMatch(/^base_/);
    expect(
      (
        await dataSource
          .getRepository(BackupEntity)
          .find({ where: { resource: 'platform/postgres', status: 'succeeded' } })
      ).length,
    ).toBe(finalBefore + 1);
    expect(
      psql(names.clone, `SELECT state FROM lw_platform_cutovers WHERE id = '${plan.json.id}'`, 5442, 'loadweaver'),
    ).toBe('switching');

    const desired = withPlatformState(
      { ...role, platformBackups: undefined },
      'n1',
      undefined,
      await activePlatformState(dataSource.manager),
      { ENCRYPTION_KEY: key() },
    );

    expect(desired.postgresScope).toBe(restore.scope);
    expect(desired.platformBackups?.postgresCutover).toEqual({
      id: restore.id,
      scope: restore.scope,
      previousScope: scope,
      node: 'n1',
    });
    expect(desired.platformBackups?.postgresClone).toBeUndefined();

    // The member's agent: its real cut-over code on the data directories (as root would; the lab opens them first).
    docker([
      'run',
      '--rm',
      '-v',
      `${stateDir}:/s`,
      COMPONENT_IMAGES['node-shell'],
      'chmod',
      '0777',
      '/s/postgres',
      '/s/postgres-pitr',
    ]);

    const switchStarted = Date.now();
    const newScope = await applyPostgresCutover(
      stateDir,
      'n1',
      { ...role, ...desired },
      {
        postgres: 'lw-postgres',
        clone: 'lw-postgres-pitr',
        remove: async (name) => {
          rmContainer(name === 'lw-postgres' ? names.spilo : names.clone);

          return true;
        },
      },
      (line) => process.stderr.write(`[dr-lab agent] ${line}\n`),
    );

    expect(newScope).toBe(restore.scope);

    const adopted = postgresSpec({ ...ctx, postgresScope: newScope }, role);

    docker(
      runArgs(
        {
          ...adopted,
          name: names.spilo2,
          env: { ...adopted.env, ...LAB_SPILO_ENV, AWS_ENDPOINT: `http://${GATEWAY_HOST}` },
        },
        [
          '--network',
          `container:${names.etcd}`,
          '--memory',
          '1g',
          '-v',
          `${join(stateDir, 'postgres')}:/home/postgres/pgdata`,
        ],
      ),
    );

    // The API continues on the clone (it reconnects), finds the cut-over there and finishes it.
    await until(
      'the cut-over to finish',
      async () => {
        await cutovers.tick();

        return (
          (await dataSource.getRepository(PlatformCutoverEntity).findOneBy({ id: plan.json.id }))?.state === 'done'
        );
      },
      300_000,
    );
    process.stderr.write(`[dr-lab] cut-over switch: ${((Date.now() - switchStarted) / 1000).toFixed(1)} s\n`);

    expect((await dataSource.query('SELECT count(*)::int AS c FROM lab_rows'))[0].c).toBe(150);
    expect(await backups.postgresScope()).toBe(restore.scope);
    expect((await dataSource.getRepository(PlatformRestoreEntity).findOneByOrFail({ id: restore.id })).state).toBe(
      'adopted',
    );

    // Point-in-time recovery continues under the new scope.
    await until(
      'a base backup under the new scope',
      async () => {
        const s3 = await app.get(PlatformObjectStore).client();

        try {
          const listed = await s3.send(
            new ListObjectsV2Command({
              Bucket: PLATFORM_BUCKET,
              Prefix: `${walgPrefix(restore.scope)}basebackups_005/`,
            }),
          );

          return (listed.Contents ?? []).some((c) => c.Key?.endsWith('_backup_stop_sentinel.json'));
        } finally {
          s3.destroy();
        }
      },
      300_000,
    );
  }, 1_200_000);

  let dr: DrToolResult;

  it('restores the control plane on a fresh node from the external copy with 2 of 3 kit shares', async () => {
    // Writes after the newest base backup reach the fresh node through the WAL.
    await dataSource.query(`INSERT INTO lab_rows SELECT now(), g FROM generate_series(1001, 1025) g`);
    await switchAndArchive();
    expect((await copies.run())[0].status).toBe('succeeded');

    const [generation] = (await api('GET', '/backups/keys')).json;
    const share1 = (await api('POST', `/backups/keys/${generation.generation}/kit/shares/1`)).json.text as string;
    const share3 = (await api('POST', `/backups/keys/${generation.generation}/kit/shares/3`)).json.text as string;
    const output = join(drDir, 'dr');

    mkdirSync(output, { recursive: true });

    const started = Date.now();

    dr = await drRestore(
      drToolRequestSchema.parse({
        target,
        credentials: { accessKeyId: EXTERNAL.accessKeyId, secretAccessKey: EXTERNAL.secretAccessKey },
        key: { shares: [share3, share1] },
        outputDir: output,
      }),
      (event) => process.stderr.write(`[dr-lab tool] ${JSON.stringify(event)}\n`),
    );
    process.stderr.write(`[dr-lab] DR tool fetch: ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

    const master = await dataSource.getRepository(MasterKeyEntity).findOneOrFail({ where: { active: true } });

    expect(dr).toMatchObject({ clusterId: scope, postgresScope: cloneScopeName, masterKey: { id: master.id } });
    expect(dr.env.ENCRYPTION_KEY).toBe(key());
    expect(dr.etcdSnapshot).toMatch(/^platform\/etcd\//);

    // etcd from its snapshot (this node the only member), Patroni's old keys dropped.
    const etcdData = join(drDir, 'state');

    mkdirSync(etcdData, { recursive: true });
    docker([
      'run',
      '--rm',
      '-v',
      `${output}:/dr:ro`,
      '-v',
      `${etcdData}:/state`,
      COMPONENT_IMAGES.etcd,
      ...etcdRestoreArgs({ snapshot: `/dr/${dr.etcdSnapshot}`, node: 'n1', clusterId: scope, dataDir: '/state/etcd' }),
    ]);
    docker([
      'run',
      '-d',
      '--name',
      names.drEtcd,
      '--network',
      names.net,
      ...['2379', '5432'].flatMap((p) => ['-p', `127.0.0.1::${p}`]),
      '-v',
      `${etcdData}/etcd:/var/lib/etcd`,
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

    const drEtcd = `http://127.0.0.1:${port(names.drEtcd, 2379)}`;
    const range = (path: string) =>
      until(`etcd ${path}`, async () => {
        const res = await fetch(`${drEtcd}/v3/kv/${path}`, {
          method: 'POST',
          body: JSON.stringify({
            key: Buffer.from('/service/').toString('base64'),
            range_end: Buffer.from('/service0').toString('base64'),
          }),
        });

        return res.ok ? ((await res.json()) as { count?: string; deleted?: string }) : null;
      });

    expect(Number((await range('range')).count)).toBeGreaterThan(0); // the snapshot holds Patroni's keys
    await range('deleterange');

    // Postgres with the agent's restore script (WAL-G from the decrypted copy, WAL replay, promotion).
    const pgData = join(drDir, 'postgres');

    mkdirSync(pgData, { recursive: true });
    writeFileSync(
      join(output, 'pg-restore.sh'),
      postgresRestoreScript({ walgPrefix: dr.walgPrefix, backup: dr.backup }),
    );

    const restoreStarted = Date.now();
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '-v',
        `${output}:/dr`,
        '-v',
        `${pgData}:/home/postgres/pgdata`,
        '--entrypoint',
        'bash',
        COMPONENT_IMAGES.postgres,
        '/dr/pg-restore.sh',
      ],
      { timeout: 900_000, maxBuffer: 16 * 1024 * 1024 },
    );

    expect(stdout).toContain('restored to');
    process.stderr.write(
      `[dr-lab] Postgres restore + WAL replay: ${((Date.now() - restoreStarted) / 1000).toFixed(1)} s\n`,
    );

    // Spilo (Patroni) adopts the promoted data directory in the database scope of the backup.
    const restoredRole: ControlPlaneRole = { ...role, platformBackups: undefined };
    const fresh = postgresSpec({ ...ctx, postgresScope: dr.postgresScope }, restoredRole);

    docker(
      runArgs(
        { ...fresh, name: names.drSpilo, env: { ...fresh.env, ...LAB_SPILO_ENV, ETCD3_HOSTS: '127.0.0.1:2379' } },
        ['--network', `container:${names.drEtcd}`, '--memory', '1g', '-v', `${pgData}:/home/postgres/pgdata`],
      ),
    );
    await until(
      'the restored Spilo primary',
      async () => psql(names.drSpilo, 'SELECT NOT pg_is_in_recovery()') === 't',
      300_000,
    );
    expect(psql(names.drSpilo, 'SELECT count(*) FROM lab_rows', 5432, 'loadweaver')).toBe('175');
    expect(psql(names.drSpilo, 'SELECT max(n) FROM lab_rows', 5432, 'loadweaver')).toBe('1025');
    expect(
      psql(
        names.drSpilo,
        `SELECT state FROM lw_platform_cutovers ORDER BY created_at DESC LIMIT 1`,
        5432,
        'loadweaver',
      ),
    ).toBe('done');
  }, 1_200_000);

  it('recovers on the restored control plane: previous nodes lost, object store anew, master key re-sealed', async () => {
    const recovery = app.get(DrRecoveryService);
    const keys = await generateKeyPair();
    const seal = generateSealKeyPair();
    const token = `lwj_${'d'.repeat(12)}.${'e'.repeat(43)}`;
    const value = {
      id: '0b0c8f43-6d1a-4c55-8e0e-6f7c2c8a1d10',
      node: 'n9',
      token,
      secret: 'f'.repeat(43),
      restoreVolumes: true,
    };

    process.env['LOADWEAVER_DR_RECOVERY'] = JSON.stringify(value);

    const row = await recovery.start(value);

    expect(row.previousNodes).toEqual(['n1']);
    expect(await dataSource.getRepository(NodeEntity).findOneByOrFail({ name: 'n1' })).toMatchObject({
      lifecycle: 'left',
      connected: false,
    });
    expect(
      (await dataSource.getRepository(ObjectStoreGenerationEntity).find()).every((g) => g.state === 'retired'),
    ).toBe(true);
    expect(
      await dataSource.getRepository(JoinTokenEntity).exists({ where: { tokenPrefix: `lwj_${'d'.repeat(12)}` } }),
    ).toBe(true);
    // Idempotent: a restart of the API with the same environment changes nothing.
    expect((await recovery.start(value)).startedAt).toEqual(row.startedAt);
    await expect(recovery.status('wrong')).rejects.toThrow('wrong recovery secret');

    // The restoring node joins and hands over the master key from the envelope.
    await app.get(NodesService).join({
      token,
      nodeName: 'n9',
      csrPem: await createCsr(keys, 'n9'),
      hello: {
        nodeName: 'n9',
        agentVersion: '0.0.0-it',
        os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' },
        capabilities: {
          runtimes: ['runc'],
          sandboxProbe: 'missing',
          wireguard: true,
          nftables: true,
          bird: true,
          drbd: false,
          criu: false,
        },
        capacity: { cpuMillis: 4000, memoryBytes: 8_000_000_000, diskBytes: 100_000_000_000 },
        wireguardPublicKey: 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=',
        endpointHost: 'n9.example.test',
        hostname: 'fresh-host-9',
        sealPublicKey: seal.publicKey,
        appliedRevision: 0,
      },
    } as never);

    // The host name counts from the join on (DRBD resources rendered before the first stream hello name the host).
    expect((await dataSource.getRepository(NodeEntity).findOneByOrFail({ name: 'n9' })).hostname).toBe('fresh-host-9');

    const status = await recovery.handOverMasterKey(value.secret, { id: dr.masterKey.id, value: dr.masterKey.value });

    expect(status).toMatchObject({ nodeJoined: true, previousNodes: ['n1'] });
    await app.get(NetworkStateService).recompile();
    await app.get(NetworkStateService).requestRecompile('lab');
    await until(
      'the master key sealed to n9',
      async () => (await recovery.status(value.secret)).masterKeyResealed,
      60_000,
    );

    const master = await dataSource.getRepository(MasterKeyEntity).findOneOrFail({ where: { active: true } });

    expect(master.holders.map((h) => h.node)).toEqual(['n9']);
    expect(
      (await dataSource.getRepository(DrRecoveryEntity).findOneByOrFail({ id: value.id })).keyRestoredAt,
    ).not.toBeNull();
    delete process.env['LOADWEAVER_DR_RECOVERY'];
  }, 300_000);
});
