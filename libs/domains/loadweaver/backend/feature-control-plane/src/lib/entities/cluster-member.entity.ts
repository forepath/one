import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type ClusterRole = 'cluster-admin' | 'infra-operator' | 'auditor';

/**
 * Cluster roles on top of the global admin / user roles (3.17). Global admins are cluster admins implicitly.
 * Membership changes are immediate (not plan / apply) and audited.
 */
@Entity('lw_cluster_members')
export class ClusterMemberEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 32, name: 'role' })
  role!: ClusterRole;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
