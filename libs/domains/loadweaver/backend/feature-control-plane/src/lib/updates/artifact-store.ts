import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand } from '@aws-sdk/client-s3';
import { readActiveFileStorageProviderType, readFileStorageRoot } from '@forepath/shared/backend/util-file-storage';
import { Injectable } from '@nestjs/common';

import { GARAGE_FILE_STORAGE_PROVIDER } from '../reports/garage-file-storage.provider';
import { ObjectStoreControllerService } from '../services/object-store-controller.service';

const SHA256 = /^[0-9a-f]{64}$/;
const PREFIX = 'loadweaver/updates/sha256';

/**
 * Release artifacts by SHA-256 (3.26): bundle files (agent binaries, gVisor tarballs, DRBD sources, OCI archives) and
 * apt snapshot files, streamed — never buffered whole. On members they live in the cluster's object store (the files
 * bucket of the active Garage generation, `FILE_STORAGE_PROVIDER=garage`); otherwise below `FILE_STORAGE_ROOT`
 * (development, tests). Content is only committed after its checksum matched.
 */
@Injectable()
export class ArtifactStore {
  constructor(private readonly objectStore: ObjectStoreControllerService) {}

  private garage(): boolean {
    return readActiveFileStorageProviderType() === GARAGE_FILE_STORAGE_PROVIDER;
  }

  private localPath(sha256: string): string {
    return join(readFileStorageRoot(), PREFIX, sha256.slice(0, 2), sha256);
  }

  private async s3() {
    const files = await this.objectStore.filesClient();

    if (!files) throw new Error('the object store is not active yet');

    return files;
  }

  async has(sha256: string): Promise<boolean> {
    if (!SHA256.test(sha256)) return false;

    if (!this.garage()) return !!(await stat(this.localPath(sha256)).catch(() => null));

    const { client, bucket } = await this.s3();

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${PREFIX}/${sha256}` }));

      return true;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return false;

      throw error;
    } finally {
      client.destroy();
    }
  }

  /**
   * Stores `size` bytes under their SHA-256. The body is hashed while it streams; a mismatch (or a body that throws,
   * e.g. a bundle entry failing its own check) leaves nothing behind.
   */
  async put(sha256: string, size: number, body: AsyncIterable<Buffer> | Iterable<Buffer>): Promise<void> {
    if (!SHA256.test(sha256)) throw new Error('invalid SHA-256');

    const hash = createHash('sha256');
    let length = 0;

    async function* checked(): AsyncGenerator<Buffer> {
      for await (const chunk of body) {
        length += chunk.length;

        if (length > size) throw new Error('artifact larger than announced');

        hash.update(chunk);
        yield chunk;
      }

      if (length !== size || hash.digest('hex') !== sha256) throw new Error('artifact does not match its SHA-256');
    }

    if (!this.garage()) {
      const path = this.localPath(sha256);
      const temp = `${path}.${randomUUID()}.part`;

      await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });

      const file = await open(temp, 'w', 0o600);

      try {
        for await (const chunk of checked()) await file.write(chunk);

        await file.sync();
      } catch (error) {
        await file.close();
        await rm(temp, { force: true });
        throw error;
      }

      await file.close();
      await rename(temp, path);

      return;
    }

    const { client, bucket } = await this.s3();

    try {
      // An aborted S3 PUT stores nothing; the body's own check aborts it on a mismatch.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${PREFIX}/${sha256}`,
          Body: Readable.from(checked()),
          ContentLength: size,
          ContentType: 'application/octet-stream',
        }),
      );
    } finally {
      client.destroy();
    }
  }

  async putBuffer(data: Buffer): Promise<string> {
    const sha256 = createHash('sha256').update(data).digest('hex');

    if (!(await this.has(sha256))) await this.put(sha256, data.length, [data]);

    return sha256;
  }

  /** The artifact as a stream, or null when it isn't stored. */
  async get(sha256: string): Promise<{ size: number; stream: Readable } | null> {
    if (!SHA256.test(sha256)) return null;

    if (!this.garage()) {
      const path = this.localPath(sha256);
      const info = await stat(path).catch(() => null);

      return info ? { size: info.size, stream: createReadStream(path) } : null;
    }

    const { client, bucket } = await this.s3();

    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${PREFIX}/${sha256}` }));
      const stream = response.Body as Readable;

      stream.once('close', () => client.destroy());

      return { size: Number(response.ContentLength ?? 0), stream };
    } catch (error) {
      client.destroy();

      if ((error as { name?: string }).name === 'NoSuchKey' || error instanceof NotFound) return null;

      throw error;
    }
  }

  async getBuffer(sha256: string, maxBytes: number): Promise<Buffer | null> {
    const found = await this.get(sha256);

    if (!found) return null;

    if (found.size > maxBytes) {
      found.stream.destroy();
      throw new Error('artifact too large to buffer');
    }

    const chunks: Buffer[] = [];

    for await (const chunk of found.stream) chunks.push(Buffer.from(chunk as Buffer));

    return Buffer.concat(chunks);
  }
}
