import type { FindingSeverity, FindingSource, FindingStatus } from '@forepath/agenstra/shared/util-initiative-method';
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

import { InitiativeEntity } from './initiative.entity';

/** Finding (retrospective, review, automation report, chat, task): inert until a human converts or dismisses it. */
@Entity('initiative_findings')
@Index('IDX_initiative_findings_initiative_status', ['initiativeId', 'status'])
export class InitiativeFindingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'work_item_id', nullable: true })
  workItemId?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: FindingSource;

  @Column({ type: 'varchar', length: 8, name: 'severity' })
  severity!: FindingSeverity;

  @Column({ type: 'text', name: 'body' })
  body!: string;

  @Column({ type: 'jsonb', name: 'evidence', default: () => "'[]'::jsonb" })
  evidence!: string[];

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: FindingStatus;

  @Column({ type: 'uuid', name: 'proposal_id', nullable: true })
  proposalId?: string | null;

  @Column({ type: 'uuid', name: 'run_id', nullable: true })
  runId?: string | null;

  @Column({ type: 'uuid', name: 'agent_id', nullable: true })
  agentId?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'uuid', name: 'resolved_by_user_id', nullable: true })
  resolvedByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
