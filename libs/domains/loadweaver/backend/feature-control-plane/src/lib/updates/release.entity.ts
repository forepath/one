import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * `announced`: known from the release feed (shared updates feature), bundle not downloaded yet; `importing`: the
 * bundle is being verified and imported; `available`: verified and imported (images in the cluster registry, files in
 * the object store) — update plans can target it; `failed`: download / verification / import failed (`error`);
 * `installed`: the baseline a cluster was set up with (no bundle imported, manifest from the running version).
 */
export type ReleaseStatus = 'announced' | 'importing' | 'available' | 'failed' | 'installed';
export type ReleaseSource = 'github' | 'mirror' | 'upload' | 'installed';

/** Where a release's imported artifacts are. */
export interface ReleaseImport {
  /** Image components pushed to the cluster registry (`lw-system/<component>@<digest>`). */
  clusterImages: string[];
  /** Artifact SHA-256s stored in the object store. */
  artifacts: string[];
  /** Apt snapshot shipped with the bundle (air-gapped), if any. */
  aptSnapshot?: string;
}

/** Releases known to the cluster (3.26): one row per version. */
@Entity('lw_releases')
@Index('IDX_lw_releases_status', ['status'])
export class ReleaseEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'version', unique: true })
  version!: string;

  @Column({ type: 'varchar', length: 8, name: 'channel' })
  channel!: 'stable' | 'beta';

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: ReleaseStatus;

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: ReleaseSource;

  /** The signed bytes (canonical JSON) — sent to agents as they are. */
  @Column({ type: 'text', name: 'manifest_text', nullable: true })
  manifestText!: string | null;

  @Column({ type: 'jsonb', name: 'manifest', nullable: true })
  manifest!: Record<string, unknown> | null;

  /** The signature document; null for unsigned development bundles. */
  @Column({ type: 'jsonb', name: 'signature', nullable: true })
  signature!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, name: 'key_id', nullable: true })
  keyId!: string | null;

  @Column({ type: 'jsonb', name: 'imported', nullable: true })
  imported!: ReleaseImport | null;

  /** Release notes / changelog of the announcement (GitHub). */
  @Column({ type: 'jsonb', name: 'announcement', nullable: true })
  announcement!: { name?: string; htmlUrl?: string; publishedAt?: string; changelog?: string[] } | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  /** Who downloaded / uploaded the bundle. */
  @Column({ type: 'varchar', length: 255, name: 'imported_by', nullable: true })
  importedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'imported_at', nullable: true })
  importedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
