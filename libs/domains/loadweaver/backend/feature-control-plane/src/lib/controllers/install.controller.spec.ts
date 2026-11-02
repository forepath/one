import { AuthService } from '@forepath/identity/backend';
import type { ModuleRef } from '@nestjs/core';

import type { InstallService } from '../services/install.service';

import { InstallController } from './install.controller';

describe('InstallController claim-status', () => {
  function controller(moduleRef?: Partial<ModuleRef>): InstallController {
    return new InstallController({} as InstallService, moduleRef as ModuleRef | undefined);
  }

  it('reports the admin claim state of users authentication', async () => {
    const adminClaimStatus = jest.fn().mockResolvedValue({ claimConfigured: true, claimRequired: true });
    const get = jest.fn().mockReturnValue({ adminClaimStatus });

    await expect(controller({ get }).claimStatus()).resolves.toEqual({ claimRequired: true, claimConfigured: true });
    expect(get).toHaveBeenCalledWith(AuthService, { strict: false });

    adminClaimStatus.mockResolvedValue({ claimConfigured: true, claimRequired: false });
    await expect(controller({ get }).claimStatus()).resolves.toEqual({ claimRequired: false, claimConfigured: true });
  });

  it('never requires a claim without users authentication', async () => {
    const get = jest.fn().mockImplementation(() => {
      throw new Error('Nest could not find AuthService element');
    });

    await expect(controller({ get }).claimStatus()).resolves.toEqual({ claimRequired: false, claimConfigured: false });
    await expect(controller().claimStatus()).resolves.toEqual({ claimRequired: false, claimConfigured: false });
  });
});
