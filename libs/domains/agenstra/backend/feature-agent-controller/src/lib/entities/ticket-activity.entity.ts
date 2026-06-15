import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TicketEntity } from './ticket.entity';
import { TicketActorType } from './ticket.enums';

@Entity('ticket_activity')
export class TicketActivityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'ticket_id' })
  ticketId!: string;

  @ManyToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: TicketEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({
    type: 'enum',
    enum: TicketActorType,
    enumName: 'ticket_actor_type_enum',
    name: 'actor_type',
  })
  actorType!: TicketActorType;

  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: UserEntity | null;

  @Column({ type: 'varchar', length: 64, name: 'action_type' })
  actionType!: string;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;
}
