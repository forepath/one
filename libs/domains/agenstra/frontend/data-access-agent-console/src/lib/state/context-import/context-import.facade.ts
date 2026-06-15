import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearAtlassianConnectionTestResult,
  clearAtlassianContextImportError,
  clearExternalImportMarkers,
  createAtlassianConnection,
  createExternalImportConfig,
  deleteAtlassianConnection,
  deleteExternalImportConfig,
  loadAtlassianContextImport,
  runExternalImportConfig,
  testAtlassianConnection,
  updateAtlassianConnection,
  updateExternalImportConfig,
} from './context-import.actions';
import {
  selectAtlassianConnections,
  selectAtlassianContextImportClearingMarkersId,
  selectAtlassianContextImportDeleting,
  selectAtlassianContextImportError,
  selectAtlassianContextImportLoading,
  selectAtlassianContextImportRunningConfigId,
  selectAtlassianContextImportSaving,
  selectAtlassianContextImportTestingConnectionId,
  selectAtlassianLastConnectionTest,
  selectExternalImportConfigs,
} from './context-import.selectors';
import type {
  AtlassianConnectionTestResultDto,
  CreateAtlassianSiteConnectionDto,
  CreateExternalImportConfigDto,
  UpdateAtlassianSiteConnectionDto,
  UpdateExternalImportConfigDto,
} from './context-import.types';

@Injectable({
  providedIn: 'root',
})
export class AtlassianContextImportFacade {
  private readonly store = inject(Store);

  readonly connections$ = this.store.select(selectAtlassianConnections);
  readonly configs$ = this.store.select(selectExternalImportConfigs);
  readonly loading$ = this.store.select(selectAtlassianContextImportLoading);
  readonly error$ = this.store.select(selectAtlassianContextImportError);
  readonly saving$ = this.store.select(selectAtlassianContextImportSaving);
  readonly deleting$ = this.store.select(selectAtlassianContextImportDeleting);
  readonly runningConfigId$ = this.store.select(selectAtlassianContextImportRunningConfigId);
  readonly testingConnectionId$ = this.store.select(selectAtlassianContextImportTestingConnectionId);
  readonly clearingMarkersId$ = this.store.select(selectAtlassianContextImportClearingMarkersId);
  readonly lastConnectionTest$: Observable<{ connectionId: string; result: AtlassianConnectionTestResultDto } | null> =
    this.store.select(selectAtlassianLastConnectionTest);

  load(): void {
    this.store.dispatch(loadAtlassianContextImport());
  }

  createConnection(dto: CreateAtlassianSiteConnectionDto): void {
    this.store.dispatch(createAtlassianConnection({ dto }));
  }

  updateConnection(id: string, dto: UpdateAtlassianSiteConnectionDto): void {
    this.store.dispatch(updateAtlassianConnection({ id, dto }));
  }

  deleteConnection(id: string): void {
    this.store.dispatch(deleteAtlassianConnection({ id }));
  }

  testConnection(id: string): void {
    this.store.dispatch(testAtlassianConnection({ id }));
  }

  createConfig(dto: CreateExternalImportConfigDto): void {
    this.store.dispatch(createExternalImportConfig({ dto }));
  }

  updateConfig(id: string, dto: UpdateExternalImportConfigDto): void {
    this.store.dispatch(updateExternalImportConfig({ id, dto }));
  }

  deleteConfig(id: string): void {
    this.store.dispatch(deleteExternalImportConfig({ id }));
  }

  runConfig(id: string): void {
    this.store.dispatch(runExternalImportConfig({ id }));
  }

  clearMarkers(id: string): void {
    this.store.dispatch(clearExternalImportMarkers({ id }));
  }

  clearError(): void {
    this.store.dispatch(clearAtlassianContextImportError());
  }

  clearTestResult(): void {
    this.store.dispatch(clearAtlassianConnectionTestResult());
  }
}
