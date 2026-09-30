import { ClientEntity } from '@forepath/identity/backend';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Per-workspace (client) OpenCode config overlay.
 */
@Entity('client_opencode_config')
export class ClientOpencodeConfigEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id', unique: true })
  clientId!: string;

  @OneToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ type: 'jsonb', nullable: true, name: 'config' })
  config?: Record<string, unknown> | null;

  /** Raw JSON overrides merged over `config` for this workspace layer. */
  @Column({ type: 'jsonb', nullable: true, name: 'overrides' })
  overrides?: Record<string, unknown> | null;

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
