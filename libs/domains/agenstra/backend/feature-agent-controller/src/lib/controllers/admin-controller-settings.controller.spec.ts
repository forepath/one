import { UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { ControllerSettingsService } from '../services/controller-settings.service';

import { AdminControllerSettingsController } from './admin-controller-settings.controller';

describe('AdminControllerSettingsController', () => {
  const settings = {
    getOverview: jest.fn().mockResolvedValue({ settings: [] }),
    upsert: jest.fn().mockResolvedValue({ key: 'K' }),
    reset: jest.fn().mockResolvedValue({ key: 'K' }),
  };
  const req = (roles: string[]) => ({ user: { id: `${roles[0]}-1`, roles } }) as unknown as RequestWithUser;
  let controller: AdminControllerSettingsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdminControllerSettingsController(settings as unknown as ControllerSettingsService);
  });

  it('lets admins and the static credential manage system settings', async () => {
    await controller.list(req([UserRole.ADMIN]));
    await controller.upsert('K', { value: 'v' }, req([UserRole.ADMIN]));
    await controller.reset('K', { apiKeyAuthenticated: true } as unknown as RequestWithUser);

    expect(settings.upsert).toHaveBeenCalledWith('K', 'v', 'admin-1');
    expect(settings.reset).toHaveBeenCalledWith('K');
  });

  it.each([[UserRole.MANAGER], [UserRole.USER]])(
    'denies %s sessions on every route (system settings are admin-only)',
    async (role) => {
      await expect(controller.list(req([role]))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.upsert('K', { value: 'v' }, req([role]))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.reset('K', req([role]))).rejects.toBeInstanceOf(ForbiddenException);
      expect(settings.getOverview).not.toHaveBeenCalled();
      expect(settings.upsert).not.toHaveBeenCalled();
      expect(settings.reset).not.toHaveBeenCalled();
    },
  );
});
