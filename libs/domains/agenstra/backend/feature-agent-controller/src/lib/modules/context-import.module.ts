import {
  AGENSTRA_EXTENSION_KINDS,
  AgenstraPluginHostModule,
  EXTERNAL_IMPORT_PROVIDER_REGISTRY,
  ExternalImportDepsModule,
} from '@forepath/agenstra/backend/util-plugin-host';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContextImportController } from '../controllers/context-import.controller';
import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportSyncMarkerEntity } from '../entities/external-import-sync-marker.entity';
import { AtlassianSiteConnectionService } from '../services/atlassian-site-connection.service';
import { ContextImportOrchestratorService } from '../services/context-import-orchestrator.service';
import { ExternalImportConfigService } from '../services/external-import-config.service';
import { ExternalImportSyncMarkerService } from '../services/external-import-sync-marker.service';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';
import { TicketsService } from '../services/tickets.service';

import { ClientsModule } from './clients.module';

const DEFAULT_EXTERNAL_IMPORT_PROVIDERS = ['@forepath/agenstra/backend/provider-atlassian-import'] as const;

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AtlassianSiteConnectionEntity,
      ExternalImportConfigEntity,
      ExternalImportSyncMarkerEntity,
    ]),
    forwardRef(() => ClientsModule),
    ExternalImportDepsModule.forRoot({
      imports: [TypeOrmModule.forFeature([AtlassianSiteConnectionEntity]), forwardRef(() => ClientsModule)],
      providers: [ExternalImportSyncMarkerService],
      exports: [ExternalImportSyncMarkerService, TicketsService, KnowledgeTreeService],
    }),
    AgenstraPluginHostModule.forRootAsync({
      kind: AGENSTRA_EXTENSION_KINDS.EXTERNAL_IMPORT_PROVIDER,
      registryToken: EXTERNAL_IMPORT_PROVIDER_REGISTRY,
      extensionsEnvKey: 'AGENSTRA_EXTERNAL_IMPORT_PROVIDER_EXTENSIONS',
      defaultExtensions: DEFAULT_EXTERNAL_IMPORT_PROVIDERS,
    }),
  ],
  controllers: [ContextImportController],
  providers: [
    ExternalImportSyncMarkerService,
    AtlassianSiteConnectionService,
    ExternalImportConfigService,
    ContextImportOrchestratorService,
  ],
  exports: [ExternalImportSyncMarkerService, ContextImportOrchestratorService, ExternalImportConfigService],
})
export class ContextImportModule {}
