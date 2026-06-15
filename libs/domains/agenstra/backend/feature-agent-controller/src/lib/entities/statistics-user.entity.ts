import { UserRole } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shadow table for users. Stores references to original users for statistics
 * correlation. Does not contain secrets (email, password, tokens).
 */
@Entity('statistics_users')
@Index('IDX_statistics_users_original_user_id', ['originalUserId'], { unique: true })
export class StatisticsUserEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', nullable: true, name: 'original_user_id' })
  originalUserId?: string;

  @Column({ type: 'varchar', length: 50, name: 'role', default: UserRole.USER })
  role!: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
