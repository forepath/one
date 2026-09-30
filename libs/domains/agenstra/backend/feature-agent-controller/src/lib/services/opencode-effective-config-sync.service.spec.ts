import { Test } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentOpencodeConfigProxyService } from './client-agent-opencode-config-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeConfigService } from './opencode-config.service';
import { OpencodeEffectiveConfigSyncService } from './opencode-effective-config-sync.service';

describe('OpencodeEffectiveConfigSyncService', () => {
  const clientId = '11111111-1111-4111-8111-111111111111';
  const agentId = '22222222-2222-4222-8222-222222222222';

  const createService = async () => {
    const opencodeConfigService = {
      getLayerConfigs: jest.fn().mockResolvedValue({ global: { a: 1 }, workspace: { b: 2 } }),
      getLayerSecrets: jest.fn().mockResolvedValue({ global: { G: 'g' }, workspace: { W: 'w' } }),
      composeStoredLayer: jest.fn().mockReturnValue({ c: 3, d: 4 }),
      mergeEffectiveForSync: jest.fn().mockReturnValue({ a: 1, b: 2, c: 3, d: 4 }),
      mergeSecrets: jest.fn().mockReturnValue({ G: 'g', W: 'w' }),
    };
    const agentConfigProxy = {
      get: jest.fn().mockResolvedValue({ config: { c: 3 }, overrides: { d: 4 } }),
      syncEffective: jest.fn().mockResolvedValue({ ok: true }),
    };
    const clientAgentProxy = {
      getClientAgents: jest.fn().mockResolvedValue([{ id: agentId }]),
    };
    const clientsRepository = {
      findAllIds: jest.fn().mockResolvedValue([clientId]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpencodeEffectiveConfigSyncService,
        { provide: OpencodeConfigService, useValue: opencodeConfigService },
        { provide: ClientAgentOpencodeConfigProxyService, useValue: agentConfigProxy },
        { provide: ClientAgentProxyService, useValue: clientAgentProxy },
        { provide: ClientsRepository, useValue: clientsRepository },
      ],
    }).compile();

    return {
      svc: moduleRef.get(OpencodeEffectiveConfigSyncService),
      opencodeConfigService,
      agentConfigProxy,
      clientAgentProxy,
      clientsRepository,
    };
  };

  it('syncAgent merges layers and calls syncEffective', async () => {
    const { svc, agentConfigProxy, opencodeConfigService } = await createService();

    const result = await svc.syncAgent(clientId, agentId);

    expect(result).toEqual({ ok: true });
    expect(opencodeConfigService.composeStoredLayer).toHaveBeenCalledWith({ c: 3 }, { d: 4 });
    expect(opencodeConfigService.mergeEffectiveForSync).toHaveBeenCalledWith({ c: 3, d: 4 }, { b: 2 }, { a: 1 });
    expect(agentConfigProxy.syncEffective).toHaveBeenCalledWith(
      clientId,
      agentId,
      { a: 1, b: 2, c: 3, d: 4 },
      {
        G: 'g',
        W: 'w',
      },
    );
  });

  it('syncAllClients fans out to every client agent (paged)', async () => {
    const { svc, clientsRepository, clientAgentProxy, agentConfigProxy } = await createService();

    await svc.syncAllClients();

    expect(clientsRepository.findAllIds).toHaveBeenCalled();
    expect(clientAgentProxy.getClientAgents).toHaveBeenCalledWith(clientId, 100, 0);
    expect(agentConfigProxy.syncEffective).toHaveBeenCalled();
  });
});
