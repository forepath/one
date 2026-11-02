import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { platformBackupSettings } from '@forepath/loadweaver/shared/util-model';
import { generateKey, secretId, splitSecret } from '@forepath/loadweaver/shared/util-secrets';

import { backupDataKey, kitShareDocument, kitShareText } from '../backup-keys.utils';
import { openDrEnvelope, sealDrEnvelope } from '../dr-envelope';
import { randomBytes } from 'node:crypto';

import { defaultClusterNetwork } from '../../utils/network-allocation.utils';
import {
  DrRecoveryService,
  drRecoveryEnvSchema,
  drRestoreName,
  readDrRecoveryEnv,
  volumeRestoreState,
} from './dr-recovery.service';
import { drRestore, drToolRequestSchema } from './dr-tool';
import type { PlatformRestoreEntity } from './platform-backups.entities';
import { platformBackupsRole, withPlatformState } from './platform-backups.role';
import type { CopyDestination } from './platform-copy.destinations';
import { checkBucketObjectLock, knownHostKeys } from './platform-copy.destinations';
import {
  chooseDrBackup,
  chunkCount,
  COPY_CHUNK_BYTES,
  COPY_HEADER_BYTES,
  copyVerificationError,
  decryptStream,
  encryptedSize,
  encryptStream,
  newestEtcdSnapshot,
  objectsToCopy,
  platformCopyKey,
  readCopyHeader,
  walForBackup,
} from './platform-copy.utils';
import type { DrRecoveryEntity, PlatformCutoverEntity } from './platform-dr.entities';
import {
  cutoverPlan,
  cutoverRefusal,
  platformCopyTargets,
  platformKeepDecision,
  platformPins,
  platformPlanWarnings,
} from './platform-dr.utils';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

async function encrypt(key: Buffer, generation: number, objectKey: string, plain: Buffer): Promise<Buffer> {
  // Uneven pieces, like a network stream.
  const pieces = [];

  for (let i = 0; i < plain.length; i += 70_001) pieces.push(plain.subarray(i, i + 70_001));

  return await collect(
    Readable.from(pieces.length ? pieces : [Buffer.alloc(0)]).pipe(
      encryptStream(key, generation, objectKey, plain.length),
    ),
  );
}

async function decrypt(key: Buffer, objectKey: string, sealed: Buffer): Promise<Buffer> {
  return await collect(Readable.from([sealed]).pipe(decryptStream(objectKey, () => key)));
}

describe('external copies of the platform bucket (3.20, step 3c)', () => {
  const key = platformCopyKey(backupDataKey(generateKey(), 3));

  it.each([0, 1, 4096, COPY_CHUNK_BYTES - 1, COPY_CHUNK_BYTES, COPY_CHUNK_BYTES + 1, 3 * COPY_CHUNK_BYTES - 7])(
    'encrypts and decrypts %d bytes; the stored size is predictable',
    async (size) => {
      const plain = Buffer.alloc(size, 7);

      plain.forEach((_, i) => (plain[i] = i % 251));

      const sealed = await encrypt(key, 3, 'spilo/c/wal/17/wal_005/x', plain);

      expect(sealed.length).toBe(encryptedSize(size));
      expect(sealed.length).toBe(COPY_HEADER_BYTES + size + 16 * chunkCount(size));
      expect(readCopyHeader(sealed).generation).toBe(3);
      // A few plaintext bytes turn up in random ciphertext by chance (1 byte: ~7 %); 16+ never do.
      if (size === 0 || size >= 16)
        expect(sealed.subarray(COPY_HEADER_BYTES).includes(plain.subarray(0, Math.min(64, size)))).toBe(size === 0);
      expect((await decrypt(key, 'spilo/c/wal/17/wal_005/x', sealed)).equals(plain)).toBe(true);
    },
  );

  it('detects tampering, truncation at a chunk boundary, another object and another key', async () => {
    const plain = Buffer.alloc(2 * COPY_CHUNK_BYTES + 5, 1);
    const sealed = await encrypt(key, 3, 'a', plain);
    const flipped = Buffer.from(sealed);

    flipped[COPY_HEADER_BYTES + 10] ^= 1;

    await expect(decrypt(key, 'a', flipped)).rejects.toThrow('does not decrypt');
    // Cut after the first full chunk: that chunk was not the last one when it was sealed.
    await expect(decrypt(key, 'a', sealed.subarray(0, COPY_HEADER_BYTES + COPY_CHUNK_BYTES + 16))).rejects.toThrow(
      'does not decrypt',
    );
    await expect(decrypt(key, 'b', sealed)).rejects.toThrow('does not decrypt');
    await expect(decrypt(platformCopyKey(generateKey()), 'a', sealed)).rejects.toThrow('does not decrypt');
    await expect(decrypt(key, 'a', Buffer.from('not a copy at all, really'))).rejects.toThrow('not an encrypted');
  });

  it('refuses a source that is shorter or longer than listed', async () => {
    await expect(collect(Readable.from([Buffer.alloc(10)]).pipe(encryptStream(key, 1, 'k', 11)))).rejects.toThrow(
      'ended after 10 of 11 bytes',
    );
    await expect(collect(Readable.from([Buffer.alloc(12)]).pipe(encryptStream(key, 1, 'k', 11)))).rejects.toThrow(
      'longer than its listed 11 bytes',
    );
  });

  it('copies missing and rewritten objects only', () => {
    const source = [
      { key: 'a', etag: '1', size: 1 },
      { key: 'b', etag: '2', size: 2 },
      { key: 'opensearch/c/index.latest', etag: '9', size: 8 },
    ];
    const copied = [
      { key: 'a', etag: '1', size: 1 },
      { key: 'opensearch/c/index.latest', etag: '8', size: 8 },
    ];

    expect(objectsToCopy(source, copied).map((o) => o.key)).toEqual(['b', 'opensearch/c/index.latest']);
  });

  it('verifies an upload by its size and, where the target reports one, its checksum', () => {
    expect(copyVerificationError({ storedSize: 10, sha256: 'ab' }, { size: 10, sha256: 'ab' })).toBeNull();
    expect(copyVerificationError({ storedSize: 10, sha256: 'ab' }, { size: 10, sha256: null })).toBeNull();
    expect(copyVerificationError({ storedSize: 10, sha256: 'ab' }, null)).toContain('missing');
    expect(copyVerificationError({ storedSize: 10, sha256: 'ab' }, { size: 9 })).toContain('9 bytes');
    expect(copyVerificationError({ storedSize: 10, sha256: 'ab' }, { size: 10, sha256: 'cd' })).toContain('checksum');
  });

  it('reads known_hosts key blobs (all types; hashed host names too)', () => {
    const keys = knownHostKeys(
      [
        '# comment',
        '[sftp.example]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
        '|1|abc=|def= ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=',
        'garbage',
      ].join('\n'),
    );

    expect(keys).toHaveLength(2);
  });

  it('picks the targets: named ones, else every declared target; unknown names are reported', () => {
    const declared = [
      {
        name: 'offsite',
        spec: { type: 's3', endpoint: 'https://s3.example', bucket: 'dr-copies', credentials: 'secret://ops/s3' },
      },
      { name: 'broken', spec: { type: 'nope' } },
    ];
    const all = platformCopyTargets(platformBackupSettings({}), declared);

    expect(all.targets.map((t) => t.name)).toEqual(['offsite']);
    expect(
      platformCopyTargets(platformBackupSettings({ platform: { targets: [] } } as never), declared).targets,
    ).toEqual([]);
    expect(
      platformCopyTargets(platformBackupSettings({ platform: { targets: ['offsite', 'gone'] } } as never), declared),
    ).toMatchObject({ targets: [{ name: 'offsite' }], missing: ['gone'] });
    expect(platformPins(platformBackupSettings({}), 0)[0]).toContain("don't survive the loss of the cluster");
    expect(platformPins(platformBackupSettings({}), 1)).toEqual([]);
    expect(platformPins(platformBackupSettings({ platform: { enabled: false } } as never), 0)).toEqual([]);
  });
});

describe('platform retention under the second-admin rule (3.20)', () => {
  it('applies longer retention at once and keeps the longer one while a shortening waits', () => {
    expect(platformKeepDecision(null, 7)).toEqual({ apply: 7, shorten: null });
    expect(platformKeepDecision(7, 14)).toEqual({ apply: 14, shorten: null });
    expect(platformKeepDecision(7, 7)).toEqual({ apply: 7, shorten: null });
    expect(platformKeepDecision(14, 3)).toEqual({ apply: 14, shorten: 3 });
  });

  it('warns in plans that shorten a kind or leave the platform backups without an external copy', async () => {
    const manager = {
      getRepository: () => ({ find: async () => [], findOne: async () => null }),
    } as never;
    const warnings = await platformPlanWarnings(
      manager,
      [
        {
          action: 'update',
          kind: 'Cluster',
          name: 'c',
          before: { spec: { backups: { platform: { postgres: { keep: 7 } } } } },
          after: { spec: { backups: { platform: { postgres: { keep: 2 } } } } },
        },
      ],
      72,
    );

    expect(warnings).toEqual([
      expect.objectContaining({ path: 'backups.platform.postgres.keep', message: expect.stringContaining('72 h') }),
      expect.objectContaining({ path: 'backups.platform', pin: true }),
    ]);
    // A Cluster change that doesn't touch backups adds nothing.
    expect(
      await platformPlanWarnings(
        manager,
        [
          {
            action: 'update',
            kind: 'Cluster',
            name: 'c',
            before: { spec: {} },
            after: { spec: { nodeShellEnabled: true } },
          },
        ],
        72,
      ),
    ).toEqual([]);
  });
});

describe('cut-over to a point-in-time clone (3.20)', () => {
  const members = [
    { name: 'n1', connected: true, features: ['platform-backups', 'platform-cutover'] },
    { name: 'n2', connected: true, features: ['platform-backups', 'platform-cutover'] },
  ];

  it('refuses unless the clone is ready, every member is connected and supports it, and nothing else runs', () => {
    expect(cutoverRefusal(null, members, false)).toContain('does not exist');
    expect(cutoverRefusal({ state: 'restoring', node: 'n1' }, members, false)).toContain('only a ready clone');
    expect(cutoverRefusal({ state: 'ready', node: 'n1' }, members, true)).toContain('another cut-over');
    expect(cutoverRefusal({ state: 'ready', node: 'n9' }, members, false)).toContain('no longer');
    expect(
      cutoverRefusal({ state: 'ready', node: 'n1' }, [members[0], { ...members[1], connected: false }], false),
    ).toContain('offline: n2');
    expect(
      cutoverRefusal(
        { state: 'ready', node: 'n1' },
        [members[0], { ...members[1], features: ['platform-backups'] }],
        false,
      ),
    ).toContain('update their agents');
    expect(cutoverRefusal({ state: 'ready', node: 'n1' }, members, false)).toBeNull();
  });

  it('plans the steps and warns that data after the target time is lost', () => {
    const plan = cutoverPlan({
      restoreId: 'r1',
      node: 'n1',
      scope: 'lw-x-rr1',
      previousScope: 'lw-x',
      targetTime: new Date('2026-10-17T10:00:00Z'),
      readyAt: null,
      members: ['n1', 'n2'],
      now: new Date('2026-10-19T10:00:00Z'),
    });

    expect(plan.dataLossAfter).toBe('2026-10-17T10:00:00.000Z');
    expect(plan.steps[0]).toContain('final base backup');
    expect(plan.steps.some((s) => s.startsWith('n2: keep'))).toBe(true);
    expect(plan.warnings[0]).toContain('after 2026-10-17T10:00:00.000Z is lost');
    expect(plan.warnings.some((w) => w.includes('more than a day old'))).toBe(true);
  });

  it('puts the database scope and the cut-over into the members’ desired state', () => {
    const env = { ENCRYPTION_KEY: 'k'.repeat(44) };
    const restore = {
      id: 'r1',
      node: 'n1',
      scope: 'lw-x-rr1',
      sourceScope: 'lw-x',
      targetTime: null,
    } as PlatformRestoreEntity;
    const cutover = { restoreId: 'r1', scope: 'lw-x-rr1', previousScope: 'lw-x', node: 'n1' } as PlatformCutoverEntity;
    const role = platformBackupsRole('n2', 'member', undefined, null, env, cutover);

    expect(role?.postgresCutover).toEqual({ id: 'r1', scope: 'lw-x-rr1', previousScope: 'lw-x', node: 'n1' });
    expect(role?.postgresClone).toBeUndefined();
    expect(platformBackupsRole('n1', 'member', undefined, restore, env)?.postgresClone?.id).toBe('r1');

    const base = { role: 'member' as const, members: [], automaticFailover: false, scope: 'lw-x' };

    expect(
      withPlatformState(base, 'n1', undefined, { restore: null, cutover: null, postgresScope: 'lw-x-rr1' }, env),
    ).toMatchObject({ postgresScope: 'lw-x-rr1' });
    expect(
      withPlatformState(base, 'n1', undefined, { restore: null, cutover: null, postgresScope: null }, env),
    ).not.toHaveProperty('postgresScope');
    expect(
      withPlatformState(
        { ...base, role: 'witness' },
        'w',
        undefined,
        { restore: null, cutover, postgresScope: 'lw-x-rr1' },
        env,
      ),
    ).not.toHaveProperty('postgresScope');
  });
});

describe('disaster recovery (3.20)', () => {
  it('selects the WAL a base backup needs (every timeline, history files)', () => {
    const prefix = 'platform/spilo/c/wal/17/wal_005/';
    const keys = [
      '000000010000000000000003.lz4',
      '000000010000000000000004.lz4',
      '000000010000000000000005.lz4',
      '000000020000000000000005.partial.lz4',
      '000000020000000000000006.lz4',
      '00000002.history.lz4',
      'sub/000000010000000000000009.lz4',
    ].map((k) => prefix + k);

    expect(walForBackup('base_000000010000000000000004', prefix, keys).map((k) => k.slice(prefix.length))).toEqual([
      '000000010000000000000004.lz4',
      '000000010000000000000005.lz4',
      '000000020000000000000005.partial.lz4',
      '000000020000000000000006.lz4',
      '00000002.history.lz4',
    ]);
    expect(() => walForBackup('nope', prefix, keys)).toThrow('base backup');
  });

  it('chooses the newest complete backup, or the newest before a target time', () => {
    const candidates = [
      { backup: 'base_A', scope: 'c', finishedAt: new Date('2026-10-18T02:00:00Z') },
      { backup: 'base_B', scope: 'c', finishedAt: new Date('2026-10-19T02:00:00Z') },
      { backup: 'base_C', scope: 'c', finishedAt: new Date('2026-10-19T08:00:00Z') },
    ];

    expect(chooseDrBackup(candidates, new Set(['base_A', 'base_B', 'base_C']))?.backup).toBe('base_C');
    expect(chooseDrBackup(candidates, new Set(['base_A', 'base_B']))?.backup).toBe('base_B');
    expect(
      chooseDrBackup(candidates, new Set(['base_A', 'base_B', 'base_C']), new Date('2026-10-19T05:00:00Z'))?.backup,
    ).toBe('base_B');
    expect(chooseDrBackup(candidates, new Set(['base_A']), new Date('2026-10-01T00:00:00Z'))).toBeNull();
    expect(newestEtcdSnapshot(['e/etcd-20261018t010000z.db', 'e/etcd-20261019t010000z.db', 'e/other.db'])).toBe(
      'e/etcd-20261019t010000z.db',
    );
  });

  it('validates the recovery environment of the restored API', () => {
    const value = {
      id: '6a1e2a1c-0e6f-4b55-9a9a-1f5b7d6c3e21',
      node: 'n1',
      token: `lwj_${'a'.repeat(12)}.${'b'.repeat(43)}`,
      secret: 'c'.repeat(43),
    };

    expect(readDrRecoveryEnv({})).toBeNull();
    expect(readDrRecoveryEnv({ LOADWEAVER_DR_RECOVERY: JSON.stringify(value) })).toMatchObject({
      restoreVolumes: true,
    });
    expect(() => readDrRecoveryEnv({ LOADWEAVER_DR_RECOVERY: JSON.stringify({ ...value, token: 'x' }) })).toThrow(
      'invalid join token',
    );
    expect(drRecoveryEnvSchema.safeParse({ ...value, secret: 'short' }).success).toBe(false);
    expect(drRestoreName('6a1e2a1c-0e6f', 'shop/store/data_1')).toBe('dr-6a1e2a1c-store-data-1');
  });

  it('counts the restore attempts of a volume (a node still settling may refuse the first)', () => {
    expect(volumeRestoreState('pending')).toEqual({ state: 'pending', attempt: 1 });
    expect(volumeRestoreState('pending#2')).toEqual({ state: 'pending', attempt: 2 });
    expect(volumeRestoreState('restoring:abc#3')).toEqual({ state: 'restoring:abc', attempt: 3 });
    expect(volumeRestoreState('restored:abc')).toEqual({ state: 'restored:abc', attempt: 1 });
  });

  /** An external target in memory, filled the way the copy service fills a real one. */
  class MemoryDestination implements CopyDestination {
    readonly type = 's3' as const;
    readonly objects = new Map<string, { body: Buffer; lastModified: Date }>();

    async put(key: string, body: NodeJS.ReadableStream): Promise<void> {
      this.objects.set(key, { body: await collect(body), lastModified: new Date() });
    }

    async head(key: string) {
      const o = this.objects.get(key);

      return o ? { size: o.body.length, metadata: {}, lockUntil: null } : null;
    }

    async get(key: string) {
      const o = this.objects.get(key);

      if (!o) throw Object.assign(new Error(`NoSuchKey ${key}`), { name: 'NoSuchKey' });

      return Readable.from([o.body]);
    }

    async list(prefix: string) {
      return [...this.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified }));
    }

    async delete(): Promise<void> {
      throw new Error('append-only');
    }

    async close(): Promise<void> {
      return undefined;
    }
  }

  async function seededTarget(root: Buffer, generation: number) {
    const target = new MemoryDestination();
    const copyKey = platformCopyKey(backupDataKey(root, generation));
    const add = async (sourceKey: string, body: Buffer, at = new Date()) => {
      target.objects.set(`platform/${sourceKey}`, {
        body: await encrypt(copyKey, generation, sourceKey, body),
        lastModified: at,
      });
    };
    const backup = 'base_000000010000000000000004';
    const envelope = await sealDrEnvelope(
      { current: async () => ({ generation, key: backupDataKey(root, generation) }) },
      {
        masterKey: { id: 'abcdabcdabcdabcd', value: Buffer.alloc(32, 9) },
        env: { ENCRYPTION_KEY: 'enc', DB_PASSWORD: 'pw' },
        cluster: null,
        backup: { kind: 'postgres', name: backup, postgresScope: 'lw-c', finishedAt: '2026-10-19T02:00:00.000Z' },
      },
    );

    target.objects.set('platform/dr/cluster.json', {
      body: Buffer.from(JSON.stringify({ clusterId: 'lw-c', postgresScope: 'lw-c' })),
      lastModified: new Date(),
    });
    target.objects.set('platform/dr/keys.json', {
      body: Buffer.from(
        JSON.stringify({
          keys: [
            {
              generation,
              rootId: secretId(root),
              kitShares: 3,
              kitThreshold: 2,
              kitConfirmed: true,
              active: true,
              escrow: null,
            },
          ],
        }),
      ),
      lastModified: new Date(),
    });
    await add(`dr-envelope/${backup}.json`, Buffer.from(JSON.stringify(envelope)));
    // An older envelope whose base backup is gone (incomplete set): skipped.
    await add('dr-envelope/base_000000010000000000000001.json', Buffer.from(JSON.stringify(envelope)), new Date(0));
    await add(
      `spilo/lw-c/wal/17/basebackups_005/${backup}_backup_stop_sentinel.json`,
      Buffer.from(JSON.stringify({ FinishTime: '2026-10-19T02:00:00Z' })),
    );
    await add(`spilo/lw-c/wal/17/basebackups_005/${backup}/tar_partitions/part_1.tar.lz4`, Buffer.alloc(3000, 1));
    await add('spilo/lw-c/wal/17/wal_005/000000010000000000000003.lz4', Buffer.alloc(10, 3));
    await add('spilo/lw-c/wal/17/wal_005/000000010000000000000004.lz4', Buffer.alloc(10, 4));
    await add('spilo/lw-c/wal/17/wal_005/000000010000000000000005.lz4', Buffer.alloc(10, 5));
    await add('etcd/lw-c/etcd-20261019t010000z.db', Buffer.alloc(20, 6));

    return target;
  }

  it('restores the newest complete set with 2 of 3 kit shares (the DR tool on a fresh node)', async () => {
    const root = generateKey();
    const target = await seededTarget(root, 2);
    const shares = splitSecret(root, 3, 2).map((share) =>
      kitShareText(kitShareDocument({ cluster: 'lw-c', generation: 2, shares: 3, share, createdAt: new Date() })),
    );
    const out = await mkdtemp(join(tmpdir(), 'lw-dr-'));
    const events: Record<string, unknown>[] = [];

    try {
      const request = drToolRequestSchema.parse({
        target: {
          type: 's3',
          endpoint: 'https://s3.example',
          bucket: 'dr-copies',
          credentials: 'secret://dr-restore/s3',
        },
        credentials: { accessKeyId: 'a', secretAccessKey: 's' },
        key: { shares: [shares[2], shares[0]] },
        outputDir: out,
      });
      const result = await drRestore(
        request,
        (e) => events.push(e),
        () => target,
      );

      expect(result).toMatchObject({
        clusterId: 'lw-c',
        postgresScope: 'lw-c',
        backup: 'base_000000010000000000000004',
        generation: 2,
        walgPrefix: 'platform/spilo/lw-c/wal/17',
        etcdSnapshot: 'platform/etcd/lw-c/etcd-20261019t010000z.db',
        env: { ENCRYPTION_KEY: 'enc', DB_PASSWORD: 'pw' },
        masterKey: { id: 'abcdabcdabcdabcd', value: Buffer.alloc(32, 9).toString('base64') },
        objects: 5,
      });
      expect(
        await readFile(
          join(
            out,
            'platform/spilo/lw-c/wal/17/basebackups_005/base_000000010000000000000004/tar_partitions/part_1.tar.lz4',
          ),
        ),
      ).toEqual(Buffer.alloc(3000, 1));
      await expect(
        readFile(join(out, 'platform/spilo/lw-c/wal/17/wal_005/000000010000000000000003.lz4')),
      ).rejects.toThrow();
      expect(await readFile(join(out, 'platform/spilo/lw-c/wal/17/wal_005/000000010000000000000005.lz4'))).toEqual(
        Buffer.alloc(10, 5),
      );
      expect(JSON.stringify(events)).not.toContain('enc');

      // One share is not enough; a kit of another generation decrypts nothing here.
      await expect(
        drRestore(
          { ...request, key: { shares: [shares[1]] } },
          () => undefined,
          () => target,
        ),
      ).rejects.toThrow('2 shares are needed');

      const otherRoot = generateKey();
      const other = splitSecret(otherRoot, 3, 2).map((share) =>
        kitShareText(kitShareDocument({ cluster: 'lw-c', generation: 1, shares: 3, share, createdAt: new Date() })),
      );

      await expect(
        drRestore(
          { ...request, key: { shares: other.slice(0, 2) } },
          () => undefined,
          () => target,
        ),
      ).rejects.toThrow('no usable control-plane backup');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('carries the backup and its database scope inside the sealed envelope', async () => {
    const root = generateKey();
    const envelope = await sealDrEnvelope(
      { current: async () => ({ generation: 1, key: backupDataKey(root, 1) }) },
      {
        masterKey: { id: 'x', value: Buffer.alloc(32) },
        env: {},
        cluster: null,
        backup: { kind: 'postgres', name: 'base_1', postgresScope: 'lw-c-rabc', finishedAt: 't' },
      },
    );

    expect(JSON.stringify(envelope)).not.toContain('lw-c-rabc');
    expect((await openDrEnvelope(envelope, { root })).backup?.postgresScope).toBe('lw-c-rabc');
  });
});

describe('object lock of external S3 targets (unit; Garage has none, the labs use a fake S3)', () => {
  const client = (config: unknown) => ({ send: jest.fn(async () => config) }) as never;
  const declared = { mode: 'COMPLIANCE' as const, days: 30 };

  it('accepts an enabled lock in the declared mode with at least the declared days (or no default rule)', async () => {
    const enabled = (rule?: unknown) => ({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', ...(rule ? { Rule: { DefaultRetention: rule } } : {}) },
    });

    await expect(checkBucketObjectLock(client(enabled({ Mode: 'COMPLIANCE', Days: 30 })), 'b', declared)).resolves.toBe(
      30,
    );
    await expect(checkBucketObjectLock(client(enabled({ Mode: 'COMPLIANCE', Years: 1 })), 'b', declared)).resolves.toBe(
      30,
    );
    await expect(checkBucketObjectLock(client(enabled()), 'b', declared)).resolves.toBe(30);
    await expect(
      checkBucketObjectLock(client(enabled({ Mode: 'GOVERNANCE', Days: 30 })), 'b', declared),
    ).rejects.toThrow('GOVERNANCE mode');
    await expect(
      checkBucketObjectLock(client(enabled({ Mode: 'COMPLIANCE', Days: 7 })), 'b', declared),
    ).rejects.toThrow('locks for 7 days');
    await expect(checkBucketObjectLock(client({}), 'b', declared)).rejects.toThrow('has no object lock');
  });
});

describe('disaster recovery replan (3.20 step 5: deployments onto the nodes that exist)', () => {
  const startedAt = new Date('2026-10-19T10:00:00Z');
  const row = { id: 'r1', node: 'n1', startedAt, replannedAt: null } as unknown as DrRecoveryEntity;

  // What is placed now (the restored database) and what the re-plan computes: the lost node's replica moves to n1.
  const placedNow = {
    replicas: [{ service: 'shop/web/api', replica: 'shop/web/api/0', node: 'lost' }],
    volumes: [] as Array<{ volume: string; primary: string; syncReplicas: string[]; remoteReplicas: string[] }>,
  };
  const moved = [{ service: 'shop/web/api', replica: 'shop/web/api/0', node: 'n1' }];

  function setup(
    node: Record<string, unknown> | null,
    unschedulable: Array<{ service?: string; replica?: string; reason: string }>,
    scheduled: typeof moved = moved,
  ) {
    const updates: unknown[] = [];
    const audit = { record: jest.fn(async () => undefined), recordStandalone: jest.fn(async () => undefined) };
    const placed = { replicas: [...placedNow.replicas], volumes: [...placedNow.volumes] };
    const planner = {
      plan: jest.fn(async () => ({ schedule: { unschedulable, replicas: scheduled, volumes: [] } })),
      current: jest.fn(async () => placed),
      // Persisting makes the schedule what is placed.
      persist: jest.fn(async () => {
        placed.replicas = [...scheduled];
      }),
    };
    const manager = {
      getRepository: (entity: { name: string }) => ({
        find: async () =>
          entity.name === 'ResourceEntity'
            ? [{ kind: 'Cluster', spec: { network: defaultClusterNetwork((n) => randomBytes(n)) } }]
            : [],
        update: async (where: unknown, values: unknown) => updates.push({ entity: entity.name, where, values }),
      }),
    };
    const dataSource = {
      getRepository: () => ({ findOne: async () => node }),
      transaction: async (fn: (m: typeof manager) => Promise<unknown>) => await fn(manager),
    };
    const network = { requestRecompile: jest.fn() };
    const service = new DrRecoveryService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      network as never,
      undefined,
      planner as never,
    );
    const replan = (now: Date) =>
      (service as unknown as { replan: (r: DrRecoveryEntity, n: Date) => Promise<boolean> }).replan(row, now);

    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    return { replan, planner, updates, audit, network, warn };
  }

  it('waits until the restoring node joined as a control-plane member', async () => {
    for (const node of [
      null,
      { lifecycle: 'left', joinedAt: startedAt, controlPlane: true },
      { lifecycle: 'active', joinedAt: new Date(startedAt.getTime() - 1), controlPlane: true },
      { lifecycle: 'active', joinedAt: startedAt, controlPlane: false },
    ]) {
      const { replan, planner } = setup(node, []);

      expect(await replan(new Date())).toBe(false);
      expect(planner.persist).not.toHaveBeenCalled();
    }
  });

  it('places every deployment in failover mode and marks the recovery replanned once everything fits', async () => {
    const now = new Date('2026-10-19T10:05:00Z');
    const { replan, planner, updates, audit, network } = setup(
      { lifecycle: 'active', joinedAt: startedAt, controlPlane: true },
      [],
    );

    expect(await replan(now)).toBe(true);
    expect(planner.persist).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'failover');
    expect(updates).toEqual([{ entity: 'DrRecoveryEntity', where: { id: 'r1' }, values: { replannedAt: now } }]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'workload.failover', target: 'dr/r1' }),
    );
    expect(network.requestRecompile).toHaveBeenCalledWith('disaster recovery: placements');
  });

  it('places what fits and tries again while replicas are unschedulable (e.g. a second node still joining)', async () => {
    const { replan, planner, updates } = setup({ lifecycle: 'active', joinedAt: startedAt, controlPlane: true }, [
      { replica: 'shop/store/db/1', reason: 'no second node for the volume replica' },
    ]);

    expect(await replan(new Date())).toBe(true);
    expect(planner.persist).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('names the service in the "not placed yet" warning when an unschedulable entry has no replica id', async () => {
    const { replan, warn } = setup({ lifecycle: 'active', joinedAt: startedAt, controlPlane: true }, [
      { service: 'shop/web/api', reason: 'no eligible node' },
      { service: 'shop/store/db', replica: 'shop/store/db/0', reason: 'no second node' },
    ]);

    warn.mockImplementation(() => undefined);
    expect(await replan(new Date())).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Disaster recovery: not placed yet (shop/web/api: no eligible node; shop/store/db/0: no second node)',
    );
    expect(warn.mock.calls.flat().join(' ')).not.toContain('undefined');
  });

  it('persists and recompiles only when the computed placements changed (gate item: no re-persist every pass)', async () => {
    const { replan, planner, updates, network } = setup(
      { lifecycle: 'active', joinedAt: startedAt, controlPlane: true },
      [{ replica: 'shop/store/db/0', reason: 'no eligible node holding a copy of its volumes has enough capacity' }],
    );

    // First pass: the replica of the lost node moves.
    expect(await replan(new Date())).toBe(true);
    // Later passes while the stateful replica still can't be scheduled: same placements → nothing written.
    expect(await replan(new Date())).toBe(true);
    expect(await replan(new Date())).toBe(true);
    expect(planner.plan).toHaveBeenCalledTimes(3);
    expect(planner.persist).toHaveBeenCalledTimes(1);
    expect(network.requestRecompile).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('marks the recovery replanned without persisting when everything already sits where it should', async () => {
    const now = new Date('2026-10-19T10:06:00Z');
    const { replan, planner, updates, network } = setup(
      { lifecycle: 'active', joinedAt: startedAt, controlPlane: true },
      [],
      placedNow.replicas,
    );

    expect(await replan(now)).toBe(true);
    expect(planner.persist).not.toHaveBeenCalled();
    expect(network.requestRecompile).not.toHaveBeenCalled();
    expect(updates).toEqual([{ entity: 'DrRecoveryEntity', where: { id: 'r1' }, values: { replannedAt: now } }]);
  });
});
