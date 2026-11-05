import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Short-lived, single-use authorization code handed to the app via its return URL.
 * Only the SHA-256 hash is stored. A replayed code revokes the session it created.
 */
@Entity('identity_app_authorization_codes')
export class IdentityAppAuthorizationCodeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('UQ_identity_app_authorization_codes_code_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'code_hash' })
  codeHash!: string;

  @Index('IDX_identity_app_authorization_codes_grant_id')
  @Column({ type: 'uuid', name: 'grant_id' })
  grantId!: string;

  @Column({ type: 'uuid', name: 'app_id' })
  appId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** Optional PKCE (S256) challenge. */
  @Column({ type: 'varchar', length: 128, name: 'code_challenge', nullable: true })
  codeChallenge?: string | null;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', name: 'consumed_at', nullable: true })
  consumedAt?: Date | null;

  /** Session created by exchanging this code (revoked when the code is replayed). */
  @Column({ type: 'uuid', name: 'session_id', nullable: true })
  sessionId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
