import {
  BackupDeletionEntity,
  BackupEntity,
  BackupKeyEntity,
  BackupRepositoryEntity,
  BackupRetentionEntity,
  RestoreEntity,
  RestoreTestEntity,
} from './backup.entities';
import { BackupCommandsService } from './backup-commands.service';
import { BackupKeyService } from './backup-keys.service';
import { BackupRepositoriesService } from './backup-repositories.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { DrEnvelopeService } from './dr-envelope';

/** Backups (3.20): entities, controllers and services of `backups/`, registered by the control-plane module. */
export const BACKUPS_ENTITIES = [
  BackupKeyEntity,
  BackupEntity,
  BackupDeletionEntity,
  RestoreTestEntity,
  BackupRepositoryEntity,
  RestoreEntity,
  BackupRetentionEntity,
];

export const BACKUPS_CONTROLLERS = [BackupsController];

export const BACKUPS_PROVIDERS = [
  BackupKeyService,
  DrEnvelopeService,
  BackupRepositoriesService,
  BackupCommandsService,
  BackupSchedulerService,
  BackupsService,
];
