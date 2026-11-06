const shouldRunApiHttp = jest.fn(() => true);

jest.mock('@forepath/shared/backend/util-queue', () => ({
  shouldRunApiHttp,
}));

jest.mock('@forepath/identity/backend', () => ({
  AuthenticationType: { API_KEY: 'api_key', OIDC: 'oidc' },
}));

jest.mock('@forepath/shared/backend', () => ({
  resolveUpdateState: jest.fn(() => 'up_to_date'),
  UpdatesRedisStore: class UpdatesRedisStore {},
}));

jest.mock('../repositories/clients.repository', () => ({
  ClientsRepository: class ClientsRepository {},
}));

jest.mock('../utils/client-endpoint-security', () => ({
  getClientEndpointTlsPolicy: jest.fn(() => ({ rejectUnauthorized: true })),
  validateClientEndpointWithDnsOrThrow: jest.fn(async () => undefined),
}));

jest.mock('../utils/client-proxy-request-headers', () => ({
  buildClientProxyRequestHeaders: jest.fn(() => ({ Authorization: 'Bearer x' })),
}));

const axiosGet = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => axiosGet(...args) },
}));

import { AuthenticationType } from '@forepath/identity/backend';
import { resolveUpdateState } from '@forepath/shared/backend';

import { AgentManagerInstanceScrapeService } from './agent-manager-instance-scrape.service';

describe('AgentManagerInstanceScrapeService', () => {
  const clientsRepository = {
    findAll: jest.fn(),
  };
  const updatesRedisStore = {
    getRelease: jest.fn(),
    upsertInstance: jest.fn(),
  };

  let service: AgentManagerInstanceScrapeService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    shouldRunApiHttp.mockReturnValue(true);
    service = new AgentManagerInstanceScrapeService(clientsRepository as never, updatesRedisStore as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('does not schedule scrapes when QUEUE_ROLE is not api/all', () => {
    shouldRunApiHttp.mockReturnValue(false);
    clientsRepository.findAll.mockResolvedValue([]);

    service.onModuleInit();

    expect(clientsRepository.findAll).not.toHaveBeenCalled();
  });

  it('scrapes on init and on the interval when api role', async () => {
    clientsRepository.findAll.mockResolvedValue([]);

    service.onModuleInit();
    await Promise.resolve();
    expect(clientsRepository.findAll).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(clientsRepository.findAll).toHaveBeenCalledTimes(2);
  });

  it('upserts instance status from API-key workspaces', async () => {
    clientsRepository.findAll.mockResolvedValue([
      {
        id: 'client-1',
        endpoint: 'http://host.docker.internal:3000',
        authenticationType: AuthenticationType.API_KEY,
        apiKey: 'secret',
      },
    ]);
    updatesRedisStore.getRelease.mockResolvedValue({ tagName: 'v2.22.0' });
    axiosGet.mockResolvedValue({
      status: 200,
      data: {
        instanceId: 'agent-manager:api:abc',
        serviceName: 'agent-manager',
        role: 'api',
        hostname: 'abc',
        installedVersion: '2.22.0-smoke',
        dependencies: {
          redis: 'not_applicable',
          queue: 'not_applicable',
          database: 'healthy',
          opensearch: 'not_applicable',
        },
      },
    });

    await service.refreshRemoteInstances();

    expect(axiosGet).toHaveBeenCalledWith('http://host.docker.internal:3000/api/instance-status', expect.any(Object));
    expect(resolveUpdateState).toHaveBeenCalledWith('2.22.0-smoke', 'v2.22.0');
    expect(updatesRedisStore.upsertInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'agent-manager:api:abc',
        serviceName: 'agent-manager',
        installedVersion: '2.22.0-smoke',
      }),
    );
  });

  it('skips OIDC workspaces', async () => {
    clientsRepository.findAll.mockResolvedValue([
      {
        id: 'client-2',
        endpoint: 'http://example.com',
        authenticationType: AuthenticationType.OIDC,
        apiKey: null,
      },
    ]);

    await service.refreshRemoteInstances();

    expect(axiosGet).not.toHaveBeenCalled();
    expect(updatesRedisStore.upsertInstance).not.toHaveBeenCalled();
  });
});
