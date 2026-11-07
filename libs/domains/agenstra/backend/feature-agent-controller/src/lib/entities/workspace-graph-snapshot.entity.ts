import type { AgentGraphBuildStatus, AgentGraphDocument } from '@forepath/agenstra/shared/util-opencode-config';
import { ClientEntity } from '@forepath/identity/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persisted metadata graph of one workspace (environments, knowledge, tickets, plans; titles and ids only).
 * The global graph is the union of the snapshots of the workspaces a caller may access.
 */
@Entity('workspace_graph_snapshots')
@Index('uq_workspace_graph_snapshots_client_id', ['clientId'], { unique: true })
export class WorkspaceGraphSnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @OneToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: AgentGraphBuildStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'graph' })
  graph?: AgentGraphDocument | null;

  @Column({ type: 'int', name: 'node_count', default: 0 })
  nodeCount!: number;

  @Column({ type: 'int', name: 'edge_count', default: 0 })
  edgeCount!: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'built_at' })
  builtAt?: Date | null;

  @Column({ type: 'text', nullable: true, name: 'error' })
  error?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
