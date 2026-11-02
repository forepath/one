import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { backupTargetSpecSchema, type BackupTargetSpec } from '@forepath/loadweaver/shared/util-model';
import { secretId } from '@forepath/loadweaver/shared/util-secrets';
import { z } from 'zod';

import { VaultTransitKms } from '../../kms/vault-transit.kms';
import { backupDataKey, combineKit, parseKitShare } from '../backup-keys.utils';
import { openDrEnvelope, type DrEnvelope, type DrEnvelopeContents } from '../dr-envelope';
import { S3CopyDestination, SftpCopyDestination, type CopyDestination } from './platform-copy.destinations';
import {
  chooseDrBackup,
  COPY_ROOT,
  decryptStream,
  DR_CLUSTER_KEY,
  DR_KEYS_KEY,
  DR_PREFIXES,
  newestEtcdSnapshot,
  platformCopyKey,
  walForBackup,
  type DrCandidate,
} from './platform-copy.utils';
import type { DrInfoKey } from './platform-dr.utils';

/**
 * The disaster-recovery tool of a fresh node (3.20, `loadweaver-agent bootstrap --restore`), run by the agent as a
 * one-shot container of the control-plane image (`node main.js dr <request file>`): it holds the code that decrypts
 * the external copy (backup key from the recovery kit or the KMS escrow, `LWPC` copies, the DR envelope). It reads the
 * request (target, its credentials, kit shares or KMS settings), picks the newest complete Postgres base backup (or
 * the newest before a target time), downloads and decrypts the base backup, its WAL and the newest etcd snapshot into
 * the output directory and writes `result.json` (0600: the restored environment and master key) for the agent.
 * Progress goes to stdout as JSON lines, never secrets.
 */

export const drToolRequestSchema = z
  .object({
    target: z.unknown(),
    credentials: z.union([
      z.object({ accessKeyId: z.string().min(1).max(256), secretAccessKey: z.string().min(1).max(256) }).strict(),
      z.object({ privateKey: z.string().min(1).max(16_384) }).strict(),
    ]),
    key: z.union([
      z.object({ shares: z.array(z.string().max(16_384)).min(1).max(16) }).strict(),
      z
        .object({
          kms: z
            .object({
              provider: z.literal('vault-transit'),
              env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(8192)),
              generation: z.number().int().positive().optional(),
            })
            .strict(),
        })
        .strict(),
    ]),
    /** ISO 8601: restore the newest base backup finished before it (recovery stops there). */
    targetTime: z.string().max(40).optional(),
    outputDir: z.string().regex(/^\/[A-Za-z0-9/_.-]{1,255}$/),
  })
  .strict();
export type DrToolRequest = z.infer<typeof drToolRequestSchema>;

export interface DrToolResult {
  clusterId: string;
  postgresScope: string;
  backup: string;
  backupFinishedAt: string | null;
  generation: number;
  /** Relative to the output directory: WAL-G's file storage prefix (`WALG_FILE_PREFIX`). */
  walgPrefix: string;
  /** Relative to the output directory, or null when no etcd snapshot was copied. */
  etcdSnapshot: string | null;
  env: DrEnvelopeContents['env'];
  masterKey: { id: string; value: string };
  objects: number;
  bytes: number;
}

type Log = (event: Record<string, unknown>) => void;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));

  return Buffer.concat(chunks);
}

export function destinationFor(target: BackupTargetSpec, credentials: DrToolRequest['credentials']): CopyDestination {
  if (target.type === 's3') {
    if (!('accessKeyId' in credentials)) throw new Error('an S3 target needs an access key');

    return new S3CopyDestination(target, credentials);
  }

  if (!('privateKey' in credentials)) throw new Error('an SFTP target needs a private key');

  return new SftpCopyDestination(target, credentials.privateKey);
}

/** The backup root key from the kit shares or the KMS escrow, and its generation. */
export async function recoverRoot(
  key: DrToolRequest['key'],
  keys: DrInfoKey[],
): Promise<{ root: Buffer; generation: number }> {
  if ('shares' in key) {
    const root = combineKit(key.shares);
    const rootId = secretId(root);
    const generation =
      keys.find((k) => k.rootId === rootId)?.generation ??
      key.shares.map((s) => parseKitShare(s).generation).find((g): g is number => g !== null);

    if (!generation) throw new Error('the kit belongs to no backup key generation on this target');

    return { root, generation };
  }

  const escrowed = keys
    .filter((k) => k.escrow?.provider === key.kms.provider)
    .filter((k) => !key.kms.generation || k.generation === key.kms.generation)
    .sort((a, b) => b.generation - a.generation)[0];

  if (!escrowed?.escrow) throw new Error(`no backup key generation is escrowed in ${key.kms.provider}`);

  for (const [name, value] of Object.entries(key.kms.env)) process.env[name] = value;

  const root = await new VaultTransitKms().unwrap(escrowed.escrow.wrapped, `backup-${escrowed.rootId}`);

  if (secretId(root) !== escrowed.rootId) throw new Error('the KMS returned a different backup key');

  return { root, generation: escrowed.generation };
}

/** Runs the whole recovery read side; returns what the agent needs (also written to `result.json`). */
export async function drRestore(
  request: DrToolRequest,
  log: Log,
  /** The target's client (tests pass their own). */
  open: (target: BackupTargetSpec) => CopyDestination = (target) => destinationFor(target, request.credentials),
): Promise<DrToolResult> {
  const destination = open(backupTargetSpecSchema.parse(request.target));
  const started = Date.now();
  let objects = 0;
  let bytes = 0;

  try {
    const cluster = JSON.parse((await readAll(await destination.get(DR_CLUSTER_KEY))).toString('utf8')) as {
      clusterId: string;
      postgresScope: string;
    };
    const keys = (
      JSON.parse((await readAll(await destination.get(DR_KEYS_KEY))).toString('utf8')) as { keys: DrInfoKey[] }
    ).keys;

    log({ phase: 'located', cluster: cluster.clusterId, generations: keys.map((k) => k.generation) });

    const { root, generation } = await recoverRoot(request.key, keys);
    const copyKey = platformCopyKey(backupDataKey(root, generation));
    const keyFor = (g: number): Buffer => {
      if (g !== generation)
        throw new Error(
          `encrypted under backup key generation ${g}; the kit / KMS key given is generation ${generation}`,
        );

      return copyKey;
    };
    const decrypt = async (copyKeyName: string): Promise<Buffer> =>
      await readAll(
        (await destination.get(copyKeyName)).pipe(decryptStream(copyKeyName.slice(COPY_ROOT.length), keyFor)),
      );

    log({ phase: 'key', generation });

    // Newest envelopes first; each names its base backup and the database scope.
    const envelopes = (await destination.list(DR_PREFIXES.envelopes))
      .filter((e) => /\/base_[0-9A-F]{24}(_D_[0-9A-F]{24})?\.json$/.test(e.key))
      .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0) || (a.key < b.key ? 1 : -1));
    const targetTime = request.targetTime ? new Date(request.targetTime) : undefined;

    if (targetTime && Number.isNaN(targetTime.getTime())) throw new Error('targetTime must be an ISO 8601 time');

    const candidates: Array<DrCandidate & { contents: DrEnvelopeContents }> = [];
    const skipped: string[] = [];

    for (const entry of envelopes.slice(0, 60)) {
      const name = entry.key.slice(DR_PREFIXES.envelopes.length, -'.json'.length);

      try {
        const envelope = JSON.parse((await decrypt(entry.key)).toString('utf8')) as DrEnvelope;
        const contents = await openDrEnvelope(envelope, { root });
        const scope = contents.backup?.postgresScope ?? cluster.postgresScope;
        const sentinel = `${DR_PREFIXES.spilo}${scope}/wal/17/basebackups_005/${name}_backup_stop_sentinel.json`;
        const finish = (JSON.parse((await decrypt(sentinel)).toString('utf8')) as { FinishTime?: string }).FinishTime;

        candidates.push({
          backup: name,
          scope,
          finishedAt: finish ? new Date(finish) : contents.backup ? new Date(contents.backup.finishedAt) : null,
          contents,
        });

        if (!targetTime) break; // the newest complete set is enough
      } catch (error) {
        skipped.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const chosen = chooseDrBackup(candidates, new Set(candidates.map((c) => c.backup)), targetTime) as
      | (DrCandidate & { contents: DrEnvelopeContents })
      | null;

    if (!chosen)
      throw new Error(
        `no usable control-plane backup on the target${targetTime ? ` before ${targetTime.toISOString()}` : ''}${
          skipped.length ? ` (${skipped.slice(0, 3).join('; ')})` : ''
        }`,
      );

    log({ phase: 'chosen', backup: chosen.backup, scope: chosen.scope, finishedAt: chosen.finishedAt });

    const save = async (copyKeyName: string): Promise<void> => {
      const relative = normalize(copyKeyName.slice(COPY_ROOT.length));

      if (relative.startsWith('..') || relative.startsWith('/')) throw new Error(`unsafe key ${copyKeyName}`);

      const path = join(request.outputDir, 'platform', relative);

      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await pipeline(
        await destination.get(copyKeyName),
        decryptStream(relative, keyFor),
        createWriteStream(path, { mode: 0o600 }),
      );
      objects++;
    };
    const walPrefix = `${DR_PREFIXES.spilo}${chosen.scope}/wal/17/`;
    const base = (await destination.list(`${walPrefix}basebackups_005/${chosen.backup}`)).map((o) => o.key);
    const walListing = await destination.list(`${walPrefix}wal_005/`);
    const wal = walForBackup(
      chosen.backup,
      `${walPrefix}wal_005/`,
      walListing.map((o) => o.key),
    );
    const sizes = new Map(
      [...walListing, ...(await destination.list(`${walPrefix}basebackups_005/`))].map((o) => [o.key, o.size]),
    );
    const etcdKeys = (await destination.list(`${DR_PREFIXES.etcd}${cluster.clusterId}/`)).map((o) => o.key);
    const etcd = newestEtcdSnapshot(
      targetTime
        ? etcdKeys.filter((k) => {
            const stamp = /etcd-(\d{8}t\d{6}z)\.db$/.exec(k)?.[1];

            return !!stamp && stamp <= `${targetTime.toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase()}z`;
          })
        : etcdKeys,
    );
    const work = [...base, ...wal, ...(etcd ? [etcd] : [])];

    for (const key of work) bytes += sizes.get(key) ?? 0;

    log({ phase: 'download', objects: work.length, baseObjects: base.length, wal: wal.length, etcd: !!etcd });

    // A few transfers at a time (WAL segments are many small objects).
    let next = 0;

    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < work.length) {
          const key = work[next++];

          await save(key);

          if (objects % 50 === 0) log({ phase: 'download', done: objects, of: work.length });
        }
      }),
    );

    const result: DrToolResult = {
      clusterId: cluster.clusterId,
      postgresScope: chosen.scope,
      backup: chosen.backup,
      backupFinishedAt: chosen.finishedAt?.toISOString() ?? null,
      generation,
      walgPrefix: `platform/spilo/${chosen.scope}/wal/17`,
      etcdSnapshot: etcd ? `platform/${etcd.slice(COPY_ROOT.length)}` : null,
      env: chosen.contents.env,
      masterKey: { id: chosen.contents.masterKey.id, value: chosen.contents.masterKey.value.toString('base64') },
      objects,
      bytes,
    };

    log({ phase: 'done', objects, seconds: Math.round((Date.now() - started) / 1000) });

    return result;
  } finally {
    await destination.close();
  }
}

/** `node main.js dr <request file>` in the control-plane image (see `runDrToolCli`). */
export async function runDrToolCli(requestFile: string): Promise<void> {
  const log: Log = (event) => process.stdout.write(`${JSON.stringify({ dr: true, ...event })}\n`);
  const request = drToolRequestSchema.parse(JSON.parse(await readFile(requestFile, 'utf8')));
  const result = await drRestore(request, log);
  const out = join(request.outputDir, 'result.json');

  await writeFile(out, JSON.stringify(result), { mode: 0o600 });
  await chmod(out, 0o600);
}
