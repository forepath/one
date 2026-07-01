import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { ProjectTicketEntity } from './project-ticket.entity';
import { ProjectTicketActorType } from './project.enums';

@Entity('billing_project_ticket_activities')
export class ProjectTicketActivityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'ticket_id' })
  ticketId!: string;

  @ManyToOne(() => ProjectTicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: ProjectTicketEntity;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt!: Date;

  @Column({
    type: 'enum',
    enum: ProjectTicketActorType,
    enumName: 'project_ticket_actor_type_enum',
    name: 'actor_type',
  })
  actorType!: ProjectTicketActorType;

  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: UserEntity | null;

  @Column({ type: 'varchar', length: 64, name: 'action_type' })
  actionType!: string;

  @Column({ type: 'jsonb', name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;
}
