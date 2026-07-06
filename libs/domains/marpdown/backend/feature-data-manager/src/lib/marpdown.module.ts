import { UserEntity } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PresentationAssetsController } from './controllers/presentation-assets.controller';
import { PresentationExportController } from './controllers/presentation-export.controller';
import { PresentationsController } from './controllers/presentations.controller';
import { PresentationAssetEntity } from './entities/presentation-asset.entity';
import { PresentationEntity } from './entities/presentation.entity';
import { PresentationAssetsRepository } from './repositories/presentation-assets.repository';
import { PresentationsRepository } from './repositories/presentations.repository';
import { PresentationAssetsService } from './services/presentation-assets.service';
import { PresentationExportService } from './services/presentation-export.service';
import { PresentationsService } from './services/presentations.service';

@Module({
  imports: [TypeOrmModule.forFeature([PresentationEntity, PresentationAssetEntity, UserEntity])],
  controllers: [PresentationsController, PresentationAssetsController, PresentationExportController],
  providers: [
    PresentationsRepository,
    PresentationAssetsRepository,
    PresentationsService,
    PresentationAssetsService,
    PresentationExportService,
  ],
  exports: [PresentationsService, PresentationAssetsService, PresentationExportService],
})
export class MarpdownModule {}
