import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Tracks individually revoked JWT session ids (`jti`) for users-mode auth.
 * Rows can be purged after `expires_at` when the JWT would no longer be valid anyway.
 */
@Entity('revoked_user_tokens')
export class RevokedUserTokenEntity {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'jti' })
  jti!: string;

  @Index('IDX_revoked_user_tokens_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'revoked_at' })
  revokedAt!: Date;
}
