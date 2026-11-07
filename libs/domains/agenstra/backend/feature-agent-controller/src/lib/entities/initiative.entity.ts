import { createHash } from 'crypto';

import { ClientEntity } from '@forepath/identity/backend';
import type {
  InitiativePath,
  InitiativePhase,
  InitiativePrerequisiteSatisfiedAt,
  InitiativeState,
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

/**
 * Workspace planning context that follows the BMad Method (Clarify → Plan → Build → Learn & adjust). Owns its
 * documents, work items, runs, proposals, findings, decisions and activity (all cascade with it); linked tickets stay.
 */
@Entity('initiatives')
@Index('IDX_initiatives_client_updated', ['clientId', 'updatedAt'])
@Index('IDX_initiatives_client_long_sha', ['clientId', 'longSha'])
export class InitiativeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'intent', default: '' })
  intent!: string;

  @Column({ type: 'varchar', length: 16, name: 'path' })
  path!: InitiativePath;

  @Column({ type: 'varchar', length: 16, name: 'phase' })
  phase!: InitiativePhase;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: InitiativeState;

  /** Learn & adjust loops: accepted proposals that re-open planning start the next iteration. */
  @Column({ type: 'int', name: 'iteration', default: 1 })
  iteration!: number;

  /** Facilitator environment preselected for step runs (re-checked on every start). */
  @Column({ type: 'uuid', name: 'default_agent_id', nullable: true })
  defaultAgentId?: string | null;

  @Column({ type: 'varchar', length: 256, name: 'default_model', nullable: true })
  defaultModel?: string | null;

  @Column({ type: 'varchar', length: 8, name: 'prerequisite_satisfied_at', default: 'done' })
  prerequisiteSatisfiedAt!: InitiativePrerequisiteSatisfiedAt;

  /** Release stories to `todo` automatically once their prerequisites are satisfied. */
  @Column({ type: 'boolean', name: 'auto_release', default: false })
  autoRelease!: boolean;

  /** Optimistic concurrency (conditional writes: 409 when stale). */
  @Column({ type: 'int', name: 'version', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 40, name: 'long_sha', nullable: true })
  longSha?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  /** Stable context reference (`initiative:<sha>`), sha1 of the id like tickets, knowledge nodes and plans. */
  static deriveLongSha(id: string): string {
    return createHash('sha1').update(id).digest('hex');
  }
}
