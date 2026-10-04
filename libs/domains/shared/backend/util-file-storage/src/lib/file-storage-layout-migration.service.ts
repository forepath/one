import * as fs from 'fs';
import * as path from 'path';

import { CopyObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';

import {
  isLayoutMigrationEnabled,
  readActiveFileStorageProviderType,
  readFileStorageRoot,
  resolveCanonicalScopeRoot,
  resolvePreviousSegmentRoot,
} from './file-storage-path.config';
import { applyS3KeyPrefix, readFileStorageS3Config } from './file-storage-s3.config';
import { FILE_STORAGE_LOCAL_PROVIDER, FILE_STORAGE_S3_PROVIDER } from './file-storage.constants';
import { FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS, FileStorageScope } from './file-storage-scope.constants';
import { createFileStorageS3Client } from './providers/s3-file-storage.provider';

interface LayoutMigrationSummary {
  copied: number;
  skipped: number;
  errors: number;
}

interface LayoutMove {
  previousSegment: string;
  /** Relative key under previous segment; if null, walk all files with classifier. */
  classify: (
    relativeKey: string,
  ) => { scope: (typeof FileStorageScope)[keyof typeof FileStorageScope]; key: string } | null;
}

/**
 * Copies objects from previous flat segments into customer/supplier/export layout.
 * Default on (`FILE_STORAGE_LAYOUT_MIGRATION_ENABLED` !== false). Supports local + S3.
 * Never deletes source objects.
 */
@Injectable()
export class FileStorageLayoutMigrationService {
  private readonly logger = new Logger(FileStorageLayoutMigrationService.name);

  async migrateLayout(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!isLayoutMigrationEnabled(env)) {
      this.logger.log('File storage layout migration disabled; skipping');

      return;
    }

    const providerType = readActiveFileStorageProviderType(env);

    if (providerType === FILE_STORAGE_LOCAL_PROVIDER) {
      await this.migrateLocal(env);

      return;
    }

    if (providerType === FILE_STORAGE_S3_PROVIDER) {
      await this.migrateS3(env);

      return;
    }

    this.logger.log(`Layout migration skip: unsupported provider ${providerType}`);
  }

  private moves(): LayoutMove[] {
    return [
      {
        previousSegment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.invoices,
        classify: (relativeKey) => {
          const normalized = relativeKey.replace(/\\/g, '/');

          if (normalized.startsWith('offers/')) {
            return {
              scope: FileStorageScope.customerOffers,
              key: normalized.slice('offers/'.length),
            };
          }

          if (normalized.endsWith('-time-report.pdf')) {
            return { scope: FileStorageScope.customerTimesheets, key: normalized };
          }

          return { scope: FileStorageScope.customerInvoices, key: normalized };
        },
      },
      {
        previousSegment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.supplierInvoices,
        classify: (relativeKey) => ({
          scope: FileStorageScope.supplierInvoices,
          key: relativeKey.replace(/\\/g, '/'),
        }),
      },
      {
        previousSegment: FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.datevExports,
        classify: (relativeKey) => ({
          scope: FileStorageScope.datevExports,
          key: relativeKey.replace(/\\/g, '/'),
        }),
      },
    ];
  }

  private async migrateLocal(env: NodeJS.ProcessEnv): Promise<void> {
    const summary: LayoutMigrationSummary = { copied: 0, skipped: 0, errors: 0 };

    for (const move of this.moves()) {
      const sourceRoot = path.resolve(resolvePreviousSegmentRoot(move.previousSegment, env));

      if (!(await this.isNonEmptyDirectory(sourceRoot))) {
        this.logger.log(`Layout migration skip: empty or missing ${sourceRoot}`);
        continue;
      }

      this.logger.log(`Layout migration (local) from ${sourceRoot}`);
      await this.walkLocal(sourceRoot, sourceRoot, move, summary, env);
    }

    this.logger.log(
      `Layout migration (local) done: copied=${summary.copied} skipped=${summary.skipped} errors=${summary.errors}`,
    );
  }

  private async walkLocal(
    sourceDir: string,
    sourceRoot: string,
    move: LayoutMove,
    summary: LayoutMigrationSummary,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);

      if (entry.isDirectory()) {
        await this.walkLocal(sourcePath, sourceRoot, move, summary, env);
        continue;
      }

      if (!entry.isFile()) {
        summary.skipped += 1;
        continue;
      }

      const relativeKey = path.relative(sourceRoot, sourcePath).replace(/\\/g, '/');
      const target = move.classify(relativeKey);

      if (!target) {
        summary.skipped += 1;
        continue;
      }

      const destRoot = path.resolve(resolveCanonicalScopeRoot(target.scope, env));
      const destPath = path.join(destRoot, target.key);

      try {
        await this.copyLocalIdempotent(sourcePath, destPath, summary);
      } catch (error) {
        summary.errors += 1;
        this.logger.warn(
          `Layout migration failed for ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async copyLocalIdempotent(
    sourcePath: string,
    destPath: string,
    summary: LayoutMigrationSummary,
  ): Promise<void> {
    const sourceStat = await fs.promises.stat(sourcePath);

    try {
      const destStat = await fs.promises.stat(destPath);

      if (destStat.size === sourceStat.size) {
        summary.skipped += 1;

        return;
      }

      summary.skipped += 1;
      this.logger.warn(`Layout migration skip (size mismatch, keeping destination): ${destPath}`);

      return;
    } catch {
      // missing dest
    }

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, destPath);
    summary.copied += 1;
  }

  private async migrateS3(env: NodeJS.ProcessEnv): Promise<void> {
    const config = readFileStorageS3Config(env);
    const client = createFileStorageS3Client(config);
    const storageRoot = readFileStorageRoot(env);
    const summary: LayoutMigrationSummary = { copied: 0, skipped: 0, errors: 0 };

    for (const move of this.moves()) {
      const previousPrefix = applyS3KeyPrefix(move.previousSegment.replace(/\\/g, '/'), config.keyPrefix).replace(
        /\/?$/,
        '/',
      );

      this.logger.log(`Layout migration (S3) listing prefix ${previousPrefix}`);
      let continuationToken: string | undefined;

      do {
        const listed = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: previousPrefix,
            ContinuationToken: continuationToken,
          }),
        );

        for (const object of listed.Contents ?? []) {
          if (!object.Key || object.Key.endsWith('/')) {
            continue;
          }

          const withoutGlobalPrefix = config.keyPrefix
            ? object.Key.replace(new RegExp(`^${escapeRegExp(config.keyPrefix.replace(/\/?$/, '/'))}`), '')
            : object.Key;
          const relativeKey = withoutGlobalPrefix.startsWith(`${move.previousSegment}/`)
            ? withoutGlobalPrefix.slice(move.previousSegment.length + 1)
            : withoutGlobalPrefix;

          const target = move.classify(relativeKey);

          if (!target) {
            summary.skipped += 1;
            continue;
          }

          const destSegment = path
            .relative(path.resolve(storageRoot), path.resolve(resolveCanonicalScopeRoot(target.scope, env)))
            .replace(/\\/g, '/');
          const destKey = applyS3KeyPrefix(path.posix.join(destSegment, target.key), config.keyPrefix);

          try {
            await this.copyS3Idempotent(client, config.bucket, object.Key, destKey, summary);
          } catch (error) {
            summary.errors += 1;
            this.logger.warn(
              `S3 layout migration failed for ${object.Key}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    this.logger.log(
      `Layout migration (S3) done: copied=${summary.copied} skipped=${summary.skipped} errors=${summary.errors}`,
    );
  }

  private async copyS3Idempotent(
    client: S3Client,
    bucket: string,
    sourceKey: string,
    destKey: string,
    summary: LayoutMigrationSummary,
  ): Promise<void> {
    if (sourceKey === destKey) {
      summary.skipped += 1;

      return;
    }

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
        Key: destKey,
      }),
    );
    summary.copied += 1;
  }

  private async isNonEmptyDirectory(dirPath: string): Promise<boolean> {
    try {
      const entries = await fs.promises.readdir(dirPath);

      return entries.length > 0;
    } catch {
      return false;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
