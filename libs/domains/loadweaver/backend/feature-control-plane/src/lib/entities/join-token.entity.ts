import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Short-lived, single-use join token (3.21). Only a SHA-256 hash of the secret is stored; the lookup prefix
 * allows constant-time comparison of exactly one candidate.
 */
@Entity('lw_join_tokens')
export class JoinTokenEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'token_prefix', unique: true })
  tokenPrefix!: string;

  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 255, name: 'description', nullable: true })
  description!: string | null;

  /** Site the joining node is placed in; the node may not choose another one. */
  @Column({ type: 'varchar', length: 63, name: 'site' })
  site!: string;

  @Column({ type: 'jsonb', name: 'labels', default: () => "'{}'" })
  labels!: Record<string, string>;

  /** Join as a witness (tie-breaker only, no workloads, 3.2). */
  @Column({ type: 'boolean', name: 'witness', default: false })
  witness!: boolean;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;

  @Column({ type: 'varchar', length: 63, name: 'used_by_node', nullable: true })
  usedByNode!: string | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
