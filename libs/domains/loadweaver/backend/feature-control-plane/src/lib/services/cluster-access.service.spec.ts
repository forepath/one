import { UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import { ClusterAccessService } from './cluster-access.service';

describe('ClusterAccessService', () => {
  const members = { findByUserId: jest.fn() };
  const service = new ClusterAccessService(members as never);
  const userReq = (role: UserRole, amr: string[] = ['pwd']) => ({ user: { id: 'u1', roles: [role], amr } }) as never;

  afterEach(() => jest.clearAllMocks());

  it('treats the static API key as cluster admin', async () => {
    await expect(service.assert({ apiKeyAuthenticated: true } as never, 'admin')).resolves.toMatchObject({
      isApiKey: true,
      role: 'cluster-admin',
    });
  });

  it('treats interactive global admins as cluster admins but not their PATs', async () => {
    await expect(service.can(userReq(UserRole.ADMIN), 'admin')).resolves.toBe(true);

    members.findByUserId.mockResolvedValue(null);
    await expect(service.can(userReq(UserRole.ADMIN, ['pat']), 'read')).resolves.toBe(false);
  });

  it('applies cluster role permissions', async () => {
    members.findByUserId.mockResolvedValue({ role: 'infra-operator' });
    await expect(service.can(userReq(UserRole.USER), 'infra')).resolves.toBe(true);
    await expect(service.can(userReq(UserRole.USER), 'audit')).resolves.toBe(false);

    members.findByUserId.mockResolvedValue({ role: 'auditor' });
    await expect(service.can(userReq(UserRole.USER), 'audit')).resolves.toBe(true);
    await expect(service.assert(userReq(UserRole.USER), 'infra')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies anonymous callers and users without a role', async () => {
    await expect(service.can({} as never, 'read')).resolves.toBe(false);
    members.findByUserId.mockResolvedValue(null);
    await expect(service.can(userReq(UserRole.USER), 'read')).resolves.toBe(false);
  });
});
