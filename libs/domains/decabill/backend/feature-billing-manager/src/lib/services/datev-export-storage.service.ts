import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

@Injectable()
export class DatevExportStorageService {
  getStorageRoot(): string {
    return process.env.BILLING_DATEV_EXPORT_STORAGE_PATH ?? path.join(process.cwd(), 'data', 'datev-exports');
  }

  resolveAbsolutePath(storageKey: string): string {
    const root = path.resolve(this.getStorageRoot());
    const absolute = path.resolve(root, storageKey);

    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      throw new Error('Invalid DATEV export path');
    }

    return absolute;
  }

  async writeFile(storageKey: string, content: Buffer): Promise<void> {
    const absolute = this.resolveAbsolutePath(storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, content);
  }

  async readFile(storageKey: string): Promise<Buffer> {
    const absolute = this.resolveAbsolutePath(storageKey);

    return await fs.promises.readFile(absolute);
  }

  async fileExists(storageKey: string): Promise<boolean> {
    try {
      const absolute = this.resolveAbsolutePath(storageKey);

      await fs.promises.access(absolute, fs.constants.F_OK);

      return true;
    } catch {
      return false;
    }
  }
}
