import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One app sign-in (created per authorization-code exchange). Holds the rotating refresh token (SHA-256 hash only).
 * Access JWTs reference the session id and die with it; deleting the grant deletes its sessions.
 */
@Entity('identity_app_sessions')
export class IdentityAppSessionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('IDX_identity_app_sessions_grant_id')
  @Column({ type: 'uuid', name: 'grant_id' })
  grantId!: string;

  @Column({ type: 'uuid', name: 'app_id' })
  appId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Index('UQ_identity_app_sessions_refresh_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'refresh_token_hash' })
  refreshTokenHash!: string;

  /** Hash of the refresh token rotated away last; presenting it again revokes the session (replay detection). */
  @Index('IDX_identity_app_sessions_previous_refresh_token_hash')
  @Column({ type: 'varchar', length: 64, name: 'previous_refresh_token_hash', nullable: true })
  previousRefreshTokenHash?: string | null;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'refreshed_at', nullable: true })
  refreshedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
