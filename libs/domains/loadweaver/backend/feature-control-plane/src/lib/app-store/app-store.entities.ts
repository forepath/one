import type { CatalogIndex } from '@forepath/loadweaver/shared/util-app-catalog';
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type AppCatalogStatus = 'ok' | 'error' | 'pending';

/**
 * The verified index of one configured catalog (P1 app store), cached per catalog name. `sourceHash` binds the cache
 * to the source it was verified for (type, URL, ref, keys): after a config change the old cache is never served.
 * A failed refresh keeps the last verified index (served) and records the error.
 */
@Entity('lw_app_catalogs')
export class AppCatalogEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 64, name: 'source_hash' })
  sourceHash!: string;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: AppCatalogStatus;

  /** The verified, parsed index (null until the first successful refresh). */
  @Column({ type: 'jsonb', name: 'index', nullable: true })
  index!: CatalogIndex | null;

  /** `sha256:<hex>` of the verified index bytes. */
  @Column({ type: 'varchar', length: 80, name: 'index_digest', nullable: true })
  indexDigest!: string | null;

  /** Id of the catalog key that signed the index. */
  @Column({ type: 'varchar', length: 64, name: 'key_id', nullable: true })
  keyId!: string | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  /** Git catalogs: the commit the `ref` resolved to at the last successful refresh (null for OCI / fleet). */
  @Column({ type: 'varchar', length: 64, name: 'resolved_commit', nullable: true })
  resolvedCommit!: string | null;

  @Column({ type: 'timestamptz', name: 'last_attempt_at', nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_success_at', nullable: true })
  lastSuccessAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

/**
 * A verified package archive (fetched on demand: app page, install / update plans). The digest is re-checked against
 * the current index whenever it is read.
 */
@Entity('lw_app_packages')
export class AppPackageEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'catalog' })
  catalog!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'app' })
  app!: string;

  @PrimaryColumn({ type: 'varchar', length: 64, name: 'version' })
  version!: string;

  @Column({ type: 'varchar', length: 80, name: 'digest' })
  digest!: string;

  @Column({ type: 'bytea', name: 'archive' })
  archive!: Buffer;

  /** Publisher key that signed the package. */
  @Column({ type: 'varchar', length: 64, name: 'key_id' })
  keyId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'fetched_at' })
  fetchedAt!: Date;
}

/** An installed app hit by a takedown in its catalog's index (inbox warning + deployment status flag). */
@Entity('lw_app_takedown_flags')
export class AppTakedownFlagEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'deployment' })
  deployment!: string;

  @Column({ type: 'varchar', length: 63, name: 'catalog' })
  catalog!: string;

  @Column({ type: 'varchar', length: 63, name: 'app' })
  app!: string;

  @Column({ type: 'varchar', length: 64, name: 'version' })
  version!: string;

  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  /** When the catalog took the app (version) down. */
  @Column({ type: 'timestamptz', name: 'taken_down_at' })
  takenDownAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'flagged_at' })
  flaggedAt!: Date;
}

export const APP_STORE_ENTITIES = [AppCatalogEntity, AppPackageEntity, AppTakedownFlagEntity];
