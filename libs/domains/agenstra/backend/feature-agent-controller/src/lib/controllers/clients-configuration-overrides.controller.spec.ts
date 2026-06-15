import { ClientUsersRepository } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';

import { ClientsConfigurationOverridesController } from './clients-configuration-overrides.controller';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
    ensureWorkspaceManagementAccess: jest.fn().mockResolvedValue(undefined),
  };
});

describe('ClientsConfigurationOverridesController', () => {
  let controller: ClientsConfigurationOverridesController;
  let proxyService: jest.Mocked<ClientWorkspaceConfigurationOverridesProxyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsConfigurationOverridesController],
      providers: [
        {
          provide: ClientWorkspaceConfigurationOverridesProxyService,
          useValue: {
            getConfigurationOverrides: jest.fn().mockResolvedValue([]),
            upsertConfigurationOverride: jest.fn().mockResolvedValue({ settingKey: 'gitToken', value: 'abc' }),
            deleteConfigurationOverride: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get(ClientsConfigurationOverridesController);
    proxyService = module.get(ClientWorkspaceConfigurationOverridesProxyService);
  });

  it('proxies list', async () => {
    await controller.getConfigurationOverrides('8f6e8fc8-7a18-4f96-bd81-cd4fca6e8ea8');
    expect(proxyService.getConfigurationOverrides).toHaveBeenCalled();
  });
});
