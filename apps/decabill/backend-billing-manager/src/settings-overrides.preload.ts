import {
  BILLING_SETTINGS,
  BillingSettingsOverrideEntity,
  toBillingSettingsOverrideRecord,
} from '@forepath/decabill/backend';
import { preloadSettingsOverrides } from '@forepath/shared/backend/util-settings-overrides';
import { Logger } from '@nestjs/common';

import { typeormConfig } from './typeorm.config';

/** Console settings overrides apply before the application reads its configuration. */
export async function preloadBillingSettingsOverrides(): Promise<void> {
  const logger = new Logger('SettingsOverridesBootstrap');

  await preloadSettingsOverrides({
    dataSourceOptions: typeormConfig,
    entity: BillingSettingsOverrideEntity,
    definitions: BILLING_SETTINGS,
    toRecord: toBillingSettingsOverrideRecord,
    logger: { log: (message) => logger.log(message), warn: (message) => logger.warn(message) },
  });
}
