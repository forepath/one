import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export interface MasterKeyHolder {
  /** Node name, or `@control-plane` for the built-in control-plane member (3.39). */
  node: string;
  /** The node's Shamir share, sealed to its X25519 seal key (base64). */
  encryptedShare: string;
  /** `builtin` for the built-in control-plane member; absent (= `node`) for real members. */
  kind?: 'node' | 'builtin';
  /** Built-in holder only: the public seal key the share was sealed to (detects a replaced key). */
  publicKey?: string;
}

/**
 * Standby copy of the whole master key for the built-in control-plane member (3.39), sealed to its public seal key.
 * Kept in sync on every seal / re-share; opened only when no real control-plane member with a seal key is registered.
 */
export interface MasterKeyStandby {
  holder: string;
  publicKey: string;
  sealedKey: string;
}

/** The master key wrapped by an external KMS / Vault instead of shares (3.22). */
export interface MasterKeyKms {
  provider: string;
  keyRef: string;
  wrapped: string;
}

/**
 * Cluster master key (3.22), split across the control-plane members or wrapped by an external KMS. Only encrypted
 * shares / the wrapped key are stored; the key itself exists in memory of unsealed replicas only.
 */
@Entity('lw_master_keys')
export class MasterKeyEntity {
  /** Share set id (first bytes of SHA-256 over the key). */
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'id' })
  id!: string;

  @Column({ type: 'integer', name: 'threshold' })
  threshold!: number;

  @Column({ type: 'jsonb', name: 'holders' })
  holders!: MasterKeyHolder[];

  /** Set when an external KMS holds the key; then there are no holders. */
  @Column({ type: 'jsonb', name: 'kms', nullable: true })
  kms!: MasterKeyKms | null;

  /** Standby copy for the built-in control-plane member (3.39); null when it has none. */
  @Column({ type: 'jsonb', name: 'builtin_standby', nullable: true })
  builtinStandby!: MasterKeyStandby | null;

  @Column({ type: 'boolean', name: 'active', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'retired_at', nullable: true })
  retiredAt!: Date | null;
}
