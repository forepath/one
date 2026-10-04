import * as fs from 'fs';
import * as path from 'path';

import { Injectable, Logger } from '@nestjs/common';

import {
  isLegacyMigrationEnabled,
  readActiveFileStorageProviderType,
  resolvePreviousSegmentRoot,
} from './file-storage-path.config';
import { FILE_STORAGE_LOCAL_PROVIDER } from './file-storage.constants';
import { FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS } from './file-storage-scope.constants';

interface ScopeMigrationSummary {
  segment: string;
  copied: number;
  skipped: number;
  errors: number;
}

interface LegacySource {
  segment: string;
  resolveSource: (env: NodeJS.ProcessEnv) => string;
}

/**
 * Copies files from deprecated per-scope env roots into the previous flat
 * segments under `{FILE_STORAGE_ROOT}/` (`invoices`, `supplier-invoices`, `datev-exports`).
 * Layout migrator then moves those into customer/supplier/export.
 * Enabled by default; disable with `FILE_STORAGE_LEGACY_MIGRATION_ENABLED=false`.
 * Never deletes legacy sources. Local provider only.
 */
@Injectable()
export class FileStorageLegacyMigrationService {
  private readonly logger = new Logger(FileStorageLegacyMigrationService.name);

  async migrateAllScopes(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!isLegacyMigrationEnabled(env)) {
      this.logger.log('Legacy file storage migration disabled; skipping');

      return;
    }

    if (readActiveFileStorageProviderType(env) !== FILE_STORAGE_LOCAL_PROVIDER) {
      this.logger.log('Active file storage provider is not local; skipping legacy migration');

      return;
    }

    for (const source of this.sources()) {
      await this.migrateSegment(source, env);
    }
  }

  private sources(): LegacySource[] {
    return [
      {
        segment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.invoices,
        resolveSource: (e) =>
          e.BILLING_INVOICE_PDF_STORAGE_PATH?.trim() || path.join(process.cwd(), 'data', 'invoices'),
      },
      {
        segment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.supplierInvoices,
        resolveSource: (e) =>
          e.BILLING_SUPPLIER_INVOICE_STORAGE_PATH?.trim() || path.join(process.cwd(), 'data', 'supplier-invoices'),
      },
      {
        segment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.datevExports,
        resolveSource: (e) =>
          e.BILLING_DATEV_EXPORT_STORAGE_PATH?.trim() || path.join(process.cwd(), 'data', 'datev-exports'),
      },
    ];
  }

  private async migrateSegment(source: LegacySource, env: NodeJS.ProcessEnv): Promise<void> {
    const legacyRoot = path.resolve(source.resolveSource(env));
    const previousRoot = path.resolve(resolvePreviousSegmentRoot(source.segment, env));
    const summary: ScopeMigrationSummary = {
      segment: source.segment,
      copied: 0,
      skipped: 0,
      errors: 0,
    };

    if (legacyRoot === previousRoot) {
      this.logger.log(`Legacy migration skip for ${source.segment}: legacy and previous roots match (${previousRoot})`);

      return;
    }

    if (!(await this.isNonEmptyDirectory(legacyRoot))) {
      this.logger.log(`Legacy migration skip for ${source.segment}: source missing or empty (${legacyRoot})`);

      return;
    }

    this.logger.log(`Migrating file storage segment ${source.segment}: ${legacyRoot} -> ${previousRoot}`);

    await fs.promises.mkdir(previousRoot, { recursive: true });
    await this.copyDirectoryRecursive(legacyRoot, previousRoot, legacyRoot, summary);

    this.logger.log(
      `Legacy migration for ${source.segment}: copied=${summary.copied} skipped=${summary.skipped} errors=${summary.errors}`,
    );
  }

  private async isNonEmptyDirectory(dirPath: string): Promise<boolean> {
    try {
      const entries = await fs.promises.readdir(dirPath);

      return entries.length > 0;
    } catch {
      return false;
    }
  }

  private async copyDirectoryRecursive(
    sourceDir: string,
    destDir: string,
    legacyRoot: string,
    summary: ScopeMigrationSummary,
  ): Promise<void> {
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        await this.copyDirectoryRecursive(sourcePath, destPath, legacyRoot, summary);
        continue;
      }

      if (!entry.isFile()) {
        summary.skipped += 1;
        continue;
      }

      try {
        await this.copyFileIdempotent(sourcePath, destPath, legacyRoot, summary);
      } catch (error) {
        summary.errors += 1;
        this.logger.warn(
          `Legacy migration failed for ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async copyFileIdempotent(
    sourcePath: string,
    destPath: string,
    legacyRoot: string,
    summary: ScopeMigrationSummary,
  ): Promise<void> {
    const relative = path.relative(legacyRoot, sourcePath);
    const sourceStat = await fs.promises.stat(sourcePath);

    try {
      const destStat = await fs.promises.stat(destPath);

      if (destStat.size === sourceStat.size) {
        summary.skipped += 1;

        return;
      }

      this.logger.warn(
        `Legacy migration skip (size mismatch, keeping destination): ${relative} ` +
          `(source=${sourceStat.size} dest=${destStat.size})`,
      );
      summary.skipped += 1;

      return;
    } catch {
      // Destination missing — copy below.
    }

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, destPath);
    summary.copied += 1;
  }
}
