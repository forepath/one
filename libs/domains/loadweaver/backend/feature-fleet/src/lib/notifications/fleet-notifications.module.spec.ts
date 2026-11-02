import { ForbiddenException } from '@nestjs/common';

import { assertFleetNotificationAdmin } from './fleet-notifications.module';

describe('assertFleetNotificationAdmin', () => {
  it('lets the API key and global admins manage webhook endpoints', () => {
    expect(() => assertFleetNotificationAdmin({ apiKeyAuthenticated: true })).not.toThrow();
    expect(() => assertFleetNotificationAdmin({ user: { id: 'u1', roles: ['admin'] } })).not.toThrow();
  });

  it('rejects other users and PATs without webhooks:admin', () => {
    expect(() => assertFleetNotificationAdmin({ user: { id: 'u2', roles: ['user'] } })).toThrow(ForbiddenException);
    expect(() =>
      assertFleetNotificationAdmin({ user: { id: 'u1', roles: ['admin'], amr: ['pat'], scopes: ['fleet:admin'] } }),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertFleetNotificationAdmin({ user: { id: 'u1', roles: ['admin'], amr: ['pat'], scopes: ['webhooks:admin'] } }),
    ).not.toThrow();
  });
});
