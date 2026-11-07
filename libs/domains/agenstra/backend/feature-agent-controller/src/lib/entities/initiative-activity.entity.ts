import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InitiativeActionType, InitiativeActorType } from './initiative.enums';
import { InitiativeEntity } from './initiative.entity';

/** Activity log of an initiative (who changed, ran, accepted or decided what). */
@Entity('initiative_activity')
@Index('IDX_initiative_activity_initiative_occurred', ['initiativeId', 'occurredAt'])
export class InitiativeActivityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 16, name: 'actor_type' })
  actorType!: InitiativeActorType;

  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: UserEntity | null;

  @Column({ type: 'uuid', nullable: true, name: 'agent_id' })
  agentId?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'action_type' })
  actionType!: InitiativeActionType;

  @Column({ type: 'jsonb', name: 'payload', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;
}
