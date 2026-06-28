import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CloudInitConfigResponse,
  CreateCloudInitConfigDto,
  ListParams,
  UpdateCloudInitConfigDto,
} from '../../types/billing.types';

import {
  clearSelectedCloudInitConfig,
  createCloudInitConfig,
  deleteCloudInitConfig,
  loadCloudInitConfig,
  loadCloudInitConfigs,
  updateCloudInitConfig,
} from './cloud-init-configs.actions';
import {
  selectActiveCloudInitConfigs,
  selectCloudInitConfigLoading,
  selectCloudInitConfigsCreating,
  selectCloudInitConfigsDeleting,
  selectCloudInitConfigsEntities,
  selectCloudInitConfigsError,
  selectCloudInitConfigsLoading,
  selectCloudInitConfigsLoadingAny,
  selectCloudInitConfigsUpdating,
  selectSelectedCloudInitConfig,
} from './cloud-init-configs.selectors';

@Injectable({
  providedIn: 'root',
})
export class CloudInitConfigsFacade {
  private readonly store = inject(Store);

  getCloudInitConfigs$(): Observable<CloudInitConfigResponse[]> {
    return this.store.select(selectCloudInitConfigsEntities);
  }

  getActiveCloudInitConfigs$(): Observable<CloudInitConfigResponse[]> {
    return this.store.select(selectActiveCloudInitConfigs);
  }

  getSelectedCloudInitConfig$(): Observable<CloudInitConfigResponse | null> {
    return this.store.select(selectSelectedCloudInitConfig);
  }

  getCloudInitConfigsLoading$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigsLoading);
  }

  getCloudInitConfigLoading$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigLoading);
  }

  getCloudInitConfigsCreating$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigsCreating);
  }

  getCloudInitConfigsUpdating$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigsUpdating);
  }

  getCloudInitConfigsDeleting$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigsDeleting);
  }

  getCloudInitConfigsLoadingAny$(): Observable<boolean> {
    return this.store.select(selectCloudInitConfigsLoadingAny);
  }

  getCloudInitConfigsError$(): Observable<string | null> {
    return this.store.select(selectCloudInitConfigsError);
  }

  loadCloudInitConfigs(params?: ListParams): void {
    this.store.dispatch(loadCloudInitConfigs({ params }));
  }

  loadCloudInitConfig(id: string): void {
    this.store.dispatch(loadCloudInitConfig({ id }));
  }

  createCloudInitConfig(cloudInitConfig: CreateCloudInitConfigDto): void {
    this.store.dispatch(createCloudInitConfig({ cloudInitConfig }));
  }

  updateCloudInitConfig(id: string, cloudInitConfig: UpdateCloudInitConfigDto): void {
    this.store.dispatch(updateCloudInitConfig({ id, cloudInitConfig }));
  }

  deleteCloudInitConfig(id: string): void {
    this.store.dispatch(deleteCloudInitConfig({ id }));
  }

  clearSelectedCloudInitConfig(): void {
    this.store.dispatch(clearSelectedCloudInitConfig());
  }
}
