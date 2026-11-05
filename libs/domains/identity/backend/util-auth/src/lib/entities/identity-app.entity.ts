import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Admin-managed third-party application ("app") that users can authorize via the grant flow.
 * The row id is the public app id; the app secret is shown once (create/rotate) and only its bcrypt hash is stored.
 * Scopes are drawn from the product PAT scope catalog.
 */
@Entity('identity_apps')
export class IdentityAppEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('IDX_identity_apps_tenant_id')
  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 2000, name: 'description', nullable: true })
  description?: string | null;

  /** Only redirect target after the grant page (exact match; no caller-supplied redirect URIs). */
  @Column({ type: 'varchar', length: 2048, name: 'return_url' })
  returnUrl!: string;

  @Column({ type: 'jsonb', name: 'scopes', default: () => "'[]'::jsonb" })
  scopes!: string[];

  /** Leading characters of the secret for identification in the UI (never enough to authenticate). */
  @Column({ type: 'varchar', length: 32, name: 'secret_prefix' })
  secretPrefix!: string;

  @Column({ type: 'varchar', length: 255, name: 'secret_hash' })
  secretHash!: string;

  @Column({ type: 'timestamp', name: 'secret_rotated_at', nullable: true })
  secretRotatedAt?: Date | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
