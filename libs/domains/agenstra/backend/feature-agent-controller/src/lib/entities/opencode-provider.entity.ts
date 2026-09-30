import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cached models.dev OpenCode LLM provider catalog entry.
 * Refreshed by BullMQ job `opencode-providers.refresh`.
 */
@Entity('opencode_providers')
export class OpencodeProviderEntity {
  /** Provider id used in OpenCode config (`providers.<id>`). */
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 256, name: 'name' })
  name!: string;

  /** Credential environment variable names from models.dev. */
  @Column({ type: 'jsonb', name: 'env', default: () => "'[]'::jsonb" })
  env!: string[];

  /** Model id/name pairs from models.dev for this provider. */
  @Column({ type: 'jsonb', name: 'models', default: () => "'[]'::jsonb" })
  models!: Array<{ id: string; name: string }>;

  @Column({ type: 'varchar', length: 256, nullable: true, name: 'npm' })
  npm?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'api' })
  api?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
