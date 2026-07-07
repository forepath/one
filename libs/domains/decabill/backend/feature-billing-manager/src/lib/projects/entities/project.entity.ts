import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ProjectStatus } from './project.enums';
import { ProjectMilestoneEntity } from './project-milestone.entity';
import { ProjectTicketEntity } from './project-ticket.entity';
import { ProjectTimeEntryEntity } from './project-time-entry.entity';

@Entity('billing_projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({
    type: 'enum',
    enum: ProjectStatus,
    enumName: 'project_status_enum',
    default: ProjectStatus.ACTIVE,
  })
  status!: ProjectStatus;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'hourly_rate_net' })
  hourlyRateNet!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'target_hours', nullable: true })
  targetHours?: number | null;

  @Column({ type: 'varchar', length: 10, default: 'EUR' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ProjectMilestoneEntity, (m) => m.project)
  milestones?: ProjectMilestoneEntity[];

  @OneToMany(() => ProjectTicketEntity, (t) => t.project)
  tickets?: ProjectTicketEntity[];

  @OneToMany(() => ProjectTimeEntryEntity, (e) => e.project)
  timeEntries?: ProjectTimeEntryEntity[];
}
