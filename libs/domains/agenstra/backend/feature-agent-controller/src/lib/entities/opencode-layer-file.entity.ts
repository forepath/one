import { ClientEntity } from '@forepath/identity/backend';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OpencodeLayerFileEntryKind = 'file' | 'directory';

/**
 * Canonical file/directory entry for a global or workspace OpenCode layer path.
 * File bodies are AES-256-GCM encrypted at rest; emit uses the path as entered.
 */
@Entity('opencode_layer_files')
@Index(['scope', 'clientId', 'path'], { unique: true })
export class OpencodeLayerFileEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** `global` (client_id null) or `workspace` (client_id set). */
  @Column({ type: 'varchar', length: 16, name: 'scope' })
  scope!: 'global' | 'workspace';

  @Column({ type: 'uuid', name: 'client_id', nullable: true })
  clientId?: string | null;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity | null;

  /** Path as entered in config (sanitized; no managed prefix rewrite). */
  @Column({ type: 'varchar', length: 1024, name: 'path' })
  path!: string;

  @Column({ type: 'varchar', length: 16, name: 'entry_kind', default: 'file' })
  entryKind!: OpencodeLayerFileEntryKind;

  /** UTF-8 text content (encrypted at rest). Null for directory markers. */
  @Column({
    type: 'text',
    name: 'content',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  content?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'content_sha' })
  contentSha!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
