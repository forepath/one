import {
  createAdminSupplierProfile,
  createAdminSupplierProfileFailure,
  createAdminSupplierProfileSuccess,
  deleteAdminSupplierProfileSuccess,
  loadAdminSupplierProfiles,
  loadAdminSupplierProfilesFailure,
  loadAdminSupplierProfilesSuccess,
} from './admin-supplier-profiles.actions';
import { adminSupplierProfilesReducer, initialAdminSupplierProfilesState } from './admin-supplier-profiles.reducer';

describe('adminSupplierProfilesReducer', () => {
  const listItem = {
    id: 'supplier-1',
    supplierNumber: 'S-00001',
    company: 'Acme GmbH',
    isComplete: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
  };

  it('sets loading on loadAdminSupplierProfiles', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, profiles: [listItem] },
      loadAdminSupplierProfiles({ search: 'acme', page: 2, pageSize: 50 }),
    );

    expect(state.loading).toBe(true);
    // Replace-page: the current rows stay until the requested page arrives.
    expect(state.profiles).toEqual([listItem]);
    expect(state.search).toBe('acme');
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(50);
  });

  it('stores profiles on loadAdminSupplierProfilesSuccess', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, loading: true },
      loadAdminSupplierProfilesSuccess({ profiles: [listItem], total: 77 }),
    );

    expect(state.loading).toBe(false);
    expect(state.profiles).toEqual([listItem]);
    expect(state.total).toBe(77);
  });

  it('stores error on loadAdminSupplierProfilesFailure', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, loading: true },
      loadAdminSupplierProfilesFailure({ error: 'failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('prepends created profile on createAdminSupplierProfileSuccess', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, creating: true },
      createAdminSupplierProfileSuccess({
        profile: {
          ...listItem,
          numberScope: 'tenant',
          customData: {},
        },
      }),
    );

    expect(state.creating).toBe(false);
    expect(state.profiles[0].id).toBe('supplier-1');
  });

  it('sets creating on createAdminSupplierProfile', () => {
    const state = adminSupplierProfilesReducer(
      initialAdminSupplierProfilesState,
      createAdminSupplierProfile({ dto: { company: 'Acme' } }),
    );

    expect(state.creating).toBe(true);
  });

  it('clears creating on createAdminSupplierProfileFailure', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, creating: true },
      createAdminSupplierProfileFailure({ error: 'duplicate' }),
    );

    expect(state.creating).toBe(false);
    expect(state.error).toBe('duplicate');
  });

  it('removes profile on deleteAdminSupplierProfileSuccess', () => {
    const state = adminSupplierProfilesReducer(
      { ...initialAdminSupplierProfilesState, profiles: [listItem], deleting: true },
      deleteAdminSupplierProfileSuccess({ id: 'supplier-1' }),
    );

    expect(state.deleting).toBe(false);
    expect(state.profiles).toEqual([]);
  });
});
