import type { UnknownResolution } from '@forepath/agenstra/shared/util-initiative-method';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InitiativeWorkItemEntity } from './initiative-work-item.entity';
import { InitiativeEntity } from './initiative.entity';

/** Open question of an initiative or work item, with its resolution path (settle now / spike / leave to stories). */
@Entity('initiative_unknowns')
@Index('IDX_initiative_unknowns_initiative', ['initiativeId'])
export class InitiativeUnknownEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'work_item_id', nullable: true })
  workItemId?: string | null;

  @ManyToOne(() => InitiativeWorkItemEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'work_item_id' })
  workItem?: InitiativeWorkItemEntity | null;

  @Column({ type: 'text', name: 'question' })
  question!: string;

  @Column({ type: 'varchar', length: 16, name: 'resolution' })
  resolution!: UnknownResolution;

  @Column({ type: 'text', name: 'answer', nullable: true })
  answer?: string | null;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'uuid', name: 'resolved_by_user_id', nullable: true })
  resolvedByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
