import { AgentConsoleRegexFilterRuleClientEntity } from './agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleSyncTargetEntity } from './agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from './agent-console-regex-filter-rule.entity';

describe('AgentConsoleRegexFilterRuleEntity', () => {
  it('creates an instance', () => {
    expect(new AgentConsoleRegexFilterRuleEntity()).toBeDefined();
  });

  it('supports core columns', () => {
    const rule = new AgentConsoleRegexFilterRuleEntity();

    rule.id = 'rule-uuid';
    rule.pattern = 'foo+';
    rule.regexFlags = 'gi';
    rule.direction = 'bidirectional';
    rule.filterType = 'filter';
    rule.replaceContent = '$1';
    rule.priority = 2;
    rule.enabled = true;
    rule.isGlobal = false;
    rule.createdAt = new Date('2024-01-01');
    rule.updatedAt = new Date('2024-01-02');

    expect(rule.pattern).toBe('foo+');
    expect(rule.regexFlags).toBe('gi');
    expect(rule.direction).toBe('bidirectional');
    expect(rule.filterType).toBe('filter');
    expect(rule.replaceContent).toBe('$1');
    expect(rule.priority).toBe(2);
    expect(rule.enabled).toBe(true);
    expect(rule.isGlobal).toBe(false);
  });

  it('supports optional relations', () => {
    const rule = new AgentConsoleRegexFilterRuleEntity();
    const link = new AgentConsoleRegexFilterRuleClientEntity();
    const target = new AgentConsoleRegexFilterRuleSyncTargetEntity();

    rule.clientLinks = [link];
    rule.syncTargets = [target];
    expect(rule.clientLinks).toEqual([link]);
    expect(rule.syncTargets).toEqual([target]);
  });
});
