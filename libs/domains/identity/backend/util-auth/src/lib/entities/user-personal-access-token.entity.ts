import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * User-bound personal access tokens for machine/API JWT exchange.
 * Plaintext is shown once at create; only prefix + bcrypt hash are stored.
 */
@Entity('user_personal_access_tokens')
export class UserPersonalAccessTokenEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('IDX_user_personal_access_tokens_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Index('UQ_user_personal_access_tokens_token_prefix', { unique: true })
  @Column({ type: 'varchar', length: 32, name: 'token_prefix' })
  tokenPrefix!: string;

  @Column({ type: 'varchar', length: 255, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'jsonb', name: 'scopes', default: () => "'[]'::jsonb" })
  scopes!: string[];

  @Column({ type: 'timestamp', name: 'expires_at', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
