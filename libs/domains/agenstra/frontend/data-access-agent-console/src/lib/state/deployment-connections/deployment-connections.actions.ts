import type { ConnectionTestResult, DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { createAction, props } from '@ngrx/store';

import type {
  CreateDeploymentConnectionDto,
  DeploymentConnectionsQuery,
  UpdateDeploymentConnectionDto,
} from './deployment-connections.types';

export const loadDeploymentConnections = createAction(
  '[Deployment Connections] Load',
  props<{ query: DeploymentConnectionsQuery }>(),
);

export const loadDeploymentConnectionsSuccess = createAction(
  '[Deployment Connections] Load Success',
  props<{ connections: DeploymentConnectionSummary[]; hasNext: boolean }>(),
);

export const loadDeploymentConnectionsFailure = createAction(
  '[Deployment Connections] Load Failure',
  props<{ error: string }>(),
);

export const createDeploymentConnection = createAction(
  '[Deployment Connections] Create',
  props<{ dto: CreateDeploymentConnectionDto }>(),
);

export const createDeploymentConnectionSuccess = createAction(
  '[Deployment Connections] Create Success',
  props<{ connection: DeploymentConnectionSummary }>(),
);

export const updateDeploymentConnection = createAction(
  '[Deployment Connections] Update',
  props<{ id: string; dto: UpdateDeploymentConnectionDto }>(),
);

export const updateDeploymentConnectionSuccess = createAction(
  '[Deployment Connections] Update Success',
  props<{ connection: DeploymentConnectionSummary }>(),
);

export const deleteDeploymentConnection = createAction('[Deployment Connections] Delete', props<{ id: string }>());

export const deleteDeploymentConnectionSuccess = createAction(
  '[Deployment Connections] Delete Success',
  props<{ id: string }>(),
);

/** Create / update / delete failures (e.g. the 409 "Connection is used by N deployment workflows"). */
export const saveDeploymentConnectionFailure = createAction(
  '[Deployment Connections] Save Failure',
  props<{ error: string }>(),
);

export const testDeploymentConnection = createAction('[Deployment Connections] Test', props<{ id: string }>());

export const testDeploymentConnectionSuccess = createAction(
  '[Deployment Connections] Test Success',
  props<{ id: string; result: ConnectionTestResult }>(),
);

export const testDeploymentConnectionFailure = createAction(
  '[Deployment Connections] Test Failure',
  props<{ id: string; error: string }>(),
);

export const clearDeploymentConnectionsError = createAction('[Deployment Connections] Clear Error');

export const clearDeploymentConnectionTestResult = createAction('[Deployment Connections] Clear Test Result');
