import { AuthenticationType } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientWorkspaceConfigurationOverridesProxyService } from './client-workspace-configuration-overrides-proxy.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientWorkspaceConfigurationOverridesProxyService', () => {
  let service: ClientWorkspaceConfigurationOverridesProxyService;
  let clientsRepository: jest.Mocked<ClientsRepository>;

  beforeAll(() => {
    process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST = 'true';
  });

  afterAll(() => {
    delete process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientWorkspaceConfigurationOverridesProxyService,
        {
          provide: ClientsRepository,
          useValue: {
            findByIdOrThrow: jest.fn().mockResolvedValue({
              id: 'client-1',
              endpoint: 'http://localhost:3000',
              authenticationType: AuthenticationType.API_KEY,
              apiKey: 'test-key',
            }),
          },
        },
        {
          provide: ClientsService,
          useValue: { getAccessToken: jest.fn().mockResolvedValue('token') },
        },
      ],
    }).compile();

    service = module.get(ClientWorkspaceConfigurationOverridesProxyService);
    clientsRepository = module.get(ClientsRepository);
    mockedAxios.request.mockReset();
  });

  it('loads configuration overrides via proxied endpoint', async () => {
    mockedAxios.request.mockResolvedValue({
      status: 200,
      data: [{ settingKey: 'gitToken', value: 'a', source: 'override', hasOverride: true, envVarName: 'GIT_TOKEN' }],
    } as any);

    const result = await service.getConfigurationOverrides('client-1');

    expect(result[0].settingKey).toBe('gitToken');
    expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith('client-1');
  });
});
