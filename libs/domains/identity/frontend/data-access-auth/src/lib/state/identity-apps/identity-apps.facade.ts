import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  IdentityAppGrantResponseDto,
  IdentityAppInputDto,
  IdentityAppResponseDto,
} from '../../types/identity-app.types';

import {
  clearIdentityAppSecret,
  clearIdentityAppsError,
  createIdentityApp,
  deleteIdentityApp,
  loadIdentityAppGrants,
  loadIdentityApps,
  loadOwnAppGrants,
  revokeAllIdentityAppGrants,
  revokeIdentityAppGrant,
  revokeOwnAppGrant,
  rotateIdentityAppSecret,
  updateIdentityApp,
} from './identity-apps.actions';
import {
  selectIdentityAppGrants,
  selectIdentityAppGrantsError,
  selectIdentityAppGrantsLoading,
  selectIdentityAppGrantsRevoking,
  selectIdentityAppLastSecret,
  selectIdentityApps,
  selectIdentityAppsDeleting,
  selectIdentityAppsError,
  selectIdentityAppsLoading,
  selectIdentityAppsSaving,
  selectOwnAppGrants,
  selectOwnAppGrantsError,
  selectOwnAppGrantsLoading,
  selectOwnAppGrantsRevoking,
} from './identity-apps.selectors';

@Injectable({
  providedIn: 'root',
})
export class IdentityAppsFacade {
  private readonly store = inject(Store);

  readonly apps$: Observable<IdentityAppResponseDto[]> = this.store.select(selectIdentityApps);
  readonly loading$: Observable<boolean> = this.store.select(selectIdentityAppsLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectIdentityAppsSaving);
  readonly deleting$: Observable<boolean> = this.store.select(selectIdentityAppsDeleting);
  readonly error$: Observable<string | null> = this.store.select(selectIdentityAppsError);
  readonly lastSecret$: Observable<string | null> = this.store.select(selectIdentityAppLastSecret);

  readonly grants$: Observable<IdentityAppGrantResponseDto[]> = this.store.select(selectIdentityAppGrants);
  readonly grantsLoading$: Observable<boolean> = this.store.select(selectIdentityAppGrantsLoading);
  readonly grantsRevoking$: Observable<boolean> = this.store.select(selectIdentityAppGrantsRevoking);
  readonly grantsError$: Observable<string | null> = this.store.select(selectIdentityAppGrantsError);

  readonly ownGrants$: Observable<IdentityAppGrantResponseDto[]> = this.store.select(selectOwnAppGrants);
  readonly ownGrantsLoading$: Observable<boolean> = this.store.select(selectOwnAppGrantsLoading);
  readonly ownGrantsRevoking$: Observable<boolean> = this.store.select(selectOwnAppGrantsRevoking);
  readonly ownGrantsError$: Observable<string | null> = this.store.select(selectOwnAppGrantsError);

  load(): void {
    this.store.dispatch(loadIdentityApps());
  }

  create(dto: IdentityAppInputDto): void {
    this.store.dispatch(createIdentityApp({ dto }));
  }

  update(id: string, dto: IdentityAppInputDto): void {
    this.store.dispatch(updateIdentityApp({ id, dto }));
  }

  rotateSecret(id: string): void {
    this.store.dispatch(rotateIdentityAppSecret({ id }));
  }

  remove(id: string): void {
    this.store.dispatch(deleteIdentityApp({ id }));
  }

  clearSecret(): void {
    this.store.dispatch(clearIdentityAppSecret());
  }

  clearError(): void {
    this.store.dispatch(clearIdentityAppsError());
  }

  loadGrants(appId: string): void {
    this.store.dispatch(loadIdentityAppGrants({ appId }));
  }

  revokeGrant(appId: string, grantId: string): void {
    this.store.dispatch(revokeIdentityAppGrant({ appId, grantId }));
  }

  revokeAllGrants(appId: string): void {
    this.store.dispatch(revokeAllIdentityAppGrants({ appId }));
  }

  loadOwnGrants(): void {
    this.store.dispatch(loadOwnAppGrants());
  }

  revokeOwnGrant(grantId: string): void {
    this.store.dispatch(revokeOwnAppGrant({ grantId }));
  }
}
