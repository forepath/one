import { AgentConsoleRegexFilterRuleSyncTargetEntity } from './agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from './agent-console-regex-filter-rule.entity';

describe('AgentConsoleRegexFilterRuleSyncTargetEntity', () => {
  it('creates an instance', () => {
    expect(new AgentConsoleRegexFilterRuleSyncTargetEntity()).toBeDefined();
  });

  it('supports sync fields', () => {
    const t = new AgentConsoleRegexFilterRuleSyncTargetEntity();

    t.id = 'target-uuid';
    t.ruleId = 'rule-uuid';
    t.clientId = 'client-uuid';
    t.managerRuleId = 'manager-rule-uuid';
    t.desiredOnManager = true;
    t.syncStatus = 'pending';
    t.lastError = null;
    t.lastSyncedAt = null;
    t.updatedAt = new Date();

    const rule = new AgentConsoleRegexFilterRuleEntity();

    rule.id = 'rule-uuid';
    t.rule = rule;

    expect(t.syncStatus).toBe('pending');
    expect(t.managerRuleId).toBe('manager-rule-uuid');
    expect(t.rule).toBe(rule);
  });

  it('supports failed status with error text', () => {
    const t = new AgentConsoleRegexFilterRuleSyncTargetEntity();

    t.syncStatus = 'failed';
    t.lastError = 'timeout';
    expect(t.lastError).toBe('timeout');
  });
});
