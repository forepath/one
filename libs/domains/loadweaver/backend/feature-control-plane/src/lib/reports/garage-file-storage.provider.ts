import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  buildScopedObjectKey,
  FileStorageProviderFactory,
  type FileStorageProvider,
} from '@forepath/shared/backend/util-file-storage';
import { Injectable, OnModuleInit } from '@nestjs/common';

import { ObjectStoreControllerService } from '../services/object-store-controller.service';

export const GARAGE_FILE_STORAGE_PROVIDER = 'garage';

/**
 * The shared file storage on the cluster's own object store (3.25 reports: Garage by default, 3.20): the active
 * generation's files bucket with its own key, so the files move with the object store to new generations.
 * Selected with `FILE_STORAGE_PROVIDER=garage` (the members' default); `local` / `s3` stay available.
 */
@Injectable()
export class GarageFileStorageProvider implements FileStorageProvider, OnModuleInit {
  constructor(
    private readonly objectStore: ObjectStoreControllerService,
    private readonly factory: FileStorageProviderFactory,
  ) {}

  onModuleInit(): void {
    this.factory.registerProvider(this);
  }

  getType(): string {
    return GARAGE_FILE_STORAGE_PROVIDER;
  }

  private async client() {
    const files = await this.objectStore.filesClient();

    if (!files) throw new Error('the object store is not active yet');

    return files;
  }

  async writeFile(root: string, storageKey: string, content: Buffer): Promise<void> {
    const { client, bucket } = await this.client();

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: buildScopedObjectKey(root, storageKey),
          Body: content,
          ContentType: 'application/octet-stream',
        }),
      );
    } finally {
      client.destroy();
    }
  }

  async readFile(root: string, storageKey: string): Promise<Buffer> {
    const { client, bucket } = await this.client();

    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: buildScopedObjectKey(root, storageKey) }),
      );

      return Buffer.from((await response.Body?.transformToByteArray()) ?? []);
    } finally {
      client.destroy();
    }
  }

  async deleteFile(root: string, storageKey: string): Promise<void> {
    const { client, bucket } = await this.client();

    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: buildScopedObjectKey(root, storageKey) }));
    } finally {
      client.destroy();
    }
  }

  async fileExists(root: string, storageKey: string): Promise<boolean> {
    const { client, bucket } = await this.client();

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: buildScopedObjectKey(root, storageKey) }));

      return true;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return false;

      throw error;
    } finally {
      client.destroy();
    }
  }
}
