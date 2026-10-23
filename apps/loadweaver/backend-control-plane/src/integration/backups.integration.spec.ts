import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  AgentSessionRegistry,
  BackupCommandsService,
  BackupDeletionEntity,
  BackupEntity,
  BackupKeyService,
  BackupRepositoriesService,
  BackupRetentionEntity,
  BackupSchedulerService,
  backupServerRole,
  GarageAdminClient,
  KOPIA_COMMAND_ENV,
  KopiaCli,
  NetworkStateService,
  NodeEntity,
  ObjectStoreGenerationEntity,
  objectStorePorts,
  objectStoreSecrets,
  VolumePlacementEntity,
  BACKUPS_BUCKET,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  decodeControlPlaneMessage,
  kopiaPasswordHash,
  kopiaServerScript,
  type BackupRun,
  type Envelope,
  type KopiaRepositoryAccess,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { backupRetentionSchema } from '@forepath/loadweaver/shared/util-model';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';
import { removeContainers, startGarage, type GarageContainer } from './garage.containers';
import { docker } from './postgres.container';

/**
 * Backups (3.20, M6 step 3a) against real Garage and a real Kopia repository server started with the agent's own
 * server script: the control plane creates the repository record, hands a node the volume's Kopia user through a
 * `backupRun` command, the "node" (a Kopia client container) snapshots a test directory as that user, the
 * catalog / diff / file browser / download work through the control plane's FULL user, the node restores, can't
 * delete, and deletions need a second admin and the delay. Kit download / confirm and retention shortening too.
 */

const API_KEY = 'integration-test-api-key';
const run = `${process.pid}-${Date.now()}`;
const KOPIA_IMAGE = COMPONENT_IMAGES.kopia;
const ENCRYPTION_KEY = process.env['ENCRYPTION_KEY'] as string;
const GENERATION = 1;
const PORTS = objectStorePorts(GENERATION);
const octet = 20 + (process.pid % 200);
const SUBNET = `172.29.${octet}.0/24`;
const GARAGE_IP = `172.29.${octet}.10`;
const SERVER_IP = `172.29.${octet}.20`;
const VOLUME = 'p1/web/data';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;

  for (;;) {
    try {
      const value = await fn();

      if (value) return value;
    } catch (error) {
      last = error;
    }

    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${String(last)}`);

    await sleep(1000);
  }
}

describe('backups (integration)', () => {
  const names = { net: `lw-it-bk-${run}`, garage: `lw-it-bk-garage-${run}`, server: `lw-it-bk-kopia-${run}` };
  const containers = [names.garage, names.server];
  const workDir = mkdtempSync(join(tmpdir(), 'lw-it-bk-'));
  const volumeDir = join(workDir, 'volume');
  const previousCommand = process.env[KOPIA_COMMAND_ENV];
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let garage: GarageContainer;
  const sent: Envelope[] = [];

  const api = async (
    method: string,
    path: string,
    body?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON response bodies
  ): Promise<{ status: number; json: any; text: string }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: res.status, json, text };
  };

  /** A Kopia client container on the lab network ("the node"), one shell script per call. */
  const node = (access: KopiaRepositoryAccess, script: string, mounts: string[] = []): string => {
    const server = access.servers[0];

    return docker([
      'run',
      '--rm',
      '--network',
      names.net,
      '--user',
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      '-e',
      `KOPIA_PASSWORD=${access.password}`,
      '-e',
      'KOPIA_CONFIG_PATH=/tmp/k/repository.config',
      '-e',
      'KOPIA_CACHE_DIRECTORY=/tmp/k/cache',
      '-e',
      'KOPIA_LOG_DIR=/tmp/k/logs',
      '-e',
      'KOPIA_CHECK_FOR_UPDATES=false',
      ...mounts.flatMap((m) => ['-v', m]),
      '--entrypoint',
      'sh',
      KOPIA_IMAGE,
      '-c',
      `kopia repository connect server --url=https://${server.address}:${server.port} --server-cert-fingerprint=${access.fingerprint} --override-username=${access.username} --override-hostname=${access.hostname} >/dev/null 2>&1 && ${script}`,
    ]);
  };

  beforeAll(async () => {
    docker(['network', 'create', '--subnet', SUBNET, names.net]);
    mkdirSync(volumeDir, { recursive: true });
    mkdirSync(join(volumeDir, 'sub'));
    writeFileSync(join(volumeDir, 'a.txt'), 'hello');
    writeFileSync(join(volumeDir, 'c.txt'), 'gone soon');
    writeFileSync(join(volumeDir, 'sub', 'b.bin'), Buffer.alloc(200_000, 7));

    // The control plane's own Kopia client: the pinned image on the lab network (the real image ships the binary).
    process.env[KOPIA_COMMAND_ENV] = JSON.stringify([
      'docker',
      'run',
      '--rm',
      '-i',
      '--network',
      names.net,
      '--user',
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      '-v',
      `${tmpdir()}:${tmpdir()}`,
      ...[
        'HOME',
        'KOPIA_PASSWORD',
        'KOPIA_CONFIG_PATH',
        'KOPIA_CACHE_DIRECTORY',
        'KOPIA_LOG_DIR',
        'KOPIA_CHECK_FOR_UPDATES',
        'KOPIA_PERSIST_CREDENTIALS_ON_CONNECT',
        'KOPIA_SERVER_PASSWORD',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
      ].flatMap((e) => ['-e', e]),
      KOPIA_IMAGE,
    ]);
    process.env['LOADWEAVER_BACKUPS'] = 'off';

    // Garage generation 1 at its overlay address, with the backups key and bucket the control plane derives.
    const secrets = objectStoreSecrets(ENCRYPTION_KEY, GENERATION);

    garage = startGarage({
      name: names.garage,
      replicationFactor: 1,
      ports: PORTS,
      rpcSecret: secrets.rpcSecret,
      adminToken: secrets.adminToken,
      rpcPublicAddress: GARAGE_IP,
      network: { name: names.net, ip: GARAGE_IP },
    });

    const admin = new GarageAdminClient(garage.adminUrl, secrets.adminToken);
    const id = await until('garage', async () => await admin.selfId());

    await admin.stageLayout([{ id, zone: 'lab', capacity: 1024 ** 3, tags: [] }], []);
    await admin.applyLayout(1);
    await until('garage layout', async () => await admin.layoutSynced());
    await admin.ensureKey(secrets.backupsAccessKeyId, secrets.backupsSecretAccessKey, 'lw-backups');
    await admin.ensureBucket(BACKUPS_BUCKET, secrets.backupsAccessKeyId);

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);

    const nodes = dataSource.getRepository(NodeEntity);

    // m1: the control-plane member running the repository server; g1 holds the Garage generation; w1 the volume.
    for (const n of [
      { name: 'm1', overlayV4: SERVER_IP, controlPlane: true, sealPublicKey: generateSealKeyPair().publicKey },
      { name: 'g1', overlayV4: GARAGE_IP, controlPlane: false },
      { name: 'w1', overlayV4: `172.29.${octet}.30`, controlPlane: false },
    ])
      await nodes.save(
        nodes.create({
          ...n,
          site: 'lab',
          wireguardPublicKey: `${n.name}`.padEnd(43, 'x') + '=',
          joinedAt: new Date(),
          witness: false,
          protocolFeatures: ['backups'],
          connected: true,
        }),
      );
    await dataSource.getRepository(ObjectStoreGenerationEntity).save(
      dataSource.getRepository(ObjectStoreGenerationEntity).create({
        generation: GENERATION,
        replicationFactor: 1,
        state: 'active',
        holders: ['g1'],
        garageNodes: { g1: id },
        observedMembers: ['g1'],
        observedSince: new Date(),
        stateChangedAt: new Date(),
        copy: null,
      }),
    );
    await dataSource.getRepository(VolumePlacementEntity).save(
      dataSource.getRepository(VolumePlacementEntity).create({
        id: VOLUME,
        primaryNode: 'w1',
        pendingPrimary: null,
        syncReplicas: [],
        remoteReplicas: [],
        sizeBytes: String(1024 ** 3),
        crossSite: 'none',
        drbdMinor: 1000,
        drbdPort: 7790,
        drbdNodeIds: { w1: 0 },
        drbdNextNodeId: 1,
      }),
    );
    // The lab has no real nodes to compile for.
    jest.spyOn(app.get(NetworkStateService), 'recompile').mockResolvedValue(undefined as never);

    // A connected w1 advertising `backups` (captures what the control plane sends it).
    app.get(AgentSessionRegistry).register({
      nodeName: 'w1',
      sessionId: randomUUID(),
      connectedAt: new Date(),
      sentRevision: 0,
      protocol: { version: 2, features: new Set(['backups']) },
      send: (envelope) => void sent.push(envelope),
      close: () => undefined,
    });
  }, 300_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    removeContainers(containers);

    try {
      docker(['network', 'rm', names.net]);
    } catch {
      // gone
    }

    if (previousCommand === undefined) delete process.env[KOPIA_COMMAND_ENV];
    else process.env[KOPIA_COMMAND_ENV] = previousCommand;

    rmSync(workDir, { recursive: true, force: true });
  }, 120_000);

  let firstBackup: string;
  let secondBackup: string;
  let access: KopiaRepositoryAccess;

  it('creates the repository and runs its server with the agent script (TLS, ACLs, no secrets in arguments)', async () => {
    const repositories = app.get(BackupRepositoriesService);
    const repository = await repositories.ensure('project-p1');

    expect(repository).toMatchObject({ scope: 'project-p1', port: 7500, keyGeneration: 1 });
    expect(repository.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // What the member gets pushed (desired state + push-time secrets), started the way the agent starts it.
    const members = await dataSource.getRepository(NodeEntity).find();
    const role = backupServerRole(
      members.find((m) => m.name === 'm1') as NodeEntity,
      new Set(['m1']),
      members,
      await dataSource.getRepository(ObjectStoreGenerationEntity).find(),
      [repository],
    );
    expect(role).toBeDefined();

    const pushed = await repositories.withServerSecrets(role as NonNullable<typeof role>);
    const server = pushed.repositories[0];

    expect(server.s3).toEqual({ address: GARAGE_IP, port: PORTS.s3, bucket: 'lw-backups', prefix: 'project-p1/' });
    expect(server.password).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const tls = join(workDir, 'tls');

    mkdirSync(tls);
    writeFileSync(join(tls, 'tls.crt'), server.tls.certificatePem);
    writeFileSync(join(tls, 'tls.key'), server.tls.privateKeyPem as string, { mode: 0o644 });
    docker([
      'run',
      '-d',
      '--name',
      names.server,
      '--network',
      names.net,
      '--ip',
      SERVER_IP,
      '-e',
      `KOPIA_PASSWORD=${server.password}`,
      '-e',
      `AWS_ACCESS_KEY_ID=${server.accessKeyId}`,
      '-e',
      `AWS_SECRET_ACCESS_KEY=${server.secretAccessKey}`,
      '-e',
      `LW_CONTROL_PASSWORD_HASH=${kopiaPasswordHash(server.controlPassword as string)}`,
      '-e',
      `KOPIA_SERVER_CONTROL_PASSWORD=${server.serverControlPassword}`,
      '-v',
      `${tls}:/tls:ro`,
      '--entrypoint',
      'sh',
      KOPIA_IMAGE,
      '-c',
      kopiaServerScript(server),
    ]);
    // Kopia logs to stderr.
    await until(
      'kopia server',
      async () => spawnSync('docker', ['logs', names.server], { encoding: 'utf8' }).stderr.includes('SERVER ADDRESS'),
      120_000,
    );

    const acl = docker([
      'exec',
      '-e',
      `KOPIA_PASSWORD=${server.password}`,
      names.server,
      'kopia',
      'server',
      'acl',
      'list',
    ]);

    expect(acl).toContain('user:*@* access:APPEND target:type=snapshot');
    expect(acl).not.toMatch(/user:\*@\* access:FULL/);
    // The server process never got a password as an argument.
    expect(docker(['inspect', '--format', '{{json .Args}}', names.server])).not.toContain(server.password);
  }, 240_000);

  it('sends the node a backupRun with its volume user; the node snapshots, the catalog records it', async () => {
    const scheduler = app.get(BackupSchedulerService);
    const commands = app.get(BackupCommandsService);
    const row = await scheduler.startBackup(
      { id: VOLUME, project: 'p1', deployment: 'web', volume: 'data', deploymentLabels: {} },
      { key: null, hooks: false },
    );

    expect(await commands.sendDue()).toBe(1);

    const decoded = decodeControlPlaneMessage(sent.at(-1) as Envelope);

    expect(decoded.ok).toBe(true);

    const command = (decoded as { message: { type: string; payload: BackupRun } }).message;

    expect(command.type).toBe('backupRun');
    expect(sent.at(-1)?.channel).toBe(`backup:${row.id}`);
    access = command.payload.repository;
    expect(access).toMatchObject({ scope: 'project-p1', username: 'v-web.data', hostname: 'p1' });
    expect(access.servers).toEqual([{ address: SERVER_IP, port: 7500 }]);

    const snapshot = JSON.parse(node(access, 'kopia snapshot create /volume --json', [`${volumeDir}:/volume:ro`])) as {
      id: string;
      startTime: string;
      endTime: string;
      rootEntry: { obj: string; summ: { size: number; files: number } };
    };
    const progress = {
      id: row.id,
      operation: 'backup' as const,
      status: 'done' as const,
      bytes: snapshot.rootEntry.summ.size,
      files: snapshot.rootEntry.summ.files,
      uploadedBytes: snapshot.rootEntry.summ.size,
      snapshot: {
        manifestId: snapshot.id,
        rootObject: snapshot.rootEntry.obj,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
      },
    };

    // Only the node it runs on, only on its channel.
    expect(await commands.recordProgress('m1', progress, `backup:${row.id}`)).toBe(false);
    expect(await commands.recordProgress('w1', progress, 'backup:other')).toBe(false);
    expect(await commands.recordProgress('w1', progress, `backup:${row.id}`)).toBe(true);

    const catalog = await api('GET', '/backups?project=p1');

    expect(catalog.status).toBe(200);
    expect(catalog.json).toEqual([
      expect.objectContaining({
        id: row.id,
        status: 'succeeded',
        resource: VOLUME,
        files: 3,
        encrypted: true,
        targets: [expect.objectContaining({ target: 'garage' })],
      }),
    ]);
    firstBackup = row.id;
  }, 180_000);

  it('diffs two backups, browses and downloads files through the control plane', async () => {
    writeFileSync(join(volumeDir, 'a.txt'), 'hello, changed');
    rmSync(join(volumeDir, 'c.txt'));
    writeFileSync(join(volumeDir, 'sub', 'd.txt'), 'new');

    const row = await app
      .get(BackupSchedulerService)
      .startBackup(
        { id: VOLUME, project: 'p1', deployment: 'web', volume: 'data', deploymentLabels: {} },
        { key: null, hooks: false },
      );
    const snapshot = JSON.parse(node(access, 'kopia snapshot create /volume --json', [`${volumeDir}:/volume:ro`]));

    await app.get(BackupCommandsService).recordProgress(
      'w1',
      {
        id: row.id,
        operation: 'backup',
        status: 'done',
        bytes: snapshot.rootEntry.summ.size,
        files: snapshot.rootEntry.summ.files,
        snapshot: {
          manifestId: snapshot.id,
          rootObject: snapshot.rootEntry.obj,
          startTime: snapshot.startTime,
          endTime: snapshot.endTime,
        },
      },
      `backup:${row.id}`,
    );
    secondBackup = row.id;

    const diff = await api('GET', `/backups/diff?from=${firstBackup}&to=${secondBackup}`);

    expect(diff.status).toBe(200);
    expect(diff.json.added).toEqual([expect.objectContaining({ path: 'sub/d.txt', size: 3 })]);
    expect(diff.json.removed).toEqual([expect.objectContaining({ path: 'c.txt' })]);
    expect(diff.json.changed).toEqual([{ path: 'a.txt', before: 5, after: 14 }]);

    const files = await api('GET', `/backups/${secondBackup}/files?path=sub`);

    expect(files.json.map((f: { name: string }) => f.name).sort()).toEqual(['b.bin', 'd.txt']);
    expect((await api('GET', `/backups/${secondBackup}/files?path=../etc`)).status).toBe(400);

    const download = await fetch(`${baseUrl}/api/backups/${firstBackup}/download?path=a.txt`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(download.status).toBe(200);
    expect(await download.text()).toBe('hello');
  }, 180_000);

  it('restores on the node as the volume user, which can neither delete nor see other volumes', async () => {
    const restoreDir = join(workDir, 'restore');

    mkdirSync(restoreDir, { mode: 0o777 });

    const second = await dataSource.getRepository(BackupEntity).findOneOrFail({ where: { id: secondBackup } });

    node(access, `kopia snapshot restore ${second.rootObject} /restore/r`, [`${restoreDir}:/restore`]);

    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

    for (const file of ['a.txt', 'sub/b.bin', 'sub/d.txt'])
      expect(hash(join(restoreDir, 'r', file))).toBe(hash(join(volumeDir, file)));

    expect(() => node(access, `kopia snapshot delete ${second.snapshotId} --delete`)).toThrow(/access denied/);
    expect(() => node(access, 'kopia policy set /volume --keep-latest 1')).toThrow(/access denied/);
    expect(() => node(access, 'kopia maintenance run --full')).toThrow(/direct repository/);

    // Another volume's user doesn't see these snapshots.
    const other = await app.get(BackupRepositoriesService).volumeAccess('project-p1', 'p1/web/other');

    expect(JSON.parse(node(other, 'kopia snapshot list --all --json'))).toEqual([]);
  }, 180_000);

  it('deletes only with a second admin and after the delay', async () => {
    const request = await api('POST', '/backups/deletions', { backupIds: [firstBackup], reason: 'test data' });

    expect(request.status).toBe(201);
    expect(request.json).toMatchObject({ state: 'pending', requestedBy: 'api-key' });

    // The requester can't approve their own request.
    expect((await api('POST', `/backups/deletions/${request.json.id}/approve`)).status).toBe(403);

    // A second admin (here: another requester on record) approves; nothing happens before the delay.
    await dataSource.getRepository(BackupDeletionEntity).update({ id: request.json.id }, { requestedBy: 'admin-2' });
    expect((await api('POST', `/backups/deletions/${request.json.id}/approve`)).json).toMatchObject({
      state: 'approved',
      approvedBy: 'api-key',
    });

    const scheduler = app.get(BackupSchedulerService);

    await scheduler.tick();
    expect(
      (await dataSource.getRepository(BackupEntity).findOneOrFail({ where: { id: firstBackup } })).deletedAt,
    ).toBeNull();

    const control = await app.get(BackupRepositoriesService).controlConnection('project-p1');

    expect((await new KopiaCli().listSnapshots(control)).length).toBe(2);

    // 72 h later.
    await dataSource
      .getRepository(BackupDeletionEntity)
      .update({ id: request.json.id }, { notBefore: new Date(Date.now() - 1000) });
    await scheduler.tick();

    expect(
      (await dataSource.getRepository(BackupEntity).findOneOrFail({ where: { id: firstBackup } })).deletedAt,
    ).not.toBeNull();
    expect((await new KopiaCli().listSnapshots(control)).map((s) => s.id)).toEqual([
      (await dataSource.getRepository(BackupEntity).findOneOrFail({ where: { id: secondBackup } })).snapshotId,
    ]);
    expect((await api('GET', '/backups/deletions')).json[0]).toMatchObject({ state: 'executed' });
  }, 180_000);

  it('applies a shortened retention only after a second admin and the delay', async () => {
    const scheduler = app.get(BackupSchedulerService);
    const long = backupRetentionSchema.parse({ keepLast: 10, daily: 7 });
    const short = backupRetentionSchema.parse({ keepLast: 2, daily: 14 });

    expect(await scheduler.effectiveRetention('p1/nightly', long, 'alice', new Date())).toEqual(long);
    // Daily grows at once, keepLast stays at 10 until approved.
    expect(await scheduler.effectiveRetention('p1/nightly', short, 'alice', new Date())).toMatchObject({
      keepLast: 10,
      daily: 14,
    });

    const [pending] = await dataSource
      .getRepository(BackupDeletionEntity)
      .find({ where: { kind: 'retention', state: 'pending' } });

    expect(pending).toMatchObject({ scope: 'project-p1', requestedBy: 'alice' });
    expect((await api('POST', `/backups/deletions/${pending.id}/approve`)).status).toBe(201);
    await dataSource
      .getRepository(BackupDeletionEntity)
      .update({ id: pending.id }, { notBefore: new Date(Date.now() - 1000) });
    await scheduler.tick();
    expect(
      (await dataSource.getRepository(BackupRetentionEntity).findOneOrFail({ where: { policy: 'p1/nightly' } }))
        .effective,
    ).toMatchObject({ keepLast: 2, daily: 14 });
  }, 120_000);

  it('hands out each recovery-kit share once and confirms the kit only with matching shares', async () => {
    const [generation] = (await api('GET', '/backups/keys')).json;

    expect(generation).toMatchObject({
      generation: 1,
      active: true,
      kit: { shares: 3, threshold: 2, confirmedAt: null },
    });

    const first = await api('POST', '/backups/keys/1/kit/shares/1');
    const second = await api('POST', '/backups/keys/1/kit/shares/3');

    expect(first.json.text).toContain('share 1 of 3');
    expect((await api('POST', '/backups/keys/1/kit/shares/1')).status).toBe(409);

    const status = await api('GET', '/backups/status');

    expect(status.json.keys).toMatchObject({ generation: 1, kitConfirmed: false });

    // A typo and a single share are refused.
    const typo = { ...first.json.document, share: first.json.document.share.slice(0, -2) + 'AA' };

    expect(
      (await api('POST', '/backups/keys/1/kit/confirm', { shares: [JSON.stringify(typo), second.json.text] })).status,
    ).toBe(400);
    expect((await api('POST', '/backups/keys/1/kit/confirm', { shares: [first.json.text] })).status).toBe(400);
    expect(
      (
        await api('POST', '/backups/keys/1/kit/confirm', {
          shares: [first.json.text, JSON.stringify(second.json.document)],
        })
      ).json,
    ).toEqual({ confirmed: true });
    expect((await api('GET', '/backups/status')).json.keys.kitConfirmed).toBe(true);

    // The kit (root) still yields the key the backups use.
    const keys = app.get(BackupKeyService);
    const root = await keys.recoverRoot({ shares: [first.json.text, second.json.text] });

    expect(root).toHaveLength(32);
    expect((await keys.forGeneration(1)).length).toBe(32);
  }, 60_000);

  it('exports a backup as a plain tar archive and imports it into another volume (P7a transfer)', async () => {
    const COPY = 'p1/web/copy';
    const exported = await fetch(`${baseUrl}/api/backups/${secondBackup}/archive`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(exported.status).toBe(200);

    const archive = Buffer.from(await exported.arrayBuffer());

    // Kopia's tar export is plain ustar: exactly what the import accepts.
    expect(archive.subarray(257, 262).toString('latin1')).toBe('ustar');

    const listed = spawnSync('tar', ['-t'], { input: archive, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

    expect(listed.sort()).toEqual(['a.txt', 'sub/', 'sub/b.bin', 'sub/d.txt']);

    // One connection per upload (no keep-alive): refused uploads end their connection before the body is read.
    const importArchive = (volume: string, body: Buffer) =>
      new Promise<{ status: number; json: () => Promise<unknown> }>((resolve, reject) => {
        const url = new URL(`${baseUrl}/api/backups/imports?volume=${encodeURIComponent(volume)}&sourceCluster=lab-a`);
        const req = httpRequest(
          url,
          {
            method: 'POST',
            agent: false,
            headers: {
              authorization: `Bearer ${API_KEY}`,
              'content-type': 'application/x-tar',
              'content-length': body.length,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];

            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
              }),
            );
          },
        );

        // The server may answer (404 / 413) and close before the whole body is written.
        req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'EPIPE' ? undefined : reject(error)));
        req.end(body);
      });

    // The target volume must exist.
    expect((await importArchive(COPY, archive)).status).toBe(404);
    await dataSource.getRepository(VolumePlacementEntity).save(
      dataSource.getRepository(VolumePlacementEntity).create({
        id: COPY,
        primaryNode: 'w1',
        pendingPrimary: null,
        syncReplicas: [],
        remoteReplicas: [],
        sizeBytes: String(1024 ** 3),
        crossSite: 'none',
        drbdMinor: 1001,
        drbdPort: 7791,
        drbdNodeIds: { w1: 0 },
        drbdNextNodeId: 1,
      }),
    );

    // Compressed input is refused before extraction (decompression bomb), and so is anything over the cap.
    const gzip = spawnSync('gzip', ['-c'], { input: archive });

    expect((await importArchive(COPY, gzip.stdout)).status).toBe(400);
    process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'] = '1024';

    try {
      expect((await importArchive(COPY, archive)).status).toBe(413);
    } finally {
      delete process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'];
    }

    const imported = await importArchive(COPY, archive);
    const row = (await imported.json()) as { id: string; resource: string; status: string; files: number };

    expect(imported.status).toBe(201);
    expect(row).toMatchObject({ resource: COPY, status: 'succeeded', files: 3 });

    // The imported backup is a normal catalog entry of the project: browse / download its files.
    const download = await fetch(`${baseUrl}/api/backups/${row.id}/download?path=sub/d.txt`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(download.status).toBe(200);
    expect(await download.text()).toBe('new');

    const files = await api('GET', `/backups/${row.id}/files`);

    expect(files.json.map((f: { name: string }) => f.name).sort()).toEqual(['a.txt', 'sub']);

    const audit = await dataSource.query(
      `SELECT action FROM lw_audit_events WHERE action IN ('backup.exported', 'backup.imported') ORDER BY seq`,
    );

    expect(audit.map((a: { action: string }) => a.action)).toEqual(['backup.exported', 'backup.imported']);
  }, 240_000);
});
