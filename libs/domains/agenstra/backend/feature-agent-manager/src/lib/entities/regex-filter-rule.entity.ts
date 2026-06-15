import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Direction of messages this rule applies to (matches FilterDirection). */
export type RegexFilterRuleDirection = 'incoming' | 'outgoing' | 'bidirectional';

/** What to do when the pattern matches. */
export type RegexFilterRuleType = 'none' | 'filter' | 'drop';

/**
 * Persisted regex chat filter rule for agent-manager.
 */
@Entity('regex_filter_rules')
export class RegexFilterRuleEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'pattern' })
  pattern!: string;

  /** Allowed: g, i, m, s, u only (passed to RegExp). */
  @Column({ type: 'varchar', length: 16, name: 'regex_flags', default: 'g' })
  regexFlags!: string;

  @Column({ type: 'varchar', length: 32, name: 'direction' })
  direction!: RegexFilterRuleDirection;

  @Column({ type: 'varchar', length: 16, name: 'filter_type' })
  filterType!: RegexFilterRuleType;

  @Column({ type: 'text', name: 'replace_content', nullable: true })
  replaceContent?: string | null;

  @Column({ type: 'int', name: 'priority', default: 0 })
  priority!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
