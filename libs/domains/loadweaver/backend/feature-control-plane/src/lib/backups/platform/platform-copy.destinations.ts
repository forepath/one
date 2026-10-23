import { posix } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { BackupTargetSpec } from '@forepath/loadweaver/shared/util-model';
import { Client, type SFTPWrapper } from 'ssh2';

/**
 * Where external copies of the platform bucket go (3.20): an S3-compatible bucket (with object lock in compliance
 * mode where configured) or an SFTP server. Keys are relative to the target's prefix / path (`platform/…`).
 */
export interface CopyDestination {
  readonly type: 's3' | 'sftp';
  /** Uploads exactly `size` bytes; `lockUntil` sets object-lock retention (S3 targets with object lock). */
  put(
    key: string,
    body: Readable,
    size: number,
    options?: { metadata?: Record<string, string>; lockUntil?: Date | null },
  ): Promise<void>;
  head(
    key: string,
  ): Promise<{ size: number; etag?: string; metadata: Record<string, string>; lockUntil: Date | null } | null>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date | null }>>;
  delete(keys: string[]): Promise<void>;
  close(): Promise<void>;
}

export interface S3TargetCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Object lock of an S3 target's bucket: must be enabled with the declared mode and at least the declared days. */
export async function checkBucketObjectLock(
  client: S3Client,
  bucket: string,
  declared: { mode: 'COMPLIANCE' | 'GOVERNANCE'; days: number },
): Promise<number> {
  const config = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
  const rule = config.ObjectLockConfiguration?.Rule?.DefaultRetention;
  const days = rule?.Days ?? (rule?.Years ? rule.Years * 365 : 0);

  if (config.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled')
    throw new Error(`bucket ${bucket} has no object lock`);

  if (rule && rule.Mode !== declared.mode)
    throw new Error(`bucket ${bucket} locks in ${rule.Mode} mode, ${declared.mode} declared`);

  // Without a default rule every object gets its retention explicitly (set by the copy); with one it must be long
  // enough not to shorten the declared retention.
  if (rule && days < declared.days)
    throw new Error(`bucket ${bucket} locks for ${days} days, ${declared.days} declared`);

  return declared.days;
}

export class S3CopyDestination implements CopyDestination {
  readonly type = 's3' as const;
  readonly client: S3Client;

  constructor(
    private readonly target: Extract<BackupTargetSpec, { type: 's3' }>,
    credentials: S3TargetCredentials,
  ) {
    this.client = new S3Client({
      endpoint: target.endpoint,
      region: target.region,
      forcePathStyle: true,
      credentials,
      maxAttempts: 3,
    });
  }

  private key(key: string): string {
    return `${this.target.prefix}${key}`;
  }

  async put(
    key: string,
    body: Readable,
    size: number,
    options: { metadata?: Record<string, string>; lockUntil?: Date | null } = {},
  ): Promise<void> {
    if (size > 5 * 1024 ** 3) throw new Error(`${key}: objects above 5 GiB are not supported by the copy`);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.target.bucket,
        Key: this.key(key),
        Body: body,
        ContentLength: size,
        ContentType: 'application/octet-stream',
        ...(options.metadata ? { Metadata: options.metadata } : {}),
        ...(options.lockUntil && this.target.objectLock
          ? { ObjectLockMode: this.target.objectLock.mode, ObjectLockRetainUntilDate: options.lockUntil }
          : {}),
      }),
    );
  }

  async head(
    key: string,
  ): Promise<{ size: number; etag?: string; metadata: Record<string, string>; lockUntil: Date | null } | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.target.bucket, Key: this.key(key) }));

      return {
        size: head.ContentLength ?? 0,
        ...(head.ETag ? { etag: head.ETag } : {}),
        metadata: head.Metadata ?? {},
        lockUntil: head.ObjectLockRetainUntilDate ?? null,
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return null;

      throw error;
    }
  }

  async get(key: string): Promise<Readable> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.target.bucket, Key: this.key(key) }));

    return object.Body as Readable;
  }

  async list(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date | null }>> {
    const out: Array<{ key: string; size: number; lastModified: Date | null }> = [];
    let token: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.target.bucket, Prefix: this.key(prefix), ContinuationToken: token }),
      );

      for (const c of page.Contents ?? [])
        if (c.Key)
          out.push({
            key: c.Key.slice(this.target.prefix.length),
            size: c.Size ?? 0,
            lastModified: c.LastModified ?? null,
          });

      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    return out;
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.target.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((k) => ({ Key: this.key(k) })), Quiet: true },
        }),
      );

      if (result.Errors?.length)
        throw new Error(`${result.Errors.length} object(s) not deleted: ${result.Errors[0].Message ?? ''}`);
    }
  }

  async objectLockDays(): Promise<number | null> {
    return this.target.objectLock
      ? await checkBucketObjectLock(this.client, this.target.bucket, this.target.objectLock)
      : null;
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}

/** `known_hosts` lines → host key blobs (the host field is not checked: the target's host is configured). */
export function knownHostKeys(knownHosts: string): Buffer[] {
  return knownHosts
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((line) => {
      const parts = line.split(/\s+/);
      const at = parts.findIndex((p) => /^(ssh-|ecdsa-|sk-)/.test(p));

      return at >= 0 && parts[at + 1] ? [Buffer.from(parts[at + 1], 'base64')] : [];
    });
}

/** SFTP target: files under `<path>/`, written as `.part` and renamed when complete. */
export class SftpCopyDestination implements CopyDestination {
  readonly type = 'sftp' as const;
  private connection: Promise<{ client: Client; sftp: SFTPWrapper }> | null = null;

  constructor(
    private readonly target: Extract<BackupTargetSpec, { type: 'sftp' }>,
    private readonly privateKey: string,
  ) {}

  private path(key: string): string {
    const relative = posix.normalize(key);

    if (relative.startsWith('..') || posix.isAbsolute(relative)) throw new Error(`invalid key ${key}`);

    return posix.join(this.target.path, relative);
  }

  private async open(): Promise<{ client: Client; sftp: SFTPWrapper }> {
    this.connection ??= new Promise((resolve, reject) => {
      const allowed = knownHostKeys(this.target.knownHosts);
      const client = new Client();

      client
        .on('ready', () =>
          client.sftp((error, sftp) => (error ? reject(error) : resolve({ client, sftp: sftp as SFTPWrapper }))),
        )
        .on('error', reject)
        .connect({
          host: this.target.host,
          port: this.target.port,
          username: this.target.user,
          privateKey: this.privateKey,
          readyTimeout: 30_000,
          hostVerifier: (key: Buffer) => allowed.some((k) => k.equals(key)),
        });
    });

    return await this.connection;
  }

  private async mkdirs(dir: string): Promise<void> {
    const { sftp } = await this.open();
    const parts = dir.split('/').filter(Boolean);
    let current = dir.startsWith('/') ? '' : '.';

    for (const part of parts) {
      current = `${current}/${part}`;

      await new Promise<void>((resolve) =>
        sftp.stat(current, (statError) => (statError ? sftp.mkdir(current, () => resolve()) : resolve())),
      );
    }
  }

  async put(key: string, body: Readable, size: number): Promise<void> {
    const { sftp } = await this.open();
    const path = this.path(key);
    const part = `${path}.part`;

    await this.mkdirs(posix.dirname(path));
    await pipeline(body, sftp.createWriteStream(part, { mode: 0o600 }));

    const written = await this.stat(part);

    if (written?.size !== size) throw new Error(`${key}: ${written?.size ?? 0} of ${size} bytes written`);

    // Replace an older copy of a rewritten object (no atomic rename-over in SFTP v3).
    await new Promise<void>((resolve) => sftp.unlink(path, () => resolve()));
    await new Promise<void>((resolve, reject) =>
      sftp.rename(part, path, (error) => (error ? reject(error) : resolve())),
    );
  }

  private async stat(path: string): Promise<{ size: number; mtime: number } | null> {
    const { sftp } = await this.open();

    return await new Promise((resolve) =>
      sftp.stat(path, (error, stats) => resolve(error ? null : { size: stats.size, mtime: stats.mtime })),
    );
  }

  async head(key: string): Promise<{ size: number; metadata: Record<string, string>; lockUntil: Date | null } | null> {
    const stats = await this.stat(this.path(key));

    return stats ? { size: stats.size, metadata: {}, lockUntil: null } : null;
  }

  async get(key: string): Promise<Readable> {
    const { sftp } = await this.open();
    const out = new PassThrough();

    sftp
      .createReadStream(this.path(key))
      .on('error', (error: Error) => out.destroy(error))
      .pipe(out);

    return out;
  }

  async list(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date | null }>> {
    const { sftp } = await this.open();
    const out: Array<{ key: string; size: number; lastModified: Date | null }> = [];
    // Walk from the deepest existing directory of the prefix.
    const start = prefix.endsWith('/') ? prefix.slice(0, -1) : posix.dirname(prefix);

    const walk = async (relative: string): Promise<void> => {
      const entries = await new Promise<
        Array<{ filename: string; attrs: { size: number; mtime: number; mode: number } }>
      >((resolve) => sftp.readdir(this.path(relative || '.'), (error, list) => resolve(error ? [] : list)));

      for (const entry of entries) {
        const key = relative ? `${relative}/${entry.filename}` : entry.filename;

        // Directories: S_IFDIR.
        if ((entry.attrs.mode & 0o170000) === 0o040000) await walk(key);
        else if (key.startsWith(prefix) && !key.endsWith('.part'))
          out.push({ key, size: entry.attrs.size, lastModified: new Date(entry.attrs.mtime * 1000) });
      }
    };

    await walk(start === '.' ? '' : start);

    return out;
  }

  async delete(keys: string[]): Promise<void> {
    const { sftp } = await this.open();

    for (const key of keys)
      await new Promise<void>((resolve, reject) =>
        sftp.unlink(this.path(key), (error) =>
          error && (error as { code?: number }).code !== 2 ? reject(error) : resolve(),
        ),
      );
  }

  async close(): Promise<void> {
    if (!this.connection) return;

    const { client } = await this.connection.catch(() => ({ client: null }));

    client?.end();
    this.connection = null;
  }
}
