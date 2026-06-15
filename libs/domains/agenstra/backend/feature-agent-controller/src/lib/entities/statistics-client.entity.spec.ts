import { AuthenticationType } from '@forepath/identity/backend';

import { StatisticsClientEntity } from './statistics-client.entity';

describe('StatisticsClientEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsClientEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsClientEntity();

    entity.id = 'stats-client-uuid';
    entity.originalClientId = 'client-uuid';
    entity.name = 'Test Client';
    entity.endpoint = 'https://example.com/api';
    entity.authenticationType = AuthenticationType.API_KEY;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.id).toBe('stats-client-uuid');
    expect(entity.originalClientId).toBe('client-uuid');
    expect(entity.name).toBe('Test Client');
    expect(entity.endpoint).toBe('https://example.com/api');
    expect(entity.authenticationType).toBe(AuthenticationType.API_KEY);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should support API_KEY authentication type', () => {
    const entity = new StatisticsClientEntity();

    entity.authenticationType = AuthenticationType.API_KEY;
    expect(entity.authenticationType).toBe(AuthenticationType.API_KEY);
  });

  it('should support KEYCLOAK authentication type', () => {
    const entity = new StatisticsClientEntity();

    entity.authenticationType = AuthenticationType.KEYCLOAK;
    expect(entity.authenticationType).toBe(AuthenticationType.KEYCLOAK);
  });
});
