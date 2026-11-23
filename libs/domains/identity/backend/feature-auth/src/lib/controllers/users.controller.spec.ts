import { USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { UsersController } from './users.controller';

describe('UsersController', () => {
  const mockUsersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getUsersCount: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    lockUser: jest.fn(),
    unlockUser: jest.fn(),
    confirmEmail: jest.fn(),
    clearTotp: jest.fn(),
    remove: jest.fn(),
  };
  const adminReq = { user: { id: 'admin-1', roles: ['admin'] } } as any;
  const managerReq = { user: { id: 'manager-1', roles: ['manager'] } } as any;
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(mockUsersService as any);
  });

  it('is open to admins and managers (account-level limits are enforced in the service)', () => {
    expect(Reflect.getMetadata(USERS_ROLES_KEY, UsersController)).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
  });

  it('delegates lock endpoint with requesting user id and role', async () => {
    mockUsersService.lockUser.mockResolvedValue({ id: 'target-1' });

    await controller.lock('target-1', adminReq);

    expect(mockUsersService.lockUser).toHaveBeenCalledWith('target-1', 'admin-1', UserRole.ADMIN);
  });

  it('delegates unlock endpoint with requesting user id and role', async () => {
    mockUsersService.unlockUser.mockResolvedValue({ id: 'target-1' });

    await controller.unlock('target-1', managerReq);

    expect(mockUsersService.unlockUser).toHaveBeenCalledWith('target-1', 'manager-1', UserRole.MANAGER);
  });

  it('delegates confirm-email endpoint with the caller role', async () => {
    mockUsersService.confirmEmail.mockResolvedValue({ id: 'target-1' });

    await controller.confirmEmail('target-1', managerReq);

    expect(mockUsersService.confirmEmail).toHaveBeenCalledWith('target-1', UserRole.MANAGER);
  });

  it('passes the caller role to create, update, clear-totp and delete', async () => {
    await controller.create({ email: 'a@example.com', password: 'secret-pass' }, managerReq);
    await controller.update('target-1', { email: 'b@example.com' }, managerReq);
    await controller.clearTotp('target-1', managerReq);
    await controller.remove('target-1', managerReq);

    expect(mockUsersService.create).toHaveBeenCalledWith(
      { email: 'a@example.com', password: 'secret-pass' },
      UserRole.MANAGER,
    );
    expect(mockUsersService.update).toHaveBeenCalledWith('target-1', { email: 'b@example.com' }, UserRole.MANAGER);
    expect(mockUsersService.clearTotp).toHaveBeenCalledWith('target-1', UserRole.MANAGER);
    expect(mockUsersService.remove).toHaveBeenCalledWith('target-1', 'manager-1', UserRole.MANAGER);
  });

  it('treats the static credential as admin and a missing role as user (fail-closed)', async () => {
    await controller.remove('target-1', { apiKeyAuthenticated: true } as any);
    await controller.remove('target-2', { user: { id: 'u-1', roles: [] } } as any);

    expect(mockUsersService.remove).toHaveBeenNthCalledWith(1, 'target-1', undefined, UserRole.ADMIN);
    expect(mockUsersService.remove).toHaveBeenNthCalledWith(2, 'target-2', 'u-1', UserRole.USER);
  });
});
