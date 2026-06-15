import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { TicketAutomationBranchStrategy } from '../utils/ticket-automation-branch.constants';
import { DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY } from '../utils/ticket-automation-branch.constants';

import { TicketEntity } from './ticket.entity';

/** JSON shape for verifier profile stored in DB (validated on write). */
export type TicketVerifierProfileJson = {
  commands: Array<{ cmd: string; cwd?: string }>;
};

@Entity('ticket_automation')
export class TicketAutomationEntity {
  @PrimaryColumn('uuid', { name: 'ticket_id' })
  ticketId!: string;

  @OneToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity;

  @Column({ type: 'boolean', name: 'eligible', default: false })
  eligible!: boolean;

  /**
   * When empty, any agent with prototype autonomy enabled for this client may run the ticket.
   * When non-empty, only listed agent ids are eligible (still require autonomy.enabled).
   */
  @Column({ type: 'jsonb', name: 'allowed_agent_ids', default: () => "'[]'" })
  allowedAgentIds!: string[];

  /**
   * Adds shared workspace context (`/opt/workspace`) for autonomous prompt enrichment when true.
   */
  @Column({ type: 'boolean', name: 'include_workspace_context', default: true })
  includeWorkspaceContext!: boolean;

  /**
   * Optional environment ids to emphasize in autonomous prompt enrichment.
   */
  @Column({ type: 'jsonb', name: 'context_environment_ids', default: () => "'[]'" })
  contextEnvironmentIds!: string[];

  /**
   * Enables prompt-based auto enrichment for autonomous runs when true.
   */
  @Column({ type: 'boolean', name: 'auto_enrichment_enabled', default: true })
  autoEnrichmentEnabled!: boolean;

  @Column({ type: 'jsonb', name: 'verifier_profile', nullable: true })
  verifierProfile?: TicketVerifierProfileJson | null;

  @Column({ type: 'boolean', name: 'requires_approval', default: false })
  requiresApproval!: boolean;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'uuid', name: 'approved_by_user_id', nullable: true })
  approvedByUserId?: string | null;

  @Column({ type: 'timestamptz', name: 'approval_baseline_ticket_updated_at', nullable: true })
  approvalBaselineTicketUpdatedAt?: Date | null;

  @Column({ type: 'varchar', name: 'default_branch_override', length: 256, nullable: true })
  defaultBranchOverride?: string | null;

  /**
   * `reuse_per_ticket` (default): one `automation/ticket-{ticketId}` branch per ticket, reused across runs when it exists.
   * `new_per_run`: create `automation/{runIdPrefix}` for every run (legacy behaviour).
   */
  @Column({
    type: 'varchar',
    name: 'automation_branch_strategy',
    length: 32,
    default: DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY,
  })
  automationBranchStrategy!: TicketAutomationBranchStrategy;

  /**
   * When true with `reuse_per_ticket`, the next run uses a fresh ephemeral branch; cleared after that run starts branch setup.
   */
  @Column({ type: 'boolean', name: 'force_new_automation_branch_next_run', default: false })
  forceNewAutomationBranchNextRun!: boolean;

  @Column({ type: 'timestamptz', name: 'next_retry_at', nullable: true })
  nextRetryAt?: Date | null;

  @Column({ type: 'int', name: 'consecutive_failure_count', default: 0 })
  consecutiveFailureCount!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
