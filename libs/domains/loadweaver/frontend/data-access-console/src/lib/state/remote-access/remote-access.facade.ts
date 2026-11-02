import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadDevices, revokeDevice } from './remote-access.actions';
import {
  selectDevices,
  selectDevicesAll,
  selectDevicesError,
  selectDevicesLoading,
  selectRestrictedDeviceCount,
  selectRevokeDeviceError,
  selectRevokingDevice,
} from './remote-access.selectors';

/** Remote access (3.31): enrolled devices and revocation. */
@Injectable()
export class ConsoleRemoteAccessFacade {
  private readonly store = inject(Store);

  readonly devices$ = this.store.select(selectDevices);
  readonly all$ = this.store.select(selectDevicesAll);
  readonly loading$ = this.store.select(selectDevicesLoading);
  readonly error$ = this.store.select(selectDevicesError);
  readonly revoking$ = this.store.select(selectRevokingDevice);
  readonly revokeError$ = this.store.select(selectRevokeDeviceError);
  readonly restrictedCount$ = this.store.select(selectRestrictedDeviceCount);

  /** `silent`: refresh without the loading state. */
  load(all: boolean, silent = false): void {
    this.store.dispatch(loadDevices({ all, silent }));
  }

  revoke(id: string): void {
    this.store.dispatch(revokeDevice({ id }));
  }
}
