import { createHash } from 'crypto';

import { ClientEntity, UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AgenstraAttachmentOwnerType } from './attachment.enums';

@Entity('agenstra_attachments')
@Index('IDX_agenstra_attachments_owner', ['ownerType', 'ownerId'])
@Index('IDX_agenstra_attachments_client', ['clientId'])
export class AgenstraAttachmentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({ type: 'varchar', length: 32, name: 'owner_type' })
  ownerType!: AgenstraAttachmentOwnerType;

  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName!: string;

  @Column({ type: 'varchar', length: 255, name: 'content_type' })
  contentType!: string;

  @Column({ type: 'bigint', name: 'byte_size' })
  byteSize!: string;

  @Column({ type: 'varchar', length: 512, name: 'storage_key' })
  storageKey!: string;

  @Column({ type: 'varchar', length: 64, name: 'content_sha256' })
  contentSha256!: string;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  static contentSha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
