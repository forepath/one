import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AgentConsoleRegexFilterRuleClientEntity } from './agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleSyncTargetEntity } from './agent-console-regex-filter-rule-sync-target.entity';

export type ConsoleRegexFilterDirection = 'incoming' | 'outgoing' | 'bidirectional';
export type ConsoleRegexFilterType = 'none' | 'filter' | 'drop';

@Entity('agent_console_regex_filter_rules')
export class AgentConsoleRegexFilterRuleEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'pattern' })
  pattern!: string;

  @Column({ type: 'varchar', length: 16, name: 'regex_flags', default: 'g' })
  regexFlags!: string;

  @Column({ type: 'varchar', length: 32, name: 'direction' })
  direction!: ConsoleRegexFilterDirection;

  @Column({ type: 'varchar', length: 16, name: 'filter_type' })
  filterType!: ConsoleRegexFilterType;

  @Column({ type: 'text', name: 'replace_content', nullable: true })
  replaceContent?: string | null;

  @Column({ type: 'int', name: 'priority', default: 0 })
  priority!: number;

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  @Column({ type: 'boolean', name: 'is_global', default: false })
  isGlobal!: boolean;

  @OneToMany(() => AgentConsoleRegexFilterRuleClientEntity, (c) => c.rule, { cascade: ['insert', 'remove'] })
  clientLinks?: AgentConsoleRegexFilterRuleClientEntity[];

  @OneToMany(() => AgentConsoleRegexFilterRuleSyncTargetEntity, (t) => t.rule, { cascade: ['insert', 'remove'] })
  syncTargets?: AgentConsoleRegexFilterRuleSyncTargetEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
