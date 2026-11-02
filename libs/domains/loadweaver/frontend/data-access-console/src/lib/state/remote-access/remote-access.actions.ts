import { createAction, props } from '@ngrx/store';

import type { VpnClient } from '../../types/remote-access.types';

/** `all`: every client in the cluster (infra operators, cluster admins). */
export const loadDevices = createAction('[ConsoleRemoteAccess] Load', props<{ all: boolean; silent?: boolean }>());
export const loadDevicesSuccess = createAction(
  '[ConsoleRemoteAccess] Load Success',
  props<{ all: boolean; devices: VpnClient[] }>(),
);
export const loadDevicesFailure = createAction('[ConsoleRemoteAccess] Load Failure', props<{ error: string }>());

export const revokeDevice = createAction('[ConsoleRemoteAccess] Revoke', props<{ id: string }>());
export const revokeDeviceSuccess = createAction(
  '[ConsoleRemoteAccess] Revoke Success',
  props<{ id: string; revokedAt: string }>(),
);
export const revokeDeviceFailure = createAction(
  '[ConsoleRemoteAccess] Revoke Failure',
  props<{ id: string; error: string }>(),
);
