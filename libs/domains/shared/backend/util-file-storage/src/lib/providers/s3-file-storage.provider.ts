import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { FILE_STORAGE_S3_PROVIDER } from '../file-storage.constants';
import { buildScopedObjectKey } from '../file-storage-object-key.util';
import type { FileStorageProvider } from '../file-storage-provider.interface';
import { applyS3KeyPrefix, readFileStorageS3Config, type FileStorageS3Config } from '../file-storage-s3.config';

/**
 * Builds an S3 client for any S3-compatible API (AWS, R2, Backblaze B2, Ceph, MinIO, …).
 */
export function createFileStorageS3Client(config: FileStorageS3Config): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  };

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  return new S3Client(clientConfig);
}

/**
 * Object-storage backend using the S3 API. Not AWS-specific: set `FILE_STORAGE_S3_ENDPOINT`
 * (and usually path-style) for R2, B2, Ceph RGW, MinIO, and similar providers.
 */
@Injectable()
export class S3FileStorageProvider implements FileStorageProvider {
  private client: S3Client | undefined;
  private config: FileStorageS3Config | undefined;

  /**
   * Test helper: Nest constructs with zero args (lazy env config).
   */
  static createForTests(client: S3Client, config: FileStorageS3Config): S3FileStorageProvider {
    const provider = new S3FileStorageProvider();

    provider.client = client;
    provider.config = config;

    return provider;
  }

  getType(): string {
    return FILE_STORAGE_S3_PROVIDER;
  }

  async writeFile(root: string, storageKey: string, content: Buffer): Promise<void> {
    const { client, config, key } = this.resolve(root, storageKey);

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: content,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async readFile(root: string, storageKey: string): Promise<Buffer> {
    const { client, config, key } = this.resolve(root, storageKey);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object body is empty for key '${key}'`);
    }

    const bytes = await response.Body.transformToByteArray();

    return Buffer.from(bytes);
  }

  async deleteFile(root: string, storageKey: string): Promise<void> {
    const { client, config, key } = this.resolve(root, storageKey);

    // S3 deletes are idempotent: a missing key is fine.
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  async fileExists(root: string, storageKey: string): Promise<boolean> {
    const { client, config, key } = this.resolve(root, storageKey);

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );

      return true;
    } catch (error: unknown) {
      if (isS3NotFoundError(error)) {
        return false;
      }

      throw error;
    }
  }

  private resolve(root: string, storageKey: string): { client: S3Client; config: FileStorageS3Config; key: string } {
    if (!this.config) {
      this.config = readFileStorageS3Config();
    }

    if (!this.client) {
      this.client = createFileStorageS3Client(this.config);
    }

    const key = applyS3KeyPrefix(buildScopedObjectKey(root, storageKey), this.config.keyPrefix);

    return { client: this.client, config: this.config, key };
  }
}

function isS3NotFoundError(error: unknown): boolean {
  if (error instanceof NotFound) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const named = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = named.name || named.Code;

  if (code === 'NotFound' || code === 'NoSuchKey' || code === '404') {
    return true;
  }

  return named.$metadata?.httpStatusCode === 404;
}
