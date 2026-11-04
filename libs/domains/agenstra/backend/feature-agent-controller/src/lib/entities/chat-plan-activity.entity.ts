import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { ChatPlanEntity } from './chat-plan.entity';
import { ChatPlanActionType, ChatPlanActorType } from './chat-plan.enums';

/** Activity log of a chat plan (creation, agent drafts, user edits, execution), newest first on the plans page. */
@Entity('chat_plan_activity')
@Index('IDX_chat_plan_activity_plan_occurred', ['planId', 'occurredAt'])
export class ChatPlanActivityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId!: string;

  @ManyToOne(() => ChatPlanEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: ChatPlanEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 16, name: 'actor_type' })
  actorType!: ChatPlanActorType;

  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: UserEntity | null;

  @Column({ type: 'varchar', length: 64, name: 'action_type' })
  actionType!: ChatPlanActionType;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;
}
