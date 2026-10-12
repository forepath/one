import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { ProjectTicketEntity } from './project-ticket.entity';

@Entity('billing_project_ticket_attachments')
@Index('IDX_billing_project_ticket_attachments_ticket', ['ticketId'])
export class ProjectTicketAttachmentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'ticket_id' })
  ticketId!: string;

  @ManyToOne(() => ProjectTicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: ProjectTicketEntity;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName!: string;

  @Column({ type: 'varchar', length: 255, name: 'content_type' })
  contentType!: string;

  @Column({ type: 'bigint', name: 'byte_size' })
  byteSize!: string;

  @Column({ type: 'varchar', length: 512, name: 'storage_key' })
  storageKey!: string;

  @Column({ type: 'uuid', nullable: true, name: 'stored_file_id' })
  storedFileId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
