import type {
  InitiativeRunMode,
  InitiativeRunStatus,
  InitiativeRunStyle,
  InitiativeStepKey,
  InitiativeTurnStatus,
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
 * One guided step (BMad workflow) run with an environment in a hidden, read-only `-initiative-{id}` session. The agent's
 * latest structured result is kept in `result` until a user accepts or discards it.
 */
@Entity('initiative_runs')
@Index('IDX_initiative_runs_initiative_created', ['initiativeId', 'createdAt'])
@Index('IDX_initiative_runs_client_status', ['clientId', 'status'])
export class InitiativeRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'varchar', length: 32, name: 'step' })
  step!: InitiativeStepKey;

  @Column({ type: 'varchar', length: 16, name: 'mode' })
  mode!: InitiativeRunMode;

  @Column({ type: 'varchar', length: 16, name: 'style' })
  style!: InitiativeRunStyle;

  @Column({ type: 'uuid', name: 'target_work_item_id', nullable: true })
  targetWorkItemId?: string | null;

  @Column({ type: 'uuid', name: 'target_artifact_id', nullable: true })
  targetArtifactId?: string | null;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'varchar', length: 256, name: 'model', nullable: true })
  model?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: InitiativeRunStatus;

  @Column({ type: 'varchar', length: 128, name: 'resume_session_suffix' })
  resumeSessionSuffix!: string;

  /** Latest normalized turn status (draft, items, findings, …). */
  @Column({ type: 'jsonb', name: 'result', nullable: true })
  result?: InitiativeTurnStatus | null;

  /** Target versions when the run started (an accept of a changed target becomes a proposal). */
  @Column({ type: 'jsonb', name: 'base_versions', default: () => "'{}'::jsonb" })
  baseVersions!: Record<string, number>;

  /** Findings a correct-course run starts from (linked to the proposal it produces). */
  @Column({ type: 'jsonb', name: 'finding_ids', default: () => "'[]'::jsonb" })
  findingIds!: string[];

  /** Live text of the turn in progress (throttled, cleared when the turn ends). */
  @Column({ type: 'text', name: 'streaming_text', nullable: true })
  streamingText?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'failure_code', nullable: true })
  failureCode?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'failure_message', nullable: true })
  failureMessage?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'uuid', name: 'decided_by_user_id', nullable: true })
  decidedByUserId?: string | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'int', name: 'version', default: 1 })
  version!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
