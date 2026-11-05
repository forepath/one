import { UserRole } from '@forepath/identity/backend';
import { runWithTenantId } from '@forepath/shared/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { IdentityAppsService } from './identity-apps.service';
import { PersonalAccessTokenService } from './personal-access-token.service';

const CATALOG = ['tickets:read', 'tickets:write', 'users:admin'] as const;

describe('IdentityAppsService', () => {
  const now = new Date('2026-11-05T00:00:00.000Z');
  let repository: Record<string, jest.Mock>;
  let service: IdentityAppsService;

  beforeEach(() => {
    repository = {
      createApp: jest.fn(async (data) => ({ ...data, id: 'app-1', createdAt: now, updatedAt: now })),
      saveApp: jest.fn(async (app) => app),
      findAppForTenant: jest.fn(),
      listAppsForTenant: jest.fn().mockResolvedValue([]),
      countGrantsByApp: jest.fn().mockResolvedValue(new Map()),
      deleteApp: jest.fn(),
      listGrantsForApp: jest.fn().mockResolvedValue([]),
      listGrantsForUser: jest.fn().mockResolvedValue([]),
      findGrantById: jest.fn(),
      deleteGrant: jest.fn().mockResolvedValue(true),
      deleteGrantsByApp: jest.fn().mockResolvedValue(3),
    };
    service = new IdentityAppsService(
      repository as never,
      new PersonalAccessTokenService({} as never, {} as never, CATALOG),
      CATALOG,
    );
  });

  const validInput = {
    name: '  Integration ',
    description: ' Syncs tickets ',
    returnUrl: 'https://app.example.com/callback',
    scopes: ['tickets:read', 'users:admin'],
  };

  it('creates an app, returns the secret once and stores only its bcrypt hash', async () => {
    const created = await service.create('admin-1', validInput);

    expect(created.secret).toMatch(/^fp_aps_[A-Za-z0-9_-]{43}$/);

    const persisted = repository['createApp'].mock.calls[0][0];

    expect(persisted).toMatchObject({
      name: 'Integration',
      description: 'Syncs tickets',
      tenantId: 'default',
      createdByUserId: 'admin-1',
      secretPrefix: created.secret?.slice(0, 15),
    });
    expect(persisted.secretHash).not.toContain(created.secret);
    await expect(bcrypt.compare(created.secret as string, persisted.secretHash)).resolves.toBe(true);
    expect(created).not.toHaveProperty('secretHash');
  });

  it('stores the app in the request tenant', async () => {
    await runWithTenantId('acme', () => service.create('admin-1', validInput));

    expect(repository['createApp'].mock.calls[0][0].tenantId).toBe('acme');
  });

  it.each([
    [{ ...validInput, name: '  ' }, 'Name is required'],
    [{ ...validInput, returnUrl: 'http://evil.example.com/cb' }, 'Return URL'],
    [{ ...validInput, returnUrl: 'javascript:alert(1)' }, 'Return URL'],
    [{ ...validInput, scopes: [] }, 'At least one scope'],
    [{ ...validInput, scopes: ['tickets:read', 'root:admin'] }, 'Unsupported scopes: root:admin'],
  ])('validates input %#', async (input, message) => {
    await expect(service.create('admin-1', input)).rejects.toThrow(BadRequestException);
    await expect(service.create('admin-1', input)).rejects.toThrow(message);
  });

  it('rotates the secret and keeps the previous hash out of the response', async () => {
    const app = { id: 'app-1', tenantId: 'default', scopes: ['tickets:read'], createdAt: now, updatedAt: now };

    repository['findAppForTenant'].mockResolvedValue(app);

    const rotated = await service.rotateSecret('app-1');

    expect(rotated.secret).toMatch(/^fp_aps_/);
    expect(repository['saveApp'].mock.calls[0][0].secretRotatedAt).toBeInstanceOf(Date);
    await expect(
      bcrypt.compare(rotated.secret as string, repository['saveApp'].mock.calls[0][0].secretHash),
    ).resolves.toBe(true);
  });

  it('only manages apps of the request tenant', async () => {
    repository['findAppForTenant'].mockResolvedValue(null);

    await expect(service.remove('app-1')).rejects.toThrow(NotFoundException);
    await expect(service.revokeAllGrants('app-1')).rejects.toThrow(NotFoundException);
    expect(repository['deleteApp']).not.toHaveBeenCalled();
    expect(repository['deleteGrantsByApp']).not.toHaveBeenCalled();
  });

  it('revokes a grant only when it belongs to the app', async () => {
    repository['findAppForTenant'].mockResolvedValue({ id: 'app-1' });
    repository['findGrantById'].mockResolvedValue({ id: 'g1', appId: 'app-2' });

    await expect(service.revokeGrant('app-1', 'g1')).rejects.toThrow(NotFoundException);

    repository['findGrantById'].mockResolvedValue({ id: 'g1', appId: 'app-1' });
    await service.revokeGrant('app-1', 'g1');
    expect(repository['deleteGrant']).toHaveBeenCalledWith('g1');
  });

  it('lets users revoke only their own grants', async () => {
    repository['findGrantById'].mockResolvedValue({ id: 'g1', userId: 'other', tenantId: 'default' });

    await expect(service.revokeOwnGrant('user-1', 'g1')).rejects.toThrow(NotFoundException);
    expect(repository['deleteGrant']).not.toHaveBeenCalled();
  });

  it('lists grants with effective scopes and the re-authorization flag', async () => {
    repository['findAppForTenant'].mockResolvedValue({ id: 'app-1' });
    repository['listGrantsForApp'].mockResolvedValue([
      {
        grant: { id: 'g1', scopes: ['tickets:read', 'users:admin'], createdAt: now, updatedAt: now, lastUsedAt: null },
        app: { id: 'app-1', name: 'Integration', scopes: ['tickets:read', 'tickets:write', 'users:admin'] },
        user: { id: 'u1', email: 'u@example.com', role: UserRole.USER },
        sessionCount: 2,
        lastSessionUsedAt: now,
      },
    ]);

    const [grant] = await service.listGrants('app-1');

    expect(grant).toMatchObject({
      id: 'g1',
      userEmail: 'u@example.com',
      consentedScopes: ['tickets:read', 'users:admin'],
      // Demoted / regular user: admin scope is not effective.
      scopes: ['tickets:read'],
      // App gained tickets:write, which the user can grant.
      needsReauthorization: true,
      sessionCount: 2,
      lastUsedAt: now.toISOString(),
    });
  });
});
