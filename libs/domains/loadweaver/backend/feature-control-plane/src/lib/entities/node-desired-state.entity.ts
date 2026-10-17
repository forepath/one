import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Last compiled desired state per node. Persisted so every control-plane replica can serve any agent
 * stream (3.34: streams terminate on all members), and a reconnecting agent gets the current state at once.
 */
@Entity('lw_node_desired_states')
export class NodeDesiredStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'node_name' })
  nodeName!: string;

  @Column({ type: 'integer', name: 'revision' })
  revision!: number;

  @Column({ type: 'jsonb', name: 'state' })
  state!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
