import { ClientUserRole } from '@forepath/identity/backend';

import { StatisticsClientUserEntity } from './statistics-client-user.entity';

describe('StatisticsClientUserEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsClientUserEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsClientUserEntity();

    entity.id = 'stats-cu-uuid';
    entity.originalClientUserId = 'cu-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.statisticsUserId = 'stats-user-uuid';
    entity.role = ClientUserRole.USER;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.id).toBe('stats-cu-uuid');
    expect(entity.originalClientUserId).toBe('cu-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.statisticsUserId).toBe('stats-user-uuid');
    expect(entity.role).toBe(ClientUserRole.USER);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should support USER and ADMIN roles', () => {
    const userEntity = new StatisticsClientUserEntity();

    userEntity.role = ClientUserRole.USER;
    expect(userEntity.role).toBe(ClientUserRole.USER);

    const adminEntity = new StatisticsClientUserEntity();

    adminEntity.role = ClientUserRole.ADMIN;
    expect(adminEntity.role).toBe(ClientUserRole.ADMIN);
  });
});
