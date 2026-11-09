import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { InitiativeWorkItemEntity } from './initiative-work-item.entity';

/** `after` edge: `work_item_id` comes after `prerequisite_id` (same initiative, acyclic; checked by the service). */
@Entity('initiative_work_item_dependencies')
@Index('IDX_initiative_work_item_dependencies_initiative', ['initiativeId'])
@Index('IDX_initiative_work_item_dependencies_prerequisite', ['prerequisiteId'])
export class InitiativeWorkItemDependencyEntity {
  @PrimaryColumn({ type: 'uuid', name: 'work_item_id' })
  workItemId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'prerequisite_id' })
  prerequisiteId!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeWorkItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_item_id' })
  workItem?: InitiativeWorkItemEntity;

  @ManyToOne(() => InitiativeWorkItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prerequisite_id' })
  prerequisite?: InitiativeWorkItemEntity;
}
