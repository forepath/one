import {
  ClientAgentCredentialEntity,
  ClientAgentCredentialsRepository,
  ClientAgentCredentialsService,
  ClientEntity,
  ClientUserEntity,
  getAuthenticationMethod,
  KeycloakTokenService,
  RevokedUserTokenEntity,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KEYCLOAK_CONNECT_OPTIONS, KEYCLOAK_INSTANCE } from 'nest-keycloak-connect';

import { ClientsController } from '../controllers/clients.controller';
import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { KnowledgeNodeEmbeddingEntity } from '../entities/knowledge-node-embedding.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgePageActivityEntity } from '../entities/knowledge-page-activity.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';
import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import { StatisticsClientUserEntity } from '../entities/statistics-client-user.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import { StatisticsProvisioningReferenceEntity } from '../entities/statistics-provisioning-reference.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketBodyGenerationSessionEntity } from '../entities/ticket-body-generation-session.entity';
import { TicketCommentEntity } from '../entities/ticket-comment.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { UserEnvironmentReadStateEntity } from '../entities/user-environment-read-state.entity';
import { ClientsGateway } from '../gateways/clients.gateway';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { ClientsService } from '../services/clients.service';
import { ExternalImportSyncMarkerService } from '../services/external-import-sync-marker.service';

import { ClientsModule } from './clients.module';
import { ContextImportModule } from './context-import.module';
import { FilterRulesModule } from './filter-rules.module';

@Module({})
class StubFilterRulesModule {}

@Module({
  providers: [
    {
      provide: ExternalImportSyncMarkerService,
      useValue: {
        applyTicketDeleteInTransaction: jest.fn().mockResolvedValue(undefined),
        applyKnowledgeNodeDeleteInTransaction: jest.fn().mockResolvedValue(undefined),
      },
    },
  ],
  exports: [ExternalImportSyncMarkerService],
})
class StubContextImportModule {}

describe('ClientsModule', () => {
  let module: TestingModule;
  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    findByKeycloakSub: jest.fn().mockResolvedValue(null),
  };
  const mockTicketRepository = {
    ...mockRepository,
    manager: {
      transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => {
        const em = {
          getRepository: jest.fn(() => ({
            save: jest.fn((x: unknown) => Promise.resolve(x)),
            create: jest.fn((x: unknown) => x),
            delete: jest.fn().mockResolvedValue(undefined),
          })),
        };

        return fn(em);
      }),
      query: jest.fn().mockResolvedValue([]),
    },
    createQueryBuilder: jest.fn().mockReturnValue({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
  const mockKeycloakInstance = {
    grantManager: {
      createGrant: jest.fn(),
      validateAccessToken: jest.fn(),
      validateToken: jest.fn(),
    },
  };
  const mockKeycloakOptions = {
    tokenValidation: 'ONLINE' as const,
  };

  beforeEach(async () => {
    const authMethod = getAuthenticationMethod();
    const moduleBuilder = Test.createTestingModule({
      imports: [ClientsModule],
    })
      .overrideModule(FilterRulesModule)
      .useModule(StubFilterRulesModule)
      .overrideModule(ContextImportModule)
      .useModule(StubContextImportModule)
      .overrideProvider(getRepositoryToken(ClientEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(ClientAgentCredentialEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(ProvisioningReferenceEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(ClientUserEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(UserEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(RevokedUserTokenEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsUserEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsClientEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsAgentEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsProvisioningReferenceEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsClientUserEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsChatIoEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsChatFilterDropEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsChatFilterFlagEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(StatisticsEntityEventEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketEntity))
      .useValue(mockTicketRepository)
      .overrideProvider(getRepositoryToken(TicketCommentEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketActivityEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketBodyGenerationSessionEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketAutomationEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketAutomationRunEntity))
      .useValue(mockTicketRepository)
      .overrideProvider(getRepositoryToken(TicketAutomationLeaseEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(TicketAutomationRunStepEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(ClientAgentAutonomyEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(KnowledgeNodeEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(KnowledgeNodeEmbeddingEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(KnowledgeRelationEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(KnowledgePageActivityEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(UserEnvironmentReadStateEntity))
      .useValue(mockRepository)
      .overrideProvider(UsersRepository)
      .useValue(mockRepository);

    // Mock Keycloak providers if auth method is keycloak
    if (authMethod === 'keycloak') {
      moduleBuilder
        .overrideProvider(KEYCLOAK_INSTANCE)
        .useValue(mockKeycloakInstance)
        .overrideProvider(KEYCLOAK_CONNECT_OPTIONS)
        .useValue(mockKeycloakOptions);
    }

    module = await moduleBuilder.compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide ClientsService', () => {
    const service = module.get<ClientsService>(ClientsService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ClientsService);
  });

  it('should provide ClientsRepository', () => {
    const repository = module.get<ClientsRepository>(ClientsRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(ClientsRepository);
  });

  it('should provide ClientsController', () => {
    const controller = module.get<ClientsController>(ClientsController);

    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(ClientsController);
  });

  it('should export ClientsService', () => {
    const service = module.get<ClientsService>(ClientsService);

    expect(service).toBeDefined();
  });

  it('should export ClientsRepository', () => {
    const repository = module.get<ClientsRepository>(ClientsRepository);

    expect(repository).toBeDefined();
  });

  it('should provide KeycloakTokenService', () => {
    const service = module.get<KeycloakTokenService>(KeycloakTokenService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(KeycloakTokenService);
  });

  it('should export KeycloakTokenService', () => {
    const service = module.get<KeycloakTokenService>(KeycloakTokenService);

    expect(service).toBeDefined();
  });

  it('should provide ClientAgentProxyService', () => {
    const service = module.get<ClientAgentProxyService>(ClientAgentProxyService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ClientAgentProxyService);
  });

  it('should export ClientAgentProxyService', () => {
    const service = module.get<ClientAgentProxyService>(ClientAgentProxyService);

    expect(service).toBeDefined();
  });

  it('should provide ClientsGateway', () => {
    const gw = module.get<ClientsGateway>(ClientsGateway);

    expect(gw).toBeDefined();
    expect(gw).toBeInstanceOf(ClientsGateway);
  });

  it('should export ClientsGateway', () => {
    const gw = module.get<ClientsGateway>(ClientsGateway);

    expect(gw).toBeDefined();
  });

  it('should provide ClientAgentCredentialsRepository', () => {
    const repository = module.get<ClientAgentCredentialsRepository>(ClientAgentCredentialsRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(ClientAgentCredentialsRepository);
  });

  it('should provide ClientAgentCredentialsService', () => {
    const service = module.get<ClientAgentCredentialsService>(ClientAgentCredentialsService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ClientAgentCredentialsService);
  });

  it('should export ClientAgentCredentialsService', () => {
    const service = module.get<ClientAgentCredentialsService>(ClientAgentCredentialsService);

    expect(service).toBeDefined();
  });

  it('should provide ClientAgentFileSystemProxyService', () => {
    const service = module.get<ClientAgentFileSystemProxyService>(ClientAgentFileSystemProxyService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ClientAgentFileSystemProxyService);
  });

  it('should export ClientAgentFileSystemProxyService', () => {
    const service = module.get<ClientAgentFileSystemProxyService>(ClientAgentFileSystemProxyService);

    expect(service).toBeDefined();
  });

  it('should provide SocketAuthService', () => {
    const service = module.get<SocketAuthService>(SocketAuthService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(SocketAuthService);
  });

  it('should provide SocketAuthService with optional Keycloak dependencies', () => {
    const service = module.get<SocketAuthService>(SocketAuthService);

    expect(service).toBeDefined();
    // SocketAuthService should be instantiated even if Keycloak is not configured
    expect(service).toBeInstanceOf(SocketAuthService);
  });

  describe('when authentication method is keycloak', () => {
    beforeEach(() => {
      // Ensure we're testing with keycloak auth method
      // Note: This test will only run if AUTHENTICATION_METHOD=keycloak in test environment
    });

    it('should provide KEYCLOAK_INSTANCE when auth method is keycloak', () => {
      const authMethod = getAuthenticationMethod();

      if (authMethod === 'keycloak') {
        const keycloakInstance = module.get(KEYCLOAK_INSTANCE);

        expect(keycloakInstance).toBeDefined();
        expect(keycloakInstance).toEqual(mockKeycloakInstance);
      }
    });

    it('should provide KEYCLOAK_CONNECT_OPTIONS when auth method is keycloak', () => {
      const authMethod = getAuthenticationMethod();

      if (authMethod === 'keycloak') {
        const keycloakOptions = module.get(KEYCLOAK_CONNECT_OPTIONS);

        expect(keycloakOptions).toBeDefined();
        expect(keycloakOptions).toEqual(mockKeycloakOptions);
      }
    });
  });
});
