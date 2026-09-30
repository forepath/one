import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Singleton-style global OpenCode config overlay (admin-managed).
 * Non-secret settings live in `config`; string secrets are GCM-encrypted JSON.
 */
@Entity('global_opencode_config')
export class GlobalOpencodeConfigEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** OpenCode config patch (providers, model defaults, etc.) — no secrets. */
  @Column({ type: 'jsonb', nullable: true, name: 'config' })
  config?: Record<string, unknown> | null;

  /** Raw JSON overrides merged over `config` for this layer. */
  @Column({ type: 'jsonb', nullable: true, name: 'overrides' })
  overrides?: Record<string, unknown> | null;

  /**
   * Explicit JSON Pointer locks for lower layers (even when unset).
   * Not part of OpenCode wire config.
   */
  @Column({ type: 'jsonb', nullable: true, name: 'locks' })
  locks?: string[] | null;

  /** JSON object of secret string fields, AES-256-GCM encrypted at rest. */
  @Column({
    type: 'text',
    nullable: true,
    name: 'secrets',
    transformer: createAes256GcmTransformer(),
  })
  secrets?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
