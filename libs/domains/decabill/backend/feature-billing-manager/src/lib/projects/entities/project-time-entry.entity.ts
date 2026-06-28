import { UserEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InvoiceEntity } from '../../entities/invoice.entity';
import { ProjectEntity } from './project.entity';
import { ProjectTicketEntity } from './project-ticket.entity';

@Entity('billing_project_time_entries')
export class ProjectTimeEntryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, (p) => p.timeEntries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ type: 'uuid', nullable: true, name: 'ticket_id' })
  ticketId?: string | null;

  @ManyToOne(() => ProjectTicketEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: ProjectTicketEntity | null;

  @Column({ type: 'uuid', name: 'recorded_by_user_id' })
  recordedByUserId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'recorded_by_user_id' })
  recordedByUser?: UserEntity | null;

  @Column({ type: 'int', name: 'duration_minutes' })
  durationMinutes!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamp', name: 'ended_at' })
  endedAt!: Date;

  /** Legacy sort key; kept equal to {@link startedAt} for existing queries. */
  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;

  @Column({ type: 'uuid', nullable: true, name: 'invoice_id' })
  invoiceId?: string | null;

  @ManyToOne(() => InvoiceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity | null;

  @Column({ type: 'timestamp', nullable: true, name: 'billed_at' })
  billedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
