import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { FleetClusterState, FleetHealthState } from '../constants/fleet.constants';

/** Result of the last health poll (3.24): what the fleet knows without asking the cluster again. */
export interface FleetClusterHealth {
  state: FleetHealthState;
  checkedAt: string | null;
  latencyMs: number | null;
  /** `X-Loadweaver-Version` of the control plane. */
  version: string | null;
  clusterId: string | null;
  error: string | null;
}

/**
 * One connection per Loadweaver cluster (3.24): the cluster's API endpoint and a cluster-issued service credential
 * (a PAT of a dedicated service user), encrypted at rest. The cluster itself keeps no dependency on the fleet.
 */
@Entity('lw_fleet_clusters')
export class FleetClusterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('UQ_lw_fleet_clusters_name', { unique: true })
  @Column({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description!: string | null;

  /** HTTPS origin (plus optional base path) of the control plane API, without `/api`. */
  @Column({ type: 'varchar', length: 512, name: 'endpoint' })
  endpoint!: string;

  /** PEM CA bundle for clusters with a private CA (empty = public trust store). */
  @Column({ type: 'text', name: 'ca_certificate', nullable: true })
  caCertificate!: string | null;

  /** The service user's PAT (AES-256-GCM with `ENCRYPTION_KEY`); never returned by the API. */
  @Column({ type: 'varchar', length: 4096, name: 'credential', transformer: createAes256GcmTransformer() })
  credential!: string;

  /** Last four characters of the credential, to recognise it in the UI. */
  @Column({ type: 'varchar', length: 8, name: 'credential_hint' })
  credentialHint!: string;

  /** External reference, e.g. `decabill:<subscription>:<item>` for Loadweaver Cloud clusters. */
  @Index('UQ_lw_fleet_clusters_reference', { unique: true, where: 'reference IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, name: 'reference', nullable: true })
  reference!: string | null;

  /** `active`; `teardown` (Loadweaver Cloud grace: read-only access until `readOnlyUntil`); `retired`. */
  @Column({ type: 'varchar', length: 16, name: 'state', default: 'active' })
  state!: FleetClusterState;

  /** Grants are capped at viewer until then (read-only grace access, section 4). */
  @Column({ type: 'timestamptz', name: 'read_only_until', nullable: true })
  readOnlyUntil!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'read_only_reason', nullable: true })
  readOnlyReason!: string | null;

  @Column({ type: 'jsonb', name: 'health', default: () => `'{"state":"unknown"}'` })
  health!: FleetClusterHealth;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
