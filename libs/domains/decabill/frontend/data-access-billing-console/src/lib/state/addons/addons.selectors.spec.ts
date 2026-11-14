import { initialAddonsState } from './addons.reducer';
import {
  selectActiveAddons,
  selectAddonById,
  selectAddonLoading,
  selectAddonsCreating,
  selectAddonsDeleting,
  selectAddonsEntities,
  selectAddonsError,
  selectAddonsLoading,
  selectAddonsLoadingAny,
  selectAddonsUpdating,
  selectSelectedAddon,
} from './addons.selectors';

describe('addonsSelectors', () => {
  const activeAddon = {
    id: '1',
    key: 'a',
    name: 'Active',
    implementationType: 'module' as const,
    moduleKey: 'a',
    configSchema: {},
    compatibleProviders: [],
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };
  const inactiveAddon = {
    id: '2',
    key: 'b',
    name: 'Inactive',
    implementationType: 'cloud_init_script' as const,
    scriptTemplate: 'echo hi',
    configSchema: {},
    compatibleProviders: [],
    isActive: false,
    createdAt: '',
    updatedAt: '',
  };
  const state = {
    addons: {
      ...initialAddonsState,
      entities: [activeAddon, inactiveAddon],
      selectedAddon: activeAddon,
      loading: true,
      loadingAddon: false,
      creating: false,
      updating: false,
      deleting: false,
      error: 'Load failed',
    },
  };

  it('selects all entities', () => {
    expect(selectAddonsEntities(state)).toHaveLength(2);
  });

  it('selects active addons only', () => {
    expect(selectActiveAddons(state)).toEqual([activeAddon]);
  });

  it('selects selected addon', () => {
    expect(selectSelectedAddon(state)).toEqual(activeAddon);
  });

  it('selects loading flags', () => {
    expect(selectAddonsLoading(state)).toBe(true);
    expect(selectAddonLoading(state)).toBe(false);
    expect(selectAddonsCreating(state)).toBe(false);
    expect(selectAddonsUpdating(state)).toBe(false);
    expect(selectAddonsDeleting(state)).toBe(false);
    expect(selectAddonsLoadingAny(state)).toBe(true);
  });

  it('selects error', () => {
    expect(selectAddonsError(state)).toBe('Load failed');
  });

  it('selects addon by id', () => {
    expect(selectAddonById('2')(state)).toEqual(inactiveAddon);
    expect(selectAddonById('missing')(state)).toBeUndefined();
  });
});
