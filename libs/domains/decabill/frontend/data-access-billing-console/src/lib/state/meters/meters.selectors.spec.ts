import {
  selectActiveMeters,
  selectMeterById,
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
import { initialMetersState } from './meters.reducer';

describe('metersSelectors', () => {
  const activeMeter = {
    id: '1',
    key: 'a',
    name: 'Active',
    aggregator: 'max' as const,
    defaultUnitPriceNet: 1,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };
  const inactiveMeter = {
    id: '2',
    key: 'b',
    name: 'Inactive',
    aggregator: 'max' as const,
    defaultUnitPriceNet: 2,
    isActive: false,
    createdAt: '',
    updatedAt: '',
  };
  const state = {
    meters: {
      ...initialMetersState,
      entities: [activeMeter, inactiveMeter],
      selectedMeter: activeMeter,
      loading: true,
      loadingMeter: false,
      creating: false,
      updating: false,
      deleting: false,
      error: 'Load failed',
    },
  };

  it('selects all entities', () => {
    expect(selectMetersEntities(state)).toHaveLength(2);
  });

  it('selects active meters only', () => {
    expect(selectActiveMeters(state)).toEqual([activeMeter]);
  });

  it('selects selected meter', () => {
    expect(selectSelectedMeter(state)).toEqual(activeMeter);
  });

  it('selects loading flags', () => {
    expect(selectMetersLoading(state)).toBe(true);
    expect(selectMeterLoading(state)).toBe(false);
    expect(selectMetersCreating(state)).toBe(false);
    expect(selectMetersUpdating(state)).toBe(false);
    expect(selectMetersDeleting(state)).toBe(false);
    expect(selectMetersLoadingAny(state)).toBe(true);
  });

  it('selects error', () => {
    expect(selectMetersError(state)).toBe('Load failed');
  });

  it('selects meter by id', () => {
    expect(selectMeterById('2')(state)).toEqual(inactiveMeter);
    expect(selectMeterById('missing')(state)).toBeUndefined();
  });
});
