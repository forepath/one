import 'reflect-metadata';

import { USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { AdminCustomerProfilesController } from './admin-customer-profiles.controller';

describe('AdminCustomerProfilesController', () => {
  const customerProfilesAdminService = {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    addCustomData: jest.fn(),
    updateCustomData: jest.fn(),
    deleteCustomData: jest.fn(),
  };
  const controller = new AdminCustomerProfilesController(customerProfilesAdminService as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('has admin role guards on controller', () => {
    const usersRoles = Reflect.getMetadata(USERS_ROLES_KEY, AdminCustomerProfilesController);

    expect(usersRoles).toContain(UserRole.ADMIN);
  });

  it('list delegates to admin service', async () => {
    customerProfilesAdminService.list.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    const result = await controller.list(25, 5);

    expect(result.total).toBe(0);
    expect(customerProfilesAdminService.list).toHaveBeenCalledWith(25, 5, undefined);
  });

  it('get delegates to admin service', async () => {
    customerProfilesAdminService.getById.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      isComplete: true,
      customData: {},
    });

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

  it('addCustomData delegates to admin service', async () => {
    const dto = { key: 'erpId', value: 'ERP-1' };

    customerProfilesAdminService.addCustomData.mockResolvedValue({
      id: 'profile-1',
      customData: { erpId: 'ERP-1' },
    });

    const result = await controller.addCustomData('profile-1', dto);

    expect(result.customData).toEqual({ erpId: 'ERP-1' });
    expect(customerProfilesAdminService.addCustomData).toHaveBeenCalledWith('profile-1', 'erpId', 'ERP-1');
  });

  it('updateCustomData delegates to admin service', async () => {
    customerProfilesAdminService.updateCustomData.mockResolvedValue({
      id: 'profile-1',
      customData: { erpId: 'ERP-2' },
    });

    await controller.updateCustomData('profile-1', 'erpId', { value: 'ERP-2' });

    expect(customerProfilesAdminService.updateCustomData).toHaveBeenCalledWith('profile-1', 'erpId', 'ERP-2');
  });

  it('deleteCustomData delegates to admin service', async () => {
    customerProfilesAdminService.deleteCustomData.mockResolvedValue({
      id: 'profile-1',
      customData: {},
    });

    await controller.deleteCustomData('profile-1', 'erpId');

    expect(customerProfilesAdminService.deleteCustomData).toHaveBeenCalledWith('profile-1', 'erpId');
  });
});
