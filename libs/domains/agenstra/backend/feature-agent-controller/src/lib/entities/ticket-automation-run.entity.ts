import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TicketAutomationRunPhase, TicketAutomationRunStatus } from './ticket-automation.enums';
import { TicketEntity } from './ticket.entity';

@Entity('ticket_automation_run')
@Index('IDX_ticket_automation_run_ticket_started', ['ticketId', 'startedAt'])
@Index('IDX_ticket_automation_run_client_status', ['clientId', 'status'])
@Index('IDX_ticket_automation_run_agent_status', ['agentId', 'status'])
export class TicketAutomationRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'ticket_id' })
  ticketId!: string;

  @ManyToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({
    type: 'enum',
    enum: TicketAutomationRunStatus,
    enumName: 'ticket_automation_run_status_enum',
    name: 'status',
  })
  status!: TicketAutomationRunStatus;

  @Column({
    type: 'enum',
    enum: TicketAutomationRunPhase,
    enumName: 'ticket_automation_run_phase_enum',
    name: 'phase',
  })
  phase!: TicketAutomationRunPhase;

  @Column({ type: 'varchar', name: 'ticket_status_before', length: 32 })
  ticketStatusBefore!: string;

  @Column({ type: 'varchar', name: 'branch_name', length: 512, nullable: true })
  branchName?: string | null;

  @Column({ type: 'varchar', name: 'base_branch', length: 256, nullable: true })
  baseBranch?: string | null;

  @Column({ type: 'varchar', name: 'base_sha', length: 64, nullable: true })
  baseSha?: string | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'int', name: 'iteration_count', default: 0 })
  iterationCount!: number;

  @Column({ type: 'boolean', name: 'completion_marker_seen', default: false })
  completionMarkerSeen!: boolean;

  @Column({ type: 'boolean', name: 'verification_passed', nullable: true })
  verificationPassed?: boolean | null;

  @Column({ type: 'varchar', name: 'failure_code', length: 64, nullable: true })
  failureCode?: string | null;

  @Column({ type: 'jsonb', name: 'summary', nullable: true })
  summary?: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', name: 'cancel_requested_at', nullable: true })
  cancelRequestedAt?: Date | null;

  @Column({ type: 'uuid', name: 'cancelled_by_user_id', nullable: true })
  cancelledByUserId?: string | null;

  @Column({ type: 'varchar', name: 'cancellation_reason', length: 64, nullable: true })
  cancellationReason?: string | null;
}
