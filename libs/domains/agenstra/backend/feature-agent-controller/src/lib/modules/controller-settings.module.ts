import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminControllerSettingsController } from '../controllers/admin-controller-settings.controller';
import { ControllerSettingsOverrideEntity } from '../entities/controller-settings-override.entity';
import { ControllerSettingsOverridesRepository } from '../repositories/controller-settings-overrides.repository';
import { ControllerSettingsService } from '../services/controller-settings.service';

/** Console settings (environment variable overrides) of the agent controller. */
@Module({
  imports: [TypeOrmModule.forFeature([ControllerSettingsOverrideEntity])],
  controllers: [AdminControllerSettingsController],
  providers: [ControllerSettingsOverridesRepository, ControllerSettingsService],
  exports: [ControllerSettingsService],
})
export class ControllerSettingsModule {}
