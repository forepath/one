import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TicketAutomationRunEntity } from './ticket-automation-run.entity';

@Entity('ticket_automation_run_step')
@Index('IDX_ticket_automation_run_step_run_index', ['runId', 'stepIndex'], { unique: true })
export class TicketAutomationRunStepEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  @ManyToOne(() => TicketAutomationRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: TicketAutomationRunEntity;

  @Column({ type: 'int', name: 'step_index' })
  stepIndex!: number;

  @Column({ type: 'varchar', name: 'phase', length: 32 })
  phase!: string;

  @Column({ type: 'varchar', name: 'kind', length: 64 })
  kind!: string;

  @Column({ type: 'jsonb', name: 'payload', nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'excerpt', nullable: true })
  excerpt?: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
