import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InitiativeDecisionStatus } from './initiative.enums';
import { InitiativeEntity } from './initiative.entity';

/** Dated decision line / ADR of an initiative. Proposed by agents or users; only accepted ones are binding. */
@Entity('initiative_decisions')
@Index('IDX_initiative_decisions_initiative_created', ['initiativeId', 'createdAt'])
export class InitiativeDecisionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'work_item_id', nullable: true })
  workItemId?: string | null;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'body', default: '' })
  body!: string;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: InitiativeDecisionStatus;

  @Column({ type: 'int', name: 'iteration' })
  iteration!: number;

  @Column({ type: 'uuid', name: 'proposal_id', nullable: true })
  proposalId?: string | null;

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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
