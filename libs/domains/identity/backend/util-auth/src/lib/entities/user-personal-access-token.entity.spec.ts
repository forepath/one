import { UserPersonalAccessTokenEntity } from './user-personal-access-token.entity';

describe('UserPersonalAccessTokenEntity', () => {
  it('can be constructed with persisted fields', () => {
    const entity = new UserPersonalAccessTokenEntity();

    entity.id = 'token-1';
    entity.userId = 'user-1';
    entity.name = 'CI';
    entity.tokenPrefix = 'fp_pat_abcd';
    entity.tokenHash = 'hash';
    entity.scopes = ['usage:write'];
    entity.expiresAt = null;
    entity.revokedAt = null;
    entity.lastUsedAt = null;
    entity.createdAt = new Date('2026-01-01T00:00:00.000Z');

    expect(entity).toMatchObject({
      id: 'token-1',
      userId: 'user-1',
      name: 'CI',
      tokenPrefix: 'fp_pat_abcd',
      scopes: ['usage:write'],
    });
  });
});
