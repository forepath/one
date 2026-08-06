import { createReducer, on } from '@ngrx/store';

import type { MeterResponse } from '../../types/billing.types';

import {
  clearSelectedMeter,
  createMeter,
  createMeterFailure,
  createMeterSuccess,
  deleteMeter,
  deleteMeterFailure,
  deleteMeterSuccess,
  loadMeter,
  loadMeterFailure,
  loadMeters,
  loadMetersBatch,
  loadMetersFailure,
  loadMetersSuccess,
  loadMeterSuccess,
  updateMeter,
  updateMeterFailure,
  updateMeterSuccess,
} from './meters.actions';

export interface MetersState {
  entities: MeterResponse[];
  selectedMeter: MeterResponse | null;
  loading: boolean;
  loadingMeter: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
}

export const initialMetersState: MetersState = {
  entities: [],
  selectedMeter: null,
  loading: false,
  loadingMeter: false,
  creating: false,
  updating: false,
  deleting: false,
  error: null,
};

export const metersReducer = createReducer(
  initialMetersState,
  on(loadMeters, (state) => ({ ...state, entities: [], loading: true, error: null })),
  on(loadMetersBatch, (state, { accumulatedMeters }) => ({
    ...state,
    entities: accumulatedMeters,
    loading: true,
    error: null,
  })),
  on(loadMetersSuccess, (state, { meters }) => ({ ...state, entities: meters, loading: false, error: null })),
  on(loadMetersFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadMeter, (state) => ({ ...state, loadingMeter: true, error: null })),
  on(loadMeterSuccess, (state, { meter }) => ({
    ...state,
    entities: state.entities.some((item) => item.id === meter.id)
      ? state.entities.map((item) => (item.id === meter.id ? meter : item))
      : [...state.entities, meter],
    selectedMeter: meter,
    loadingMeter: false,
    error: null,
  })),
  on(loadMeterFailure, (state, { error }) => ({ ...state, loadingMeter: false, error })),
  on(createMeter, (state) => ({ ...state, creating: true, error: null })),
  on(createMeterSuccess, (state, { meter }) => ({
    ...state,
    entities: [...state.entities, meter],
    selectedMeter: meter,
    creating: false,
    error: null,
  })),
  on(createMeterFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateMeter, (state) => ({ ...state, updating: true, error: null })),
  on(updateMeterSuccess, (state, { meter }) => ({
    ...state,
    entities: state.entities.map((item) => (item.id === meter.id ? meter : item)),
    selectedMeter: state.selectedMeter?.id === meter.id ? meter : state.selectedMeter,
    updating: false,
    error: null,
  })),
  on(updateMeterFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteMeter, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteMeterSuccess, (state, { id }) => ({
    ...state,
    entities: state.entities.filter((item) => item.id !== id),
    selectedMeter: state.selectedMeter?.id === id ? null : state.selectedMeter,
    deleting: false,
    error: null,
  })),
  on(deleteMeterFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(clearSelectedMeter, (state) => ({ ...state, selectedMeter: null })),
);
