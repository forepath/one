import {
  StatisticsEntityEventEntity,
  StatisticsEntityEventType,
  StatisticsEntityType,
} from './statistics-entity-event.entity';

describe('StatisticsEntityEventEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsEntityEventEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsEntityEventEntity();

    entity.id = 'event-uuid';
    entity.eventType = StatisticsEntityEventType.CREATED;
    entity.entityType = StatisticsEntityType.CLIENT;
    entity.originalEntityId = 'client-uuid';
    entity.occurredAt = new Date();

    expect(entity.id).toBe('event-uuid');
    expect(entity.eventType).toBe(StatisticsEntityEventType.CREATED);
    expect(entity.entityType).toBe(StatisticsEntityType.CLIENT);
    expect(entity.originalEntityId).toBe('client-uuid');
    expect(entity.occurredAt).toBeInstanceOf(Date);
  });

  it('should allow optional shadow entity IDs', () => {
    const entity = new StatisticsEntityEventEntity();

    entity.statisticsUserId = 'stats-user-uuid';
    entity.statisticsClientsId = 'stats-client-uuid';
    entity.statisticsAgentsId = 'stats-agent-uuid';

    expect(entity.statisticsUserId).toBe('stats-user-uuid');
    expect(entity.statisticsClientsId).toBe('stats-client-uuid');
    expect(entity.statisticsAgentsId).toBe('stats-agent-uuid');
  });

  it('should support CREATED, UPDATED, and DELETED event types', () => {
    const createdEntity = new StatisticsEntityEventEntity();

    createdEntity.eventType = StatisticsEntityEventType.CREATED;
    expect(createdEntity.eventType).toBe('created');

    const updatedEntity = new StatisticsEntityEventEntity();

    updatedEntity.eventType = StatisticsEntityEventType.UPDATED;
    expect(updatedEntity.eventType).toBe('updated');

    const deletedEntity = new StatisticsEntityEventEntity();

    deletedEntity.eventType = StatisticsEntityEventType.DELETED;
    expect(deletedEntity.eventType).toBe('deleted');
  });

  it('should support all entity types', () => {
    const types = [
      StatisticsEntityType.USER,
      StatisticsEntityType.CLIENT,
      StatisticsEntityType.AGENT,
      StatisticsEntityType.CLIENT_USER,
      StatisticsEntityType.PROVISIONING_REFERENCE,
    ];

    types.forEach((entityType, index) => {
      const entity = new StatisticsEntityEventEntity();

      entity.entityType = entityType;
      expect(entity.entityType).toBe(types[index]);
    });
  });
});
