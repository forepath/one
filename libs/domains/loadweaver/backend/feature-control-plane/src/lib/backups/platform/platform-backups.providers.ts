import { DrController } from './dr.controller';
import { DrRecoveryService } from './dr-recovery.service';
import { PlatformBackupsController } from './platform-backups.controller';
import {
  PlatformBackupGrantEntity,
  PlatformBackupStateEntity,
  PlatformRestoreEntity,
} from './platform-backups.entities';
import { PlatformBackupsService } from './platform-backups.service';
import { PlatformCopyService } from './platform-copy.service';
import { PlatformCutoverService } from './platform-cutover.service';
import {
  DrRecoveryEntity,
  PlatformCopyEntity,
  PlatformCopyTargetEntity,
  PlatformCutoverEntity,
} from './platform-dr.entities';
import { PlatformObjectStore } from './platform-object-store';
import { PlatformS3GatewayService } from './s3-gateway.service';

/** Control-plane data backups (3.20): entities, controllers and services of `backups/platform/`. */
export const PLATFORM_BACKUPS_ENTITIES = [
  PlatformBackupStateEntity,
  PlatformBackupGrantEntity,
  PlatformRestoreEntity,
  // Disaster recovery and the remaining backup gaps (3.20, step 3c).
  PlatformCopyEntity,
  PlatformCopyTargetEntity,
  PlatformCutoverEntity,
  DrRecoveryEntity,
];

export const PLATFORM_BACKUPS_CONTROLLERS = [PlatformBackupsController, DrController];

export const PLATFORM_BACKUPS_PROVIDERS = [
  PlatformObjectStore,
  PlatformS3GatewayService,
  PlatformCopyService,
  PlatformBackupsService,
  PlatformCutoverService,
  DrRecoveryService,
];
