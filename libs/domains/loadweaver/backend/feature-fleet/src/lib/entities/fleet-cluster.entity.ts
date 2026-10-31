import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { FleetClusterState, FleetHealthState } from '../constants/fleet.constants';
import type { FleetClusterDatabase } from '../utils/cluster-availability';

/** Result of the last health poll (3.24): what the fleet knows without asking the cluster again. */
export interface FleetClusterHealth {
  state: FleetHealthState;
  checkedAt: string | null;
  latencyMs: number | null;
  /** `X-Loadweaver-Version` of the control plane. */
  version: string | null;
  clusterId: string | null;
  error: string | null;
  /**
   * Approvals through the fleet (3.24): `verified` (the cluster trusts this fleet's identity key), `untrusted`
   * (supports claims, key not registered), `unsupported` (older cluster), `unknown` (not probed yet).
   */
  identity?: FleetIdentityState;
  identityReason?: string | null;
  /** Verified only (2026-10-29): since when the cluster trusts this fleet, and the key ids it holds for it. */
  identitySince?: string | null;
  identityKeys?: string[] | null;
  /**
   * When the cluster last answered the identity probe (2026-10-29): a trust attempt newer than this hasn't been
   * confirmed by the cluster yet (the probe after it failed), so the console shows it as pending, not as a contradiction.
   */
  identityCheckedAt?: string | null;
  /**
   * The cluster's own id as first seen through this connection (kept across polls; reset only when a fleet admin
   * re-enters the credential / endpoint). Trust is only ever registered with a cluster that still answers with it.
   */
  pinnedClusterId?: string | null;
  /** The last attempt to establish trust (automatic or by a fleet admin, 2026-10-29). */
  trust?: FleetTrustAttempt | null;
  /**
   * The cluster's database state from its `GET /api/cluster` (3.43, 2026-10-31): `readOnly` while its control plane
   * can't write. Null / missing: the cluster reports none (writable as far as the fleet knows) or didn't answer.
   */
  database?: FleetClusterDatabase | null;
}

export type FleetIdentityState = 'verified' | 'untrusted' | 'unsupported' | 'unknown';

/**
 * Outcome of establishing trust with a cluster (2026-10-29): `established` (registered now), `already-trusted`,
 * `forbidden` (the credential used may not manage trusted fleets, or the entry belongs to other keys),
 * `identity-mismatch` (the cluster answered with another cluster id than the pinned one), `unsupported` (older
 * cluster), `failed` (unreachable / unexpected answer), `revoked` (the cluster trusted this fleet and no longer does:
 * a cluster admin removed it — never re-registered automatically).
 */
export type FleetTrustOutcome =
  | 'established'
  | 'revoked'
  | 'already-trusted'
  | 'forbidden'
  | 'identity-mismatch'
  | 'unsupported'
  | 'failed';

export interface FleetTrustAttempt {
  state: FleetTrustOutcome;
  at: string;
  /** `service-credential` (the connection's PAT) or `one-time-token` (a cluster admin's token, used once, not kept). */
  via: 'service-credential' | 'one-time-token';
  /** Fleet user who triggered it; `null` = automatic (after a health check). */
  by: string | null;
  reason: string | null;
  /** The connection's credential hint at the time: a new credential retries automatically. */
  credentialHint: string | null;
  /** The fleet's key ids at the time: a new key (rotation) retries automatically. */
  keyIds?: string[];
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
