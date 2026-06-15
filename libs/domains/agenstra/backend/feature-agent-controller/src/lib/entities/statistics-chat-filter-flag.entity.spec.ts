import { FilterFlagDirection, StatisticsChatFilterFlagEntity } from './statistics-chat-filter-flag.entity';

describe('StatisticsChatFilterFlagEntity', () => {
  it('creates an instance', () => {
    expect(new StatisticsChatFilterFlagEntity()).toBeDefined();
  });

  it('supports required fields', () => {
    const entity = new StatisticsChatFilterFlagEntity();

    entity.id = 'flag-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.filterType = 'database-regex-incoming';
    entity.filterDisplayName = 'Database regex rules (incoming)';
    entity.direction = FilterFlagDirection.INCOMING;
    entity.wordCount = 3;
    entity.charCount = 12;
    entity.occurredAt = new Date();

    expect(entity.id).toBe('flag-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.filterType).toBe('database-regex-incoming');
    expect(entity.filterDisplayName).toBe('Database regex rules (incoming)');
    expect(entity.direction).toBe(FilterFlagDirection.INCOMING);
    expect(entity.wordCount).toBe(3);
    expect(entity.charCount).toBe(12);
    expect(entity.occurredAt).toBeInstanceOf(Date);
  });

  it('allows optional agent, user and reason', () => {
    const entity = new StatisticsChatFilterFlagEntity();

    entity.filterReason = 'regex flag';
    expect(entity.filterReason).toBe('regex flag');
  });

  it('supports INCOMING and OUTGOING enum string values', () => {
    const incoming = new StatisticsChatFilterFlagEntity();

    incoming.direction = FilterFlagDirection.INCOMING;
    expect(incoming.direction).toBe('incoming');

    const outgoing = new StatisticsChatFilterFlagEntity();

    outgoing.direction = FilterFlagDirection.OUTGOING;
    expect(outgoing.direction).toBe('outgoing');
  });
});
