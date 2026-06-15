import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';

import { FilterDropDirection } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';

import { StatisticsService } from './statistics.service';

describe('StatisticsService', () => {
  let service: StatisticsService;
  let statisticsRepository: jest.Mocked<Pick<StatisticsRepository, keyof StatisticsRepository>>;
  let clientsRepository: jest.Mocked<Pick<ClientsRepository, keyof ClientsRepository>>;
  const mockClient: ClientEntity = {
    id: 'client-uuid',
    name: 'Test Client',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockStatisticsClient = { id: 'stats-client-uuid', originalClientId: 'client-uuid' };
  const mockStatisticsAgent = { id: 'stats-agent-uuid', originalAgentId: 'agent-uuid' };
  const mockStatisticsUser = {
    id: 'stats-user-uuid',
    originalUserId: 'user-uuid',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    statisticsRepository = {
      upsertStatisticsClient: jest.fn().mockResolvedValue(mockStatisticsClient),
      upsertStatisticsAgent: jest.fn().mockResolvedValue(mockStatisticsAgent),
      findStatisticsUserByOriginalId: jest.fn().mockResolvedValue(mockStatisticsUser),
      findStatisticsClientByOriginalId: jest.fn().mockResolvedValue(mockStatisticsClient),
      upsertStatisticsUser: jest.fn().mockResolvedValue(mockStatisticsUser),
      createStatisticsChatIo: jest.fn().mockResolvedValue({}),
      createStatisticsChatFilterDrop: jest.fn().mockResolvedValue({}),
      createStatisticsEntityEvent: jest.fn().mockResolvedValue({}),
      createStatisticsClientUser: jest.fn().mockResolvedValue({ id: 'stats-cu-uuid' }),
      createStatisticsProvisioningReference: jest.fn().mockResolvedValue({ id: 'stats-prov-uuid' }),
    } as never;

    clientsRepository = {
      findById: jest.fn().mockResolvedValue(mockClient),
    } as never;

    const { Test } = await import('@nestjs/testing');
    const module = Test.createTestingModule({
      providers: [
        StatisticsService,
        { provide: StatisticsRepository, useValue: statisticsRepository },
        { provide: ClientsRepository, useValue: clientsRepository },
      ],
    });
    const compiled = await module.compile();

    service = compiled.get(StatisticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordChatInput', () => {
    it('should record chat input and create shadow entries', async () => {
      await service.recordChatInput('client-uuid', 'agent-uuid', 10, 50, 'user-uuid');

      expect(clientsRepository.findById).toHaveBeenCalledWith('client-uuid');
      expect(statisticsRepository.upsertStatisticsClient).toHaveBeenCalledWith('client-uuid', {
        name: mockClient.name,
        endpoint: mockClient.endpoint,
        authenticationType: mockClient.authenticationType,
      });
      expect(statisticsRepository.upsertStatisticsAgent).toHaveBeenCalledWith('agent-uuid', 'stats-client-uuid', {});
      expect(statisticsRepository.createStatisticsChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientId: 'stats-client-uuid',
          statisticsAgentId: 'stats-agent-uuid',
          statisticsUserId: 'stats-user-uuid',
          direction: 'input',
          interactionKind: StatisticsInteractionKind.CHAT,
          wordCount: 10,
          charCount: 50,
        }),
      );
    });

    it('should record prompt enhancement interaction kind when provided', async () => {
      await service.recordChatInput(
        'client-uuid',
        'agent-uuid',
        2,
        10,
        'user-uuid',
        StatisticsInteractionKind.PROMPT_ENHANCEMENT,
      );

      expect(statisticsRepository.createStatisticsChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionKind: StatisticsInteractionKind.PROMPT_ENHANCEMENT,
        }),
      );
    });

    it('should not throw when client not found (logs warning)', async () => {
      clientsRepository.findById!.mockResolvedValue(null);

      await expect(service.recordChatInput('client-uuid', 'agent-uuid', 5, 20)).resolves.not.toThrow();
    });

    it('should work without userId', async () => {
      statisticsRepository.findStatisticsUserByOriginalId!.mockResolvedValue(null);

      await service.recordChatInput('client-uuid', 'agent-uuid', 3, 15);

      expect(statisticsRepository.createStatisticsChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsUserId: undefined,
        }),
      );
    });
  });

  describe('recordChatOutput', () => {
    it('should record chat output', async () => {
      await service.recordChatOutput('client-uuid', 'agent-uuid', 20, 100, 'user-uuid');

      expect(statisticsRepository.createStatisticsChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'output',
          interactionKind: StatisticsInteractionKind.CHAT,
          wordCount: 20,
          charCount: 100,
        }),
      );
    });
  });

  describe('recordChatFilterDrop', () => {
    it('should record filter drop with all fields', async () => {
      await service.recordChatFilterDrop(
        'client-uuid',
        'agent-uuid',
        'profanity',
        'Profanity Filter',
        FilterDropDirection.INCOMING,
        5,
        25,
        'user-uuid',
        'Contains profanity',
      );

      expect(statisticsRepository.createStatisticsChatFilterDrop).toHaveBeenCalledWith(
        expect.objectContaining({
          filterType: 'profanity',
          filterDisplayName: 'Profanity Filter',
          filterReason: 'Contains profanity',
          direction: FilterDropDirection.INCOMING,
          wordCount: 5,
          charCount: 25,
        }),
      );
    });
  });

  describe('recordEntityCreated', () => {
    it('should record user created', async () => {
      await service.recordEntityCreated(StatisticsEntityType.USER, 'user-uuid', { role: 'admin' }, 'admin-uuid');

      expect(statisticsRepository.upsertStatisticsUser).toHaveBeenCalled();
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.CREATED,
          entityType: StatisticsEntityType.USER,
          originalEntityId: 'user-uuid',
        }),
      );
    });

    it('should record client created', async () => {
      await service.recordEntityCreated(StatisticsEntityType.CLIENT, 'client-uuid', {}, 'user-uuid');

      expect(statisticsRepository.upsertStatisticsClient).toHaveBeenCalledWith('client-uuid', {
        name: mockClient.name,
        endpoint: mockClient.endpoint,
        authenticationType: mockClient.authenticationType,
      });
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.CREATED,
          entityType: StatisticsEntityType.CLIENT,
          originalEntityId: 'client-uuid',
          statisticsClientsId: 'stats-client-uuid',
        }),
      );
    });

    it('should not record client created when client not found', async () => {
      clientsRepository.findById!.mockResolvedValue(null);

      await service.recordEntityCreated(StatisticsEntityType.CLIENT, 'client-uuid', {}, 'user-uuid');

      expect(statisticsRepository.createStatisticsEntityEvent).not.toHaveBeenCalled();
    });

    it('should record agent created', async () => {
      await service.recordEntityCreated(
        StatisticsEntityType.AGENT,
        'agent-uuid',
        {
          clientId: 'client-uuid',
          agentType: 'cursor',
          containerType: 'generic',
          name: 'Test Agent',
          description: 'Test',
        },
        'user-uuid',
      );

      expect(statisticsRepository.upsertStatisticsAgent).toHaveBeenCalledWith(
        'agent-uuid',
        'stats-client-uuid',
        expect.objectContaining({
          agentType: 'cursor',
          containerType: 'generic',
          name: 'Test Agent',
          description: 'Test',
        }),
      );
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.CREATED,
          entityType: StatisticsEntityType.AGENT,
          originalEntityId: 'agent-uuid',
          statisticsAgentsId: 'stats-agent-uuid',
        }),
      );
    });

    it('should record client-user created', async () => {
      await service.recordEntityCreated(
        StatisticsEntityType.CLIENT_USER,
        'cu-uuid',
        { clientId: 'client-uuid', userId: 'user-uuid', role: 'user' },
        'admin-uuid',
      );

      expect(statisticsRepository.createStatisticsClientUser).toHaveBeenCalledWith(
        expect.objectContaining({
          originalClientUserId: 'cu-uuid',
          statisticsClientId: 'stats-client-uuid',
          statisticsUserId: 'stats-user-uuid',
          role: 'user',
        }),
      );
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.CREATED,
          entityType: StatisticsEntityType.CLIENT_USER,
        }),
      );
    });

    it('should record provisioning reference created and sanitize metadata', async () => {
      await service.recordEntityCreated(
        StatisticsEntityType.PROVISIONING_REFERENCE,
        'prov-uuid',
        {
          clientId: 'client-uuid',
          providerType: 'hetzner',
          serverId: 'srv-123',
          serverName: 'test-server',
          publicIp: '1.2.3.4',
          privateIp: '10.0.0.1',
          providerMetadata: JSON.stringify({ location: 'fsn1', gitToken: 'secret' }),
        },
        'user-uuid',
      );

      expect(statisticsRepository.createStatisticsProvisioningReference).toHaveBeenCalledWith(
        expect.objectContaining({
          originalProvisioningReferenceId: 'prov-uuid',
          statisticsClientId: 'stats-client-uuid',
          providerType: 'hetzner',
          serverId: 'srv-123',
          serverName: 'test-server',
          publicIp: '1.2.3.4',
          privateIp: '10.0.0.1',
        }),
      );
      const providerMetadata = (statisticsRepository.createStatisticsProvisioningReference as jest.Mock).mock
        .calls[0][0].providerMetadata;

      expect(providerMetadata).toBeDefined();
      const parsed = JSON.parse(providerMetadata);

      expect(parsed).not.toHaveProperty('gitToken');
      expect(parsed).toHaveProperty('location', 'fsn1');
    });
  });

  describe('recordEntityUpdated', () => {
    it('should record user updated', async () => {
      await service.recordEntityUpdated(StatisticsEntityType.USER, 'user-uuid', { role: 'admin' }, 'admin-uuid');

      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.UPDATED,
          entityType: StatisticsEntityType.USER,
          originalEntityId: 'user-uuid',
          statisticsUsersId: 'stats-user-uuid',
        }),
      );
    });

    it('should record client updated', async () => {
      await service.recordEntityUpdated(StatisticsEntityType.CLIENT, 'client-uuid', {}, 'user-uuid');

      expect(clientsRepository.findById).toHaveBeenCalledWith('client-uuid');
      expect(statisticsRepository.upsertStatisticsClient).toHaveBeenCalledWith('client-uuid', {
        name: mockClient.name,
        endpoint: mockClient.endpoint,
        authenticationType: mockClient.authenticationType,
      });
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.UPDATED,
          entityType: StatisticsEntityType.CLIENT,
          originalEntityId: 'client-uuid',
          statisticsClientsId: 'stats-client-uuid',
        }),
      );
    });

    it('should record agent updated', async () => {
      await service.recordEntityUpdated(
        StatisticsEntityType.AGENT,
        'agent-uuid',
        { clientId: 'client-uuid', agentType: 'cursor', name: 'My Agent' },
        'user-uuid',
      );

      expect(statisticsRepository.findStatisticsClientByOriginalId).toHaveBeenCalledWith('client-uuid');
      expect(statisticsRepository.upsertStatisticsAgent).toHaveBeenCalledWith(
        'agent-uuid',
        'stats-client-uuid',
        expect.objectContaining({ agentType: 'cursor', name: 'My Agent' }),
      );
      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.UPDATED,
          entityType: StatisticsEntityType.AGENT,
          originalEntityId: 'agent-uuid',
          statisticsAgentsId: 'stats-agent-uuid',
        }),
      );
    });
  });

  describe('recordEntityDeleted', () => {
    it('should record user deleted', async () => {
      await service.recordEntityDeleted(StatisticsEntityType.USER, 'user-uuid', 'admin-uuid');

      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.DELETED,
          entityType: StatisticsEntityType.USER,
          originalEntityId: 'user-uuid',
          statisticsUserId: 'stats-user-uuid',
        }),
      );
    });

    it('should record client deleted', async () => {
      await service.recordEntityDeleted(StatisticsEntityType.CLIENT, 'client-uuid', 'admin-uuid');

      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.DELETED,
          entityType: StatisticsEntityType.CLIENT,
          originalEntityId: 'client-uuid',
          statisticsClientsId: 'stats-client-uuid',
        }),
      );
    });

    it('should record entity deleted without userId', async () => {
      await service.recordEntityDeleted(StatisticsEntityType.AGENT, 'agent-uuid');

      expect(statisticsRepository.createStatisticsEntityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: StatisticsEntityEventType.DELETED,
          entityType: StatisticsEntityType.AGENT,
          originalEntityId: 'agent-uuid',
          statisticsUserId: undefined,
        }),
      );
    });
  });
});
