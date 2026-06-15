import { UserRole } from '@forepath/identity/backend';

import { StatisticsUserEntity } from './statistics-user.entity';

describe('StatisticsUserEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsUserEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsUserEntity();

    entity.id = 'stats-user-uuid';
    entity.originalUserId = 'user-uuid';
    entity.role = UserRole.USER;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.id).toBe('stats-user-uuid');
    expect(entity.originalUserId).toBe('user-uuid');
    expect(entity.role).toBe(UserRole.USER);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow nullable originalUserId for deleted users', () => {
    const entity = new StatisticsUserEntity();

    entity.id = 'stats-user-uuid';
    entity.originalUserId = undefined;
    entity.role = UserRole.USER;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.originalUserId).toBeUndefined();
  });

  it('should support USER and ADMIN roles', () => {
    const userEntity = new StatisticsUserEntity();

    userEntity.role = UserRole.USER;
    expect(userEntity.role).toBe(UserRole.USER);

    const adminEntity = new StatisticsUserEntity();

    adminEntity.role = UserRole.ADMIN;
    expect(adminEntity.role).toBe(UserRole.ADMIN);
  });
});
