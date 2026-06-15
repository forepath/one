import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AgentConsoleRegexFilterRuleEntity } from './agent-console-regex-filter-rule.entity';

@Entity('agent_console_regex_filter_rule_clients')
export class AgentConsoleRegexFilterRuleClientEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'rule_id' })
  ruleId!: string;

  @ManyToOne(() => AgentConsoleRegexFilterRuleEntity, (r) => r.clientLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rule_id' })
  rule!: AgentConsoleRegexFilterRuleEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;
}
