import { ClientEntity, UserEntity } from '@forepath/identity/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TicketPriority, TicketStatus } from './ticket.enums';

@Entity('tickets')
export class TicketEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({ type: 'uuid', nullable: true, name: 'parent_id' })
  parentId?: string | null;

  @ManyToOne(() => TicketEntity, (t) => t.children, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: TicketEntity | null;

  @OneToMany(() => TicketEntity, (t) => t.parent)
  children!: TicketEntity[];

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /** Stable full ticket reference hash (sha1 of ticket id). */
  @Column({ type: 'varchar', length: 40, nullable: true, name: 'long_sha' })
  longSha?: string | null;

  @Column({
    type: 'enum',
    enum: TicketPriority,
    enumName: 'ticket_priority_enum',
    name: 'priority',
  })
  priority!: TicketPriority;

  @Column({
    type: 'enum',
    enum: TicketStatus,
    enumName: 'ticket_status_enum',
    name: 'status',
  })
  status!: TicketStatus;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity | null;

  /** Workspace agent the user last chose for chat/AI on this ticket (agent-manager agent UUID). */
  @Column({ type: 'uuid', nullable: true, name: 'preferred_chat_agent_id' })
  preferredChatAgentId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
