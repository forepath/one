import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * The cluster this control plane manages (exactly one row). Holds the cluster CA used for node identities.
 */
@Entity('lw_cluster')
export class ClusterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** DNS-safe cluster id used in identity URIs (`spiffe://<clusterId>.loadweaver/...`). */
  @Column({ type: 'varchar', length: 63, name: 'cluster_id', unique: true })
  clusterId!: string;

  @Column({ type: 'varchar', length: 255, name: 'display_name' })
  displayName!: string;

  @Column({ type: 'text', name: 'ca_certificate' })
  caCertificate!: string;

  // Stored encrypted at rest (AES-256-GCM); moves to the envelope-encrypted secrets store in M2 (3.22).
  @Column({ type: 'text', name: 'ca_private_key', transformer: createAes256GcmTransformer() })
  caPrivateKey!: string;

  /**
   * Root of the built-in registry's token authentication (3.22), separate from the cluster CA: the registry trusts
   * only this certificate, so node identities (also issued by the cluster CA) can never sign registry tokens.
   */
  @Column({ type: 'text', name: 'registry_token_certificate', nullable: true })
  registryTokenCertificate!: string | null;

  @Column({
    type: 'text',
    name: 'registry_token_private_key',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  registryTokenPrivateKey!: string | null;

  /** Compiler bookkeeping kept stable across compilations (WireGuard ports, route reflectors). */
  @Column({ type: 'jsonb', name: 'network_state', default: () => "'{}'" })
  networkState!: { portAllocations?: Record<string, Record<string, number>>; routeReflectors?: string[] };

  /** Monotonic revision of the compiled per-node desired state. */
  @Column({ type: 'integer', name: 'desired_revision', default: 0 })
  desiredRevision!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
