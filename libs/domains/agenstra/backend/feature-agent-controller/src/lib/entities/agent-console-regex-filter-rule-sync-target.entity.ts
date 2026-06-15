import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AgentConsoleRegexFilterRuleEntity } from './agent-console-regex-filter-rule.entity';

export type FilterRuleSyncStatus = 'pending' | 'synced' | 'failed';

@Entity('agent_console_regex_filter_rule_sync_targets')
export class AgentConsoleRegexFilterRuleSyncTargetEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'rule_id' })
  ruleId!: string;

  @ManyToOne(() => AgentConsoleRegexFilterRuleEntity, (r) => r.syncTargets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rule_id' })
  rule!: AgentConsoleRegexFilterRuleEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  /** Remote id on agent-manager after successful create. */
  @Column({ type: 'uuid', name: 'manager_rule_id', nullable: true })
  managerRuleId?: string | null;

  /** When false, scheduler deletes remote rule then clears manager_rule_id. */
  @Column({ type: 'boolean', name: 'desired_on_manager', default: true })
  desiredOnManager!: boolean;

  @Column({ type: 'varchar', length: 16, name: 'sync_status', default: 'pending' })
  syncStatus!: FilterRuleSyncStatus;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
