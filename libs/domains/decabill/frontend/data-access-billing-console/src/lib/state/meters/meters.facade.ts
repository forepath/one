import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { CreateMeterDto, ListParams, MeterResponse, UpdateMeterDto } from '../../types/billing.types';

import { clearSelectedMeter, createMeter, deleteMeter, loadMeter, loadMeters, updateMeter } from './meters.actions';
import {
  selectActiveMeters,
  selectMeterLoading,
  selectMetersCreating,
  selectMetersDeleting,
  selectMetersEntities,
  selectMetersError,
  selectMetersLoading,
  selectMetersLoadingAny,
  selectMetersUpdating,
  selectSelectedMeter,
} from './meters.selectors';

@Injectable({
  providedIn: 'root',
})
export class MetersFacade {
  private readonly store = inject(Store);

  getMeters$(): Observable<MeterResponse[]> {
    return this.store.select(selectMetersEntities);
  }

  getActiveMeters$(): Observable<MeterResponse[]> {
    return this.store.select(selectActiveMeters);
  }

  getSelectedMeter$(): Observable<MeterResponse | null> {
    return this.store.select(selectSelectedMeter);
  }

  getMetersLoading$(): Observable<boolean> {
    return this.store.select(selectMetersLoading);
  }

  getMeterLoading$(): Observable<boolean> {
    return this.store.select(selectMeterLoading);
  }

  getMetersCreating$(): Observable<boolean> {
    return this.store.select(selectMetersCreating);
  }

  getMetersUpdating$(): Observable<boolean> {
    return this.store.select(selectMetersUpdating);
  }

  getMetersDeleting$(): Observable<boolean> {
    return this.store.select(selectMetersDeleting);
  }

  getMetersLoadingAny$(): Observable<boolean> {
    return this.store.select(selectMetersLoadingAny);
  }

  getMetersError$(): Observable<string | null> {
    return this.store.select(selectMetersError);
  }

  loadMeters(params?: ListParams): void {
    this.store.dispatch(loadMeters({ params }));
  }

  loadMeter(id: string): void {
    this.store.dispatch(loadMeter({ id }));
  }

  createMeter(meter: CreateMeterDto): void {
    this.store.dispatch(createMeter({ meter }));
  }

  updateMeter(id: string, meter: UpdateMeterDto): void {
    this.store.dispatch(updateMeter({ id, meter }));
  }

  deleteMeter(id: string): void {
    this.store.dispatch(deleteMeter({ id }));
  }

  clearSelectedMeter(): void {
    this.store.dispatch(clearSelectedMeter());
  }
}
