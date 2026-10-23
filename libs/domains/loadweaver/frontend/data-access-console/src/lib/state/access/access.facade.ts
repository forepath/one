import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { clearAccess, loadAccess } from './access.actions';
import {
  selectAccessLoaded,
  selectAccessMe,
  selectAccessSettled,
  selectClusterRole,
  selectIsClusterAdmin,
  selectProjects,
  selectSeesInfrastructure,
} from './access.selectors';

@Injectable()
export class ConsoleAccessFacade {
  private readonly store = inject(Store);

  readonly me$ = this.store.select(selectAccessMe);
  readonly loaded$ = this.store.select(selectAccessLoaded);
  readonly settled$ = this.store.select(selectAccessSettled);
  readonly clusterRole$ = this.store.select(selectClusterRole);
  readonly isClusterAdmin$ = this.store.select(selectIsClusterAdmin);
  readonly seesInfrastructure$ = this.store.select(selectSeesInfrastructure);
  readonly projects$ = this.store.select(selectProjects);

  load(): void {
    this.store.dispatch(loadAccess());
  }

  clear(): void {
    this.store.dispatch(clearAccess());
  }
}
