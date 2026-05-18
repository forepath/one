import { UserEnvironmentReadStateEntity } from './user-environment-read-state.entity';

describe('UserEnvironmentReadStateEntity', () => {
  it('should create an instance', () => {
    const entity = new UserEnvironmentReadStateEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new UserEnvironmentReadStateEntity();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    const lastReadAt = new Date('2026-01-01T12:00:00.000Z');

    entity.id = 'read-state-uuid';
    entity.userId = 'user-1';
    entity.clientId = 'client-uuid';
    entity.agentId = 'agent-uuid';
    entity.lastReadAt = lastReadAt;
    entity.lastReadAgentMessageId = 'message-uuid';
    entity.createdAt = createdAt;
    entity.updatedAt = updatedAt;

    expect(entity.id).toBe('read-state-uuid');
    expect(entity.userId).toBe('user-1');
    expect(entity.clientId).toBe('client-uuid');
    expect(entity.agentId).toBe('agent-uuid');
    expect(entity.lastReadAt).toEqual(lastReadAt);
    expect(entity.lastReadAgentMessageId).toBe('message-uuid');
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow nullable last-read fields', () => {
    const entity = new UserEnvironmentReadStateEntity();

    entity.lastReadAt = null;
    entity.lastReadAgentMessageId = null;

    expect(entity.lastReadAt).toBeNull();
    expect(entity.lastReadAgentMessageId).toBeNull();
  });
});
