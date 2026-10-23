import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateWallboardTokenRequest } from '../../types/wallboards.types';
import {
  clearCreatedWallboard,
  createWallboard,
  loadKiosk,
  loadWallboards,
  revokeWallboard,
} from './wallboards.actions';
import {
  selectCreatedWallboard,
  selectCreatingWallboard,
  selectKiosk,
  selectKioskError,
  selectKioskLoading,
  selectKioskUnauthorized,
  selectKioskUpdatedAt,
  selectRevokingWallboard,
  selectWallboards,
  selectWallboardsError,
  selectWallboardsLoading,
  selectWallboardTokenError,
} from './wallboards.selectors';

/** Wallboards (3.25): tokens for the kiosk view, and the kiosk itself. */
@Injectable()
export class ConsoleWallboardsFacade {
  private readonly store = inject(Store);

  readonly tokens$ = this.store.select(selectWallboards);
  readonly loading$ = this.store.select(selectWallboardsLoading);
  readonly error$ = this.store.select(selectWallboardsError);
  readonly creating$ = this.store.select(selectCreatingWallboard);
  readonly created$ = this.store.select(selectCreatedWallboard);
  readonly revoking$ = this.store.select(selectRevokingWallboard);
  readonly tokenError$ = this.store.select(selectWallboardTokenError);
  readonly kiosk$ = this.store.select(selectKiosk);
  readonly kioskLoading$ = this.store.select(selectKioskLoading);
  readonly kioskError$ = this.store.select(selectKioskError);
  readonly kioskUnauthorized$ = this.store.select(selectKioskUnauthorized);
  readonly kioskUpdatedAt$ = this.store.select(selectKioskUpdatedAt);

  load(): void {
    this.store.dispatch(loadWallboards());
  }

  create(request: CreateWallboardTokenRequest): void {
    this.store.dispatch(createWallboard({ request }));
  }

  clearCreated(): void {
    this.store.dispatch(clearCreatedWallboard());
  }

  revoke(id: string): void {
    this.store.dispatch(revokeWallboard({ id }));
  }

  /** `silent`: refresh without the loading state. */
  loadKiosk(token: string, silent = false): void {
    this.store.dispatch(loadKiosk({ token, silent }));
  }
}
