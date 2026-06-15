import { FilterDropDirection, StatisticsChatFilterDropEntity } from './statistics-chat-filter-drop.entity';

describe('StatisticsChatFilterDropEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsChatFilterDropEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsChatFilterDropEntity();

    entity.id = 'filter-drop-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.filterType = 'profanity';
    entity.filterDisplayName = 'Profanity Filter';
    entity.direction = FilterDropDirection.INCOMING;
    entity.wordCount = 5;
    entity.charCount = 25;
    entity.occurredAt = new Date();

    expect(entity.id).toBe('filter-drop-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.filterType).toBe('profanity');
    expect(entity.filterDisplayName).toBe('Profanity Filter');
    expect(entity.direction).toBe(FilterDropDirection.INCOMING);
    expect(entity.wordCount).toBe(5);
    expect(entity.charCount).toBe(25);
    expect(entity.occurredAt).toBeInstanceOf(Date);
  });

  it('should allow optional statisticsAgentId, statisticsUserId and filterReason', () => {
    const entity = new StatisticsChatFilterDropEntity();

    entity.statisticsAgentId = undefined;
    entity.statisticsUserId = undefined;
    entity.filterReason = 'Contains profanity';

    expect(entity.statisticsAgentId).toBeUndefined();
    expect(entity.statisticsUserId).toBeUndefined();
    expect(entity.filterReason).toBe('Contains profanity');
  });

  it('should support INCOMING direction', () => {
    const entity = new StatisticsChatFilterDropEntity();

    entity.direction = FilterDropDirection.INCOMING;
    expect(entity.direction).toBe(FilterDropDirection.INCOMING);
    expect(entity.direction).toBe('incoming');
  });

  it('should support OUTGOING direction', () => {
    const entity = new StatisticsChatFilterDropEntity();

    entity.direction = FilterDropDirection.OUTGOING;
    expect(entity.direction).toBe(FilterDropDirection.OUTGOING);
    expect(entity.direction).toBe('outgoing');
  });

  it('should allow wordCount and charCount of 0 for outgoing drops', () => {
    const entity = new StatisticsChatFilterDropEntity();

    entity.wordCount = 0;
    entity.charCount = 0;

    expect(entity.wordCount).toBe(0);
    expect(entity.charCount).toBe(0);
  });
});
