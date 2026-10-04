import { Global, Module } from '@nestjs/common';

import { FileStorageLayoutMigrationService } from './file-storage-layout-migration.service';
import { FileStorageLegacyMigrationService } from './file-storage-legacy-migration.service';
import { FileStorageProviderFactory } from './file-storage-provider.factory';
import { FileStorageService } from './file-storage.service';
import {
  FILE_STORAGE_LAYOUT_MIGRATION_INIT,
  FILE_STORAGE_LEGACY_MIGRATION_INIT,
  FILE_STORAGE_PROVIDER_INIT,
} from './file-storage.tokens';
import { LocalFileStorageProvider } from './providers/local-file-storage.provider';
import { S3FileStorageProvider } from './providers/s3-file-storage.provider';

/**
 * Shared file storage. Registers local and S3-compatible providers.
 * Select with `FILE_STORAGE_PROVIDER` (`local` | `s3`). Dynamic plugin loading is not wired yet.
 */
@Global()
@Module({
  providers: [
    FileStorageProviderFactory,
    LocalFileStorageProvider,
    S3FileStorageProvider,
    FileStorageService,
    FileStorageLegacyMigrationService,
    FileStorageLayoutMigrationService,
    {
      provide: FILE_STORAGE_PROVIDER_INIT,
      useFactory: (factory: FileStorageProviderFactory, local: LocalFileStorageProvider, s3: S3FileStorageProvider) => {
        factory.registerProvider(local);
        factory.registerProvider(s3);

        return true;
      },
      inject: [FileStorageProviderFactory, LocalFileStorageProvider, S3FileStorageProvider],
    },
    {
      provide: FILE_STORAGE_LEGACY_MIGRATION_INIT,
      useFactory: async (_providerInit: boolean, migration: FileStorageLegacyMigrationService) => {
        await migration.migrateAllScopes();

        return true;
      },
      inject: [FILE_STORAGE_PROVIDER_INIT, FileStorageLegacyMigrationService],
    },
    {
      provide: FILE_STORAGE_LAYOUT_MIGRATION_INIT,
      useFactory: async (_legacyInit: boolean, migration: FileStorageLayoutMigrationService) => {
        await migration.migrateLayout();

        return true;
      },
      inject: [FILE_STORAGE_LEGACY_MIGRATION_INIT, FileStorageLayoutMigrationService],
    },
  ],
  exports: [
    FileStorageService,
    FileStorageProviderFactory,
    FileStorageLegacyMigrationService,
    FileStorageLayoutMigrationService,
  ],
})
export class FileStorageModule {}
