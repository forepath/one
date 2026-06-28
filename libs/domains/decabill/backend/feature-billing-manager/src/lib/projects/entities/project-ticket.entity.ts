import { UserEntity } from '@forepath/identity/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ProjectMilestoneEntity } from './project-milestone.entity';
import { ProjectEntity } from './project.entity';
import { ProjectTicketPriority, ProjectTicketStatus } from './project.enums';

@Entity('billing_project_tickets')
export class ProjectTicketEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, (p) => p.tickets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ type: 'uuid', nullable: true, name: 'milestone_id' })
  milestoneId?: string | null;

  @ManyToOne(() => ProjectMilestoneEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'milestone_id' })
  milestone?: ProjectMilestoneEntity | null;

  @Column({ type: 'uuid', nullable: true, name: 'parent_id' })
  parentId?: string | null;

  @ManyToOne(() => ProjectTicketEntity, (t) => t.children, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: ProjectTicketEntity | null;

  @OneToMany(() => ProjectTicketEntity, (t) => t.parent)
  children!: ProjectTicketEntity[];

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'long_sha' })
  longSha?: string | null;

  @Column({
    type: 'enum',
    enum: ProjectTicketPriority,
    enumName: 'project_ticket_priority_enum',
  })
  priority!: ProjectTicketPriority;

  @Column({
    type: 'enum',
    enum: ProjectTicketStatus,
    enumName: 'project_ticket_status_enum',
  })
  status!: ProjectTicketStatus;

  @Column({ type: 'boolean', default: false })
  locked!: boolean;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
