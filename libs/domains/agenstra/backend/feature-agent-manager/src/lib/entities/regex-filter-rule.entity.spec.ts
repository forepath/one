import { RegexFilterRuleEntity } from './regex-filter-rule.entity';

describe('RegexFilterRuleEntity', () => {
  it('creates an instance', () => {
    expect(new RegexFilterRuleEntity()).toBeDefined();
  });

  it('supports persisted fields', () => {
    const row = new RegexFilterRuleEntity();

    row.id = 'rule-uuid';
    row.pattern = '\\d+';
    row.regexFlags = 'g';
    row.direction = 'outgoing';
    row.filterType = 'drop';
    row.replaceContent = null;
    row.priority = 1;
    row.createdAt = new Date('2024-01-01');
    row.updatedAt = new Date('2024-01-02');

    expect(row.pattern).toBe('\\d+');
    expect(row.direction).toBe('outgoing');
    expect(row.filterType).toBe('drop');
    expect(row.replaceContent).toBeNull();
    expect(row.priority).toBe(1);
  });
});
