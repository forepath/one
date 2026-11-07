import type {
  RetrospectiveVerdict,
  WorkItemKind,
  WorkItemStatus,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TicketEntity } from './ticket.entity';
import type { TicketPriority } from './ticket.enums';
import { InitiativeEntity } from './initiative.entity';

/**
 * Epic, story, spike or bug of an initiative (BMad ticket tree). Keys are stable and never reused. Once transferred,
 * the linked ticket is the source of truth for the build status (see `workItemStatusFromTicketStatus`).
 */
@Entity('initiative_work_items')
@Index('UQ_initiative_work_items_initiative_key', ['initiativeId', 'key'], { unique: true })
@Index('IDX_initiative_work_items_initiative_order', ['initiativeId', 'sortOrder'])
@Index('IDX_initiative_work_items_ticket', ['ticketId'], { unique: true, where: '"ticket_id" IS NOT NULL' })
export class InitiativeWorkItemEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  /** Epic of a story / spike / bug (`null` for epics). */
  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId?: string | null;

  @ManyToOne(() => InitiativeWorkItemEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: InitiativeWorkItemEntity | null;

  @Column({ type: 'varchar', length: 8, name: 'kind' })
  kind!: WorkItemKind;

  @Column({ type: 'varchar', length: 16, name: 'key' })
  key!: string;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'requirements', default: '' })
  requirements!: string;

  @Column({ type: 'text', name: 'verify', default: '' })
  verify!: string;

  @Column({ type: 'text', name: 'done_when', default: '' })
  doneWhen!: string;

  /** Epics start unrefined (BMad: thin envelope, refined before stories are incepted). */
  @Column({ type: 'boolean', name: 'refined', default: false })
  refined!: boolean;

  @Column({ type: 'boolean', name: 'plan_checkpoint', default: false })
  planCheckpoint!: boolean;

  @Column({ type: 'boolean', name: 'done_checkpoint', default: false })
  doneCheckpoint!: boolean;

  @Column({ type: 'varchar', length: 16, name: 'priority', default: 'medium' })
  priority!: TicketPriority;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder!: number;

  /** Own status while not transferred (`draft`, `blocked`, `dropped`, `done`); linked items use the ticket's. */
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'draft' })
  status!: WorkItemStatus;

  @Column({ type: 'uuid', name: 'ticket_id', nullable: true })
  ticketId?: string | null;

  @ManyToOne(() => TicketEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity | null;

  /** Latest retrospective verdict of an epic (gates its dependents when `rejected`). */
  @Column({ type: 'varchar', length: 32, name: 'retrospective_verdict', nullable: true })
  retrospectiveVerdict?: RetrospectiveVerdict | null;

  @Column({ type: 'boolean', name: 'retrospective_overridden', default: false })
  retrospectiveOverridden!: boolean;

  /**
   * Prerequisites not satisfied (or dropped): ticket automation skips the linked ticket. Recomputed with the shared
   * readiness rules on every change of the tree or of a linked ticket; re-checked when a run starts.
   */
  @Column({ type: 'boolean', name: 'automation_blocked', default: false })
  automationBlocked!: boolean;

  @Column({ type: 'int', name: 'iteration_created', default: 1 })
  iterationCreated!: number;

  @Column({ type: 'int', name: 'version', default: 1 })
  version!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
