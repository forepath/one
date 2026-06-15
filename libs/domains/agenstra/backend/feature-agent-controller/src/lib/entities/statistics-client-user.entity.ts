import { ClientUserRole } from '@forepath/identity/backend';
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

import { StatisticsClientEntity } from './statistics-client.entity';
import { StatisticsUserEntity } from './statistics-user.entity';

/**
 * Shadow table for client-user relationships. Stores references to original
 * client_users for statistics correlation.
 */
@Entity('statistics_client_users')
@Index('IDX_statistics_client_users_original_id', ['originalClientUserId'], { unique: true })
@Index('IDX_statistics_client_users_statistics_client_id', ['statisticsClientId'])
export class StatisticsClientUserEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'original_client_user_id' })
  originalClientUserId!: string;

  @Column({ type: 'uuid', name: 'statistics_client_id' })
  statisticsClientId!: string;

  @Column({ type: 'uuid', name: 'statistics_user_id' })
  statisticsUserId!: string;

  @Column({ type: 'enum', enum: ClientUserRole, name: 'role', default: ClientUserRole.USER })
  role!: ClientUserRole;

  @ManyToOne(() => StatisticsClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statistics_client_id' })
  statisticsClient?: StatisticsClientEntity;

  @ManyToOne(() => StatisticsUserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statistics_user_id' })
  statisticsUser?: StatisticsUserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
