import { AgentConsoleRegexFilterRuleClientEntity } from './agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleEntity } from './agent-console-regex-filter-rule.entity';

describe('AgentConsoleRegexFilterRuleClientEntity', () => {
  it('creates an instance', () => {
    expect(new AgentConsoleRegexFilterRuleClientEntity()).toBeDefined();
  });

  it('supports rule and client ids', () => {
    const row = new AgentConsoleRegexFilterRuleClientEntity();

    row.id = 'link-uuid';
    row.ruleId = 'rule-uuid';
    row.clientId = 'client-uuid';

    const rule = new AgentConsoleRegexFilterRuleEntity();

    rule.id = 'rule-uuid';
    row.rule = rule;

    expect(row.ruleId).toBe('rule-uuid');
    expect(row.clientId).toBe('client-uuid');
    expect(row.rule).toBe(rule);
  });
});
