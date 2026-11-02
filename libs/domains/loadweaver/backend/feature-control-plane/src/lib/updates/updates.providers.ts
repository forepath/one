import { AptFileEntity, AptSnapshotEntity } from './apt.entity';
import { AptSnapshotService } from './apt-snapshot.service';
import { APT_SNAPSHOT_READER } from './apt-snapshot-reader';
import { ArtifactStore } from './artifact-store';
import { BundleService } from './bundle.service';
import { ContractMigrationService } from './contract-migration.service';
import { ReleaseEntity } from './release.entity';
import { ReleasesService } from './releases.service';
import { RolloutEntity, RolloutStepEntity } from './rollout.entity';
import { RolloutControllerService } from './rollout-controller.service';
import { RolloutService } from './rollout.service';
import { UpdateFilesController, UpdatesController } from './updates.controller';
import { UpdatePolicyService } from './update-policy.service';

/** Update rollout (3.26): entities, controllers and services of `updates/`, registered by the control-plane module. */
export const UPDATES_ENTITIES = [ReleaseEntity, RolloutEntity, RolloutStepEntity, AptSnapshotEntity, AptFileEntity];

export const UPDATES_CONTROLLERS = [UpdatesController, UpdateFilesController];

export const UPDATES_PROVIDERS = [
  ArtifactStore,
  AptSnapshotService,
  // Token view for the node installer (breaks an import cycle, see apt-snapshot-reader.ts).
  { provide: APT_SNAPSHOT_READER, useExisting: AptSnapshotService },
  BundleService,
  ReleasesService,
  RolloutService,
  RolloutControllerService,
  UpdatePolicyService,
  ContractMigrationService,
];
