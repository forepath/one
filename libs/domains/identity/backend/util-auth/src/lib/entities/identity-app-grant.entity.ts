import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A user's consent for an app (one per app and user, no expiry).
 * `scopes` is what the user consented to: the app's scopes at consent time, capped to what the user could grant.
 * Revoking deletes the row (cascading sessions and codes), which forces the full consent flow again.
 */
@Entity('identity_app_grants')
@Index('UQ_identity_app_grants_app_user', ['appId', 'userId'], { unique: true })
export class IdentityAppGrantEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'app_id' })
  appId!: string;

  @Index('IDX_identity_app_grants_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'jsonb', name: 'scopes', default: () => "'[]'::jsonb" })
  scopes!: string[];

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
