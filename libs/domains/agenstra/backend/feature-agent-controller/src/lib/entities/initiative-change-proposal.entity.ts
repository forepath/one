import type {
  InitiativeTurnProposal,
  ProposalOrigin,
  ProposalStatus,
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

import { InitiativeEntity } from './initiative.entity';

/**
 * Change proposal (BMad correct course / spec reconciliation): document versions, work-item operations and decisions,
 * applied atomically when a human accepts it. Stale when a document it changes moved on since it was created.
 */
@Entity('initiative_change_proposals')
@Index('IDX_initiative_change_proposals_initiative_status', ['initiativeId', 'status'])
export class InitiativeChangeProposalEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'varchar', length: 16, name: 'origin' })
  origin!: ProposalOrigin;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'rationale', default: '' })
  rationale!: string;

  @Column({ type: 'jsonb', name: 'changes' })
  changes!: InitiativeTurnProposal;

  /** Document versions (by artifact id) the proposal was made against. */
  @Column({ type: 'jsonb', name: 'base_versions', default: () => "'{}'::jsonb" })
  baseVersions!: Record<string, number>;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: ProposalStatus;

  /** Accepting starts the next iteration (planning re-opened). */
  @Column({ type: 'boolean', name: 'bumps_iteration', default: true })
  bumpsIteration!: boolean;

  @Column({ type: 'uuid', name: 'run_id', nullable: true })
  runId?: string | null;

  @Column({ type: 'uuid', name: 'agent_id', nullable: true })
  agentId?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'uuid', name: 'decided_by_user_id', nullable: true })
  decidedByUserId?: string | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt?: Date | null;

  @Column({ type: 'text', name: 'decision_note', nullable: true })
  decisionNote?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
