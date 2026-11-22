import {
  CONTROLLER_SETTINGS,
  ControllerSettingsOverrideEntity,
  toControllerSettingsOverrideRecord,
} from '@forepath/agenstra/backend/feature-agent-controller';
import { preloadSettingsOverrides } from '@forepath/shared/backend/util-settings-overrides';
import { Logger } from '@nestjs/common';

import { typeormConfig } from './typeorm.config';

/** Console settings overrides apply before the application reads its configuration. */
export async function preloadControllerSettingsOverrides(): Promise<void> {
  const logger = new Logger('SettingsOverridesBootstrap');

  await preloadSettingsOverrides({
    dataSourceOptions: typeormConfig,
    entity: ControllerSettingsOverrideEntity,
    definitions: CONTROLLER_SETTINGS,
    toRecord: toControllerSettingsOverrideRecord,
    logger: { log: (message) => logger.log(message), warn: (message) => logger.warn(message) },
  });
}
