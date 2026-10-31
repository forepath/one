import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

import { FILE_STORAGE_INVALID_PATH_ERROR, FILE_STORAGE_LOCAL_PROVIDER } from '../file-storage.constants';
import type { FileStorageProvider } from '../file-storage-provider.interface';

/**
 * Local filesystem storage. Requires a shared volume across api/worker/scheduler.
 * Future providers (S3, encrypted DB blobs) can avoid that constraint.
 */
@Injectable()
export class LocalFileStorageProvider implements FileStorageProvider {
  getType(): string {
    return FILE_STORAGE_LOCAL_PROVIDER;
  }

  resolveAbsolutePath(root: string, storageKey: string): string {
    const resolvedRoot = path.resolve(root);
    const absolute = path.resolve(resolvedRoot, storageKey);

    if (!absolute.startsWith(resolvedRoot + path.sep) && absolute !== resolvedRoot) {
      throw new Error(FILE_STORAGE_INVALID_PATH_ERROR);
    }

    return absolute;
  }

  async writeFile(root: string, storageKey: string, content: Buffer): Promise<void> {
    const absolute = this.resolveAbsolutePath(root, storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, content);
  }

  async readFile(root: string, storageKey: string): Promise<Buffer> {
    const absolute = this.resolveAbsolutePath(root, storageKey);

    return await fs.promises.readFile(absolute);
  }

  async fileExists(root: string, storageKey: string): Promise<boolean> {
    try {
      const absolute = this.resolveAbsolutePath(root, storageKey);

      await fs.promises.access(absolute, fs.constants.F_OK);

      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(root: string, storageKey: string): Promise<void> {
    await fs.promises.rm(this.resolveAbsolutePath(root, storageKey), { force: true });
  }
}
