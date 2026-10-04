export {
  FILE_STORAGE_DEFAULT_PROVIDER,
  FILE_STORAGE_INVALID_PATH_ERROR,
  FILE_STORAGE_LOCAL_PROVIDER,
  FILE_STORAGE_S3_PROVIDER,
} from './lib/file-storage.constants';
export {
  FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS,
  FILE_STORAGE_SCOPE_SEGMENTS,
  FILE_STORAGE_SCOPES,
  FileStorageScope,
} from './lib/file-storage-scope.constants';
export type { FileStorageScope as FileStorageScopeType } from './lib/file-storage-scope.constants';
export {
  isLayoutDualReadEnabled,
  isLayoutMigrationEnabled,
  isLegacyMigrationEnabled,
  readActiveFileStorageProviderType,
  readFileStorageRoot,
  resolveCanonicalScopeRoot,
  resolveLegacyScopeRoot,
  resolvePreviousSegmentRoot,
} from './lib/file-storage-path.config';
export { applyS3KeyPrefix, readFileStorageS3Config } from './lib/file-storage-s3.config';
export type { FileStorageS3Config } from './lib/file-storage-s3.config';
export { buildScopedObjectKey } from './lib/file-storage-object-key.util';
export type { FileStorageProvider } from './lib/file-storage-provider.interface';
export { FileStorageProviderFactory } from './lib/file-storage-provider.factory';
export { LocalFileStorageProvider } from './lib/providers/local-file-storage.provider';
export { createFileStorageS3Client, S3FileStorageProvider } from './lib/providers/s3-file-storage.provider';
export { FileStorageService } from './lib/file-storage.service';
export { FileStorageLegacyMigrationService } from './lib/file-storage-legacy-migration.service';
export { FileStorageLayoutMigrationService } from './lib/file-storage-layout-migration.service';
export {
  FILE_STORAGE_LAYOUT_MIGRATION_INIT,
  FILE_STORAGE_LEGACY_MIGRATION_INIT,
  FILE_STORAGE_PROVIDER_INIT,
} from './lib/file-storage.tokens';
export { FileStorageModule } from './lib/file-storage.module';
