import { UsersRepository } from '@forepath/identity/backend';
import { runWithTenantId } from '@forepath/shared/backend';
import { Reflector } from '@nestjs/core';

import { TenantUserGuard } from './tenant-user.guard';

describe('TenantUserGuard', () => {
  let guard: TenantUserGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;

  const createExecutionContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as Parameters<TenantUserGuard['canActivate']>[0];

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    usersRepository = { findById: jest.fn() };
    guard = new TenantUserGuard(reflector as unknown as Reflector, usersRepository as unknown as UsersRepository);
  });

  it('allows public routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(createExecutionContext({}))).resolves.toBe(true);
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('allows api-key authenticated requests', async () => {
    await expect(guard.canActivate(createExecutionContext({ apiKeyAuthenticated: true }))).resolves.toBe(true);
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects when request has no authenticated user', async () => {
    await expect(guard.canActivate(createExecutionContext({}))).resolves.toBe(true);
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects api-key auth when STATIC_API_KEY_TENANT_ID mismatches request tenant', async () => {
    const original = process.env['STATIC_API_KEY_TENANT_ID'];

    process.env['STATIC_API_KEY_TENANT_ID'] = 'acme';

    try {
      await expect(
        runWithTenantId('default', () => guard.canActivate(createExecutionContext({ apiKeyAuthenticated: true }))),
      ).rejects.toThrow('Access denied');
    } finally {
      if (original === undefined) {
        delete process.env['STATIC_API_KEY_TENANT_ID'];
      } else {
        process.env['STATIC_API_KEY_TENANT_ID'] = original;
      }
    }
  });

  it('allows when user tenant matches request tenant', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'default' } as never);

    await expect(
      runWithTenantId('default', () => guard.canActivate(createExecutionContext({ user: { id: 'user-1' } }))),
    ).resolves.toBe(true);
  });

  it('allows when user tenant is missing and request tenant is default', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-1' } as never);

    await expect(
      runWithTenantId('default', () => guard.canActivate(createExecutionContext({ user: { id: 'user-1' } }))),
    ).resolves.toBe(true);
  });

  it('rejects when user tenant mismatches request tenant', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'other' } as never);

    await expect(
      runWithTenantId('default', () => guard.canActivate(createExecutionContext({ user: { id: 'user-1' } }))),
    ).rejects.toThrow('Access denied');
  });

  it('rejects when authenticated user record is missing', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      runWithTenantId('default', () => guard.canActivate(createExecutionContext({ user: { id: 'user-1' } }))),
    ).rejects.toThrow('Access denied');
  });

  it('uses request.tenantId when present on the request object', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'acme' } as never);

    await expect(
      guard.canActivate(createExecutionContext({ user: { id: 'user-1' }, tenantId: 'default' })),
    ).rejects.toThrow('Access denied');
  });
});
