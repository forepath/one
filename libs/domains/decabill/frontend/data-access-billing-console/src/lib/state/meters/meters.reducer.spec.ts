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
import { initialMetersState, metersReducer } from './meters.reducer';

describe('metersReducer', () => {
  const meter: MeterResponse = {
    id: 'meter-1',
    key: 'api_calls',
    name: 'API Calls',
    aggregator: 'max',
    defaultUnitPriceNet: 0.01,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('returns the initial state', () => {
    expect(metersReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialMetersState);
  });

  it('loads meters', () => {
    const loading = metersReducer(initialMetersState, loadMeters({}));
    const batched = metersReducer(loading, loadMetersBatch({ offset: 10, accumulatedMeters: [meter] }));
    const loaded = metersReducer(batched, loadMetersSuccess({ meters: [meter] }));

    expect(loading.loading).toBe(true);
    expect(batched.entities).toEqual([meter]);
    expect(loaded.entities).toEqual([meter]);
    expect(loaded.loading).toBe(false);
  });

  it('stores load failures', () => {
    const state = metersReducer({ ...initialMetersState, loading: true }, loadMetersFailure({ error: 'Load failed' }));

    expect(state.error).toBe('Load failed');
    expect(state.loading).toBe(false);
  });

  it('loads a single meter into selection and entities', () => {
    const loading = metersReducer(initialMetersState, loadMeter({ id: meter.id }));
    const loaded = metersReducer(loading, loadMeterSuccess({ meter }));
    const replaced = metersReducer(loaded, loadMeterSuccess({ meter: { ...meter, name: 'Replaced' } }));
    const failed = metersReducer(replaced, loadMeterFailure({ error: 'Missing' }));

    expect(loading.loadingMeter).toBe(true);
    expect(loaded.selectedMeter).toEqual(meter);
    expect(loaded.entities).toEqual([meter]);
    expect(replaced.entities[0].name).toBe('Replaced');
    expect(failed.error).toBe('Missing');
    expect(failed.loadingMeter).toBe(false);
  });

  it('adds, updates, and deletes meters', () => {
    const creating = metersReducer(initialMetersState, createMeter({ meter: {} as never }));
    const created = metersReducer(creating, createMeterSuccess({ meter }));
    const createFailed = metersReducer(creating, createMeterFailure({ error: 'Create failed' }));
    const updating = metersReducer(created, updateMeter({ id: meter.id, meter: {} }));
    const updated = metersReducer(updating, updateMeterSuccess({ meter: { ...meter, name: 'Updated' } }));
    const updateFailed = metersReducer(updating, updateMeterFailure({ error: 'Update failed' }));
    const deleting = metersReducer(updated, deleteMeter({ id: meter.id }));
    const deleted = metersReducer(deleting, deleteMeterSuccess({ id: meter.id }));
    const deleteFailed = metersReducer(deleting, deleteMeterFailure({ error: 'Delete failed' }));
    const cleared = metersReducer(created, clearSelectedMeter());

    expect(created.entities).toEqual([meter]);
    expect(createFailed.creating).toBe(false);
    expect(updated.entities[0].name).toBe('Updated');
    expect(updateFailed.updating).toBe(false);
    expect(deleted.entities).toEqual([]);
    expect(deleteFailed.deleting).toBe(false);
    expect(cleared.selectedMeter).toBeNull();
  });
});
