import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { FleetRole } from '../constants/fleet.constants';

/**
 * A fleet user's access to one cluster (3.24 / 3.17): cluster-wide (`project` null) or limited to one project.
 * The relay enforces it before forwarding with the cluster's service credential.
 */
@Entity('lw_fleet_grants')
@Index('IDX_lw_fleet_grants_user', ['userId'])
export class FleetGrantEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'cluster_id' })
  clusterId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'role' })
  role!: FleetRole;

  @Column({ type: 'varchar', length: 63, name: 'project', nullable: true })
  project!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
