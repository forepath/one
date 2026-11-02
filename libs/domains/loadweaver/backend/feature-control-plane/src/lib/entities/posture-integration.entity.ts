import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A posture integration (3.31, cluster setting): an MDM / EDR the control plane polls for its device inventory.
 * The configuration (incl. credentials) is stored encrypted and never returned; results land with the clients.
 */
@Entity('lw_posture_integrations')
export class PostureIntegrationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Referenced by conditions (`mdm.<name>.compliant`). */
  @Column({ type: 'varchar', length: 32, name: 'name', unique: true })
  name!: string;

  /** Plugin id (`intune`, `crowdstrike`, …). */
  @Column({ type: 'varchar', length: 63, name: 'type' })
  type!: string;

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  /** JSON object of the plugin's configuration fields, AES-256-GCM encrypted at rest. */
  @Column({ type: 'text', name: 'config', transformer: createAes256GcmTransformer() })
  config!: string;

  /** Keys that match vendor records to enrolled devices, in order. */
  @Column({ type: 'text', array: true, name: 'match_by' })
  matchBy!: string[];

  /** The vendor's device user must match the VPN client's owner (only for plugins whose records carry a user). */
  @Column({ type: 'boolean', name: 'require_user_match', default: true })
  requireUserMatch!: boolean;

  @Column({ type: 'int', name: 'interval_minutes', default: 30 })
  intervalMinutes!: number;

  /** Results older than this count as unknown. */
  @Column({ type: 'int', name: 'max_age_minutes', default: 1440 })
  maxAgeMinutes!: number;

  @Column({ type: 'timestamptz', name: 'next_sync_at', nullable: true })
  nextSyncAt!: Date | null;

  /** Set while a sync runs (a second worker skips; stale claims expire). */
  @Column({ type: 'timestamptz', name: 'sync_started_at', nullable: true })
  syncStartedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_sync_at', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_success_at', nullable: true })
  lastSuccessAt!: Date | null;

  /** Sanitized: never contains credentials or request bodies. */
  @Column({ type: 'varchar', length: 300, name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'int', name: 'failures', default: 0 })
  failures!: number;

  @Column({ type: 'int', name: 'vendor_devices', default: 0 })
  vendorDevices!: number;

  @Column({ type: 'int', name: 'matched_devices', default: 0 })
  matchedDevices!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** Trust for device certificates (3.31): a company CA bundle with CRLs and / or the cluster's enrollment CA. */
@Entity('lw_posture_certificate_trust')
export class PostureCertificateTrustEntity {
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'company_ca_pem', nullable: true })
  companyCaPem!: string | null;

  @Column({ type: 'text', name: 'crl_pem', nullable: true })
  crlPem!: string | null;

  /** Certificates the cluster CA issued at enrollment (`POST /vpn/devices/{id}/certificate`). */
  @Column({ type: 'boolean', name: 'trust_cluster_ca', default: true })
  trustClusterCa!: boolean;

  /** Reports must prove possession of the certificate's key (signature over the device id and a timestamp). */
  @Column({ type: 'boolean', name: 'require_proof', default: true })
  requireProof!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
