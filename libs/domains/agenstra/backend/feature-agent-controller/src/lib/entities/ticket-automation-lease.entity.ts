import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { TicketAutomationRunEntity } from './ticket-automation-run.entity';
import { TicketAutomationLeaseStatus } from './ticket-automation.enums';
import { TicketEntity } from './ticket.entity';

@Entity('ticket_automation_lease')
export class TicketAutomationLeaseEntity {
  @PrimaryColumn('uuid', { name: 'ticket_id' })
  ticketId!: string;

  @ManyToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity;

  @Column({ type: 'uuid', name: 'holder_agent_id' })
  holderAgentId!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  @ManyToOne(() => TicketAutomationRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: TicketAutomationRunEntity;

  @Column({ type: 'int', name: 'lease_version', default: 0 })
  leaseVersion!: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({
    type: 'enum',
    enum: TicketAutomationLeaseStatus,
    enumName: 'ticket_automation_lease_status_enum',
    name: 'status',
  })
  status!: TicketAutomationLeaseStatus;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
