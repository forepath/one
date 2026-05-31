import { getTypeOrmOptionsForQueueRole } from './typeorm-options-for-role';

describe('getTypeOrmOptionsForQueueRole', () => {
  const base = {
    type: 'postgres' as const,
    migrations: ['apps/example/migrations/*.ts'],
  };

  it('keeps migrations for api and all', () => {
    expect(getTypeOrmOptionsForQueueRole(base, 'api').migrations).toEqual(base.migrations);
    expect(getTypeOrmOptionsForQueueRole(base, 'all').migrations).toEqual(base.migrations);
  });

  it('clears migrations for worker and scheduler', () => {
    expect(getTypeOrmOptionsForQueueRole(base, 'worker').migrations).toEqual([]);
    expect(getTypeOrmOptionsForQueueRole(base, 'scheduler').migrations).toEqual([]);
  });
});
