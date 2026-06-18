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

    const result = await controller.list();

    expect(result.total).toBe(0);
  });
});
