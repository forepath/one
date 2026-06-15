import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per (client, agent) autonomy limits for autonomous ticket runs.
 */
@Entity('client_agent_autonomy')
export class ClientAgentAutonomyEntity {
  @PrimaryColumn('uuid', { name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @PrimaryColumn('uuid', { name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'boolean', name: 'enabled', default: false })
  enabled!: boolean;

  @Column({ type: 'boolean', name: 'pre_improve_ticket', default: false })
  preImproveTicket!: boolean;

  @Column({ type: 'int', name: 'max_runtime_ms', default: 3_600_000 })
  maxRuntimeMs!: number;

  @Column({ type: 'int', name: 'max_iterations', default: 20 })
  maxIterations!: number;

  @Column({ type: 'int', name: 'token_budget_limit', nullable: true })
  tokenBudgetLimit?: number | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
