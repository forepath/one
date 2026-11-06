import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Kinds of single-use state kept for external (SAML) sign-in. */
export type ExternalAuthStateKind = 'saml_request' | 'saml_relay' | 'saml_assertion' | 'saml_code';

/**
 * Short-lived, single-use state for external sign-in flows. Only SHA-256 hashes of keys are stored.
 * Rows are consumed atomically (`DELETE … RETURNING`) so concurrent replays are rejected.
 */
@Entity('identity_external_auth_states')
@Index('UQ_identity_external_auth_states_kind_key_hash', ['kind', 'keyHash'], { unique: true })
export class ExternalAuthStateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: ExternalAuthStateKind;

  @Column({ type: 'varchar', length: 64, name: 'key_hash' })
  keyHash!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId?: string | null;

  @Column({ type: 'varchar', length: 256, name: 'request_id', nullable: true })
  requestId?: string | null;

  /** PKCE S256 challenge binding the flow to the browser that started it. */
  @Column({ type: 'varchar', length: 128, name: 'code_challenge', nullable: true })
  codeChallenge?: string | null;

  /** Same-origin path the console returns to after sign-in. */
  @Column({ type: 'varchar', length: 2048, name: 'redirect_path', nullable: true })
  redirectPath?: string | null;

  @Column({ type: 'varchar', length: 256, name: 'value', nullable: true })
  value?: string | null;

  @Index('IDX_identity_external_auth_states_expires_at')
  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
