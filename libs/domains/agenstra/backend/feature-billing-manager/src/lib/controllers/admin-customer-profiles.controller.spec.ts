import 'reflect-metadata';

import { KEYCLOAK_ROLES_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { AdminCustomerProfilesController } from './admin-customer-profiles.controller';

describe('AdminCustomerProfilesController', () => {
  const customerProfilesAdminService = {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new AdminCustomerProfilesController(customerProfilesAdminService as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('has admin role guards on controller', () => {
    const keycloakRoles = Reflect.getMetadata(KEYCLOAK_ROLES_KEY, AdminCustomerProfilesController);
    const usersRoles = Reflect.getMetadata(USERS_ROLES_KEY, AdminCustomerProfilesController);

    expect(keycloakRoles).toContain(UserRole.ADMIN);
    expect(usersRoles).toContain(UserRole.ADMIN);
  });

  it('list delegates to admin service', async () => {
    customerProfilesAdminService.list.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    const result = await controller.list(25, 5);

    expect(result.total).toBe(0);
    expect(customerProfilesAdminService.list).toHaveBeenCalledWith(25, 5);
  });

  it('get delegates to admin service', async () => {
    customerProfilesAdminService.getById.mockResolvedValue({ id: 'profile-1', userId: 'user-1', isComplete: true });

    const result = await controller.get('profile-1');

    expect(result.id).toBe('profile-1');
  });

  it('create delegates to admin service', async () => {
    const dto = { userId: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' };

    customerProfilesAdminService.create.mockResolvedValue({ userId: 'user-1' });

    await controller.create(dto);

    expect(customerProfilesAdminService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates to admin service', async () => {
    const dto = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', country: 'DE' };

    customerProfilesAdminService.update.mockResolvedValue({ userId: 'user-1' });

    await controller.update('profile-1', dto);

    expect(customerProfilesAdminService.update).toHaveBeenCalledWith('profile-1', dto);
  });

  it('delete delegates to admin service', async () => {
    await controller.delete('profile-1');

    expect(customerProfilesAdminService.delete).toHaveBeenCalledWith('profile-1');
  });
});
