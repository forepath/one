import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContextImportController } from '../controllers/context-import.controller';
import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportSyncMarkerEntity } from '../entities/external-import-sync-marker.entity';
import { ExternalImportProviderFactory } from '../providers/external-import-provider.factory';
import { CONTEXT_IMPORT_PROVIDERS } from '../providers/external-import-provider.tokens';
import { AtlassianImportProvider } from '../providers/import/atlassian-external-import.provider';
import { AtlassianSiteConnectionService } from '../services/atlassian-site-connection.service';
import { ContextImportOrchestratorService } from '../services/context-import-orchestrator.service';
import { ExternalImportConfigService } from '../services/external-import-config.service';
import { ExternalImportSyncMarkerService } from '../services/external-import-sync-marker.service';

import { ClientsModule } from './clients.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AtlassianSiteConnectionEntity,
      ExternalImportConfigEntity,
      ExternalImportSyncMarkerEntity,
    ]),
    forwardRef(() => ClientsModule),
  ],
  controllers: [ContextImportController],
  providers: [
    ExternalImportProviderFactory,
    ExternalImportSyncMarkerService,
    AtlassianSiteConnectionService,
    ExternalImportConfigService,
    ContextImportOrchestratorService,
    AtlassianImportProvider,
    {
      provide: CONTEXT_IMPORT_PROVIDERS,
      useFactory: (factory: ExternalImportProviderFactory, atlassian: AtlassianImportProvider) => {
        factory.registerProvider(atlassian);

        return factory;
      },
      inject: [ExternalImportProviderFactory, AtlassianImportProvider],
    },
  ],
  exports: [ExternalImportSyncMarkerService, ContextImportOrchestratorService, ExternalImportConfigService],
})
export class ContextImportModule {}
