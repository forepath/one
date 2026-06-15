import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { KnowledgeNodeEntity } from './knowledge-node.entity';
import { KnowledgeActionType, KnowledgeActorType } from './knowledge-node.enums';

@Entity('knowledge_page_activity')
export class KnowledgePageActivityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'page_id' })
  pageId!: string;

  @ManyToOne(() => KnowledgeNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'page_id' })
  page!: KnowledgeNodeEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({
    type: 'enum',
    enum: KnowledgeActorType,
    enumName: 'knowledge_actor_type_enum',
    name: 'actor_type',
  })
  actorType!: KnowledgeActorType;

  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: UserEntity | null;

  @Column({ type: 'varchar', length: 64, name: 'action_type' })
  actionType!: KnowledgeActionType;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;
}
