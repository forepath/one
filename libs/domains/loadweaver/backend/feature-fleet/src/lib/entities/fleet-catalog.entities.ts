import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** `active` signs the index and new packages; `retired` keys stay listed in the index so older packages verify. */
export type FleetCatalogKeyState = 'active' | 'retired';

/**
 * The signing key of the fleet's app catalog (P1 app store): an ECDSA P-256 key (cosign `sign-blob` compatible),
 * created on the first start. Kept like the fleet's identity keys: the private key is sealed with `ENCRYPTION_KEY`
 * and never returned by the API. The key id is the app store's (`publicKeyId`: SHA-256 hex of the SPKI DER).
 */
@Entity('lw_fleet_catalog_keys')
export class FleetCatalogKeyEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'kid' })
  kid!: string;

  /** `ecdsa-p256` | `ed25519`. */
  @Column({ type: 'varchar', length: 16, name: 'type' })
  type!: string;

  /** SPKI PEM. */
  @Column({ type: 'text', name: 'public_key' })
  publicKey!: string;

  /** PKCS#8 PEM, AES-256-GCM sealed; never returned by the API or logged. */
  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKey!: string;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: FleetCatalogKeyState;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'retired_at', nullable: true })
  retiredAt!: Date | null;
}

/** `draft` (uploaded, not in the index), `published` (in the index), `unpublished` (removed from the index again). */
export const FLEET_CATALOG_PACKAGE_STATUSES = ['draft', 'published', 'unpublished'] as const;
export type FleetCatalogPackageStatus = (typeof FLEET_CATALOG_PACKAGE_STATUSES)[number];

/** A lint finding kept with the package (warnings / infos; errors block the upload). */
export interface FleetCatalogFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

/**
 * One uploaded package version (`lw app package` archive, ≤ 8 MiB) with its signature by the fleet's catalog key.
 * The archive lives in Postgres (`bytea`, within the app store's 8 MiB package cap); it is immutable: a version is
 * replaced only by deleting the draft / unpublished row and uploading again.
 */
@Entity('lw_fleet_catalog_packages')
@Index('UQ_lw_fleet_catalog_packages_app_version', ['app', 'version'], { unique: true })
export class FleetCatalogPackageEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'app' })
  app!: string;

  @Column({ type: 'varchar', length: 128, name: 'version' })
  version!: string;

  @Column({ type: 'varchar', length: 32, name: 'channel' })
  channel!: string;

  @Column({ type: 'varchar', length: 100, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 500, name: 'summary' })
  summary!: string;

  /** `publisher` of the manifest (informational; the index lists the fleet as the publisher). */
  @Column({ type: 'varchar', length: 100, name: 'manifest_publisher' })
  manifestPublisher!: string;

  @Column({ type: 'varchar', length: 200, name: 'license' })
  license!: string;

  /**
   * `minLoadweaver` of the manifest (emitted in the index); `''` when it has none, null for rows uploaded before the
   * column until the startup backfill read their archive.
   */
  @Column({ type: 'varchar', length: 128, name: 'min_loadweaver', nullable: true })
  minLoadweaver!: string | null;

  /** `sha256:<hex>` of the archive. */
  @Column({ type: 'varchar', length: 71, name: 'digest' })
  digest!: string;

  @Column({ type: 'integer', name: 'size' })
  size!: number;

  /** The package archive; not selected by default (lists never load it). */
  @Column({ type: 'bytea', name: 'archive', select: false })
  archive!: Buffer;

  /** cosign `sign-blob` signature (base64) over the archive by the catalog key `signedBy`. */
  @Column({ type: 'text', name: 'signature' })
  signature!: string;

  @Column({ type: 'varchar', length: 64, name: 'signed_by' })
  signedBy!: string;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: FleetCatalogPackageStatus;

  @Column({ type: 'jsonb', name: 'findings', default: () => "'[]'" })
  findings!: FleetCatalogFinding[];

  @Column({ type: 'varchar', length: 255, name: 'uploaded_by', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  /** First publication (the index's `published`); kept when a version is unpublished and published again. */
  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;
}

/** A takedown in the signed index: clusters hide the versions and flag installed copies. */
@Entity('lw_fleet_catalog_takedowns')
export class FleetCatalogTakedownEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'app' })
  app!: string;

  /** `all` or the affected versions. */
  @Column({ type: 'jsonb', name: 'versions' })
  versions!: 'all' | string[];

  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

/**
 * The current signed index (one row, id 1): regenerated on every catalog change, served as is, so every replica
 * serves the same bytes and signature.
 */
@Entity('lw_fleet_catalog_index')
export class FleetCatalogIndexEntity {
  @PrimaryColumn({ type: 'smallint', name: 'id' })
  id!: number;

  /** `index.yaml` bytes (UTF-8 YAML). */
  @Column({ type: 'text', name: 'content' })
  content!: string;

  @Column({ type: 'text', name: 'signature' })
  signature!: string;

  @Column({ type: 'varchar', length: 71, name: 'digest' })
  digest!: string;

  @Column({ type: 'varchar', length: 64, name: 'signed_by' })
  signedBy!: string;

  @Column({ type: 'timestamptz', name: 'generated_at' })
  generatedAt!: Date;
}
