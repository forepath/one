import { ImportControllerService } from './import-controller.service';
import { ImportController } from './import.controller';
import { ImportSelectionEntity, NodeDiscoveryEntity } from './import.entities';
import { ImportService } from './import.service';

/** Import of existing Docker hosts and former nodes (3.21): entities, controllers and services of `import/`. */
export const IMPORT_ENTITIES = [NodeDiscoveryEntity, ImportSelectionEntity];

export const IMPORT_CONTROLLERS = [ImportController];

export const IMPORT_PROVIDERS = [ImportService, ImportControllerService];
