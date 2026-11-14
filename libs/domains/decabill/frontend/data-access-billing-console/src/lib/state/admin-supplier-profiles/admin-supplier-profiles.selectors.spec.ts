import { initialAdminSupplierProfilesState } from './admin-supplier-profiles.reducer';
import {
  selectAdminSupplierProfiles,
  selectAdminSupplierProfilesCreating,
  selectAdminSupplierProfilesLoading,
} from './admin-supplier-profiles.selectors';

describe('adminSupplierProfilesSelectors', () => {
  const profile = {
    id: 'supplier-1',
    supplierNumber: 'S-00001',
    isComplete: true,
    createdAt: '',
    updatedAt: '',
  };

  it('selectAdminSupplierProfiles returns profiles', () => {
    expect(
      selectAdminSupplierProfiles.projector({
        ...initialAdminSupplierProfilesState,
        profiles: [profile],
      }),
    ).toEqual([profile]);
  });

  it('selectAdminSupplierProfilesLoading returns loading flag', () => {
    expect(
      selectAdminSupplierProfilesLoading.projector({
        ...initialAdminSupplierProfilesState,
        loading: true,
      }),
    ).toBe(true);
  });

  it('selectAdminSupplierProfilesCreating returns creating flag', () => {
    expect(
      selectAdminSupplierProfilesCreating.projector({
        ...initialAdminSupplierProfilesState,
        creating: true,
      }),
    ).toBe(true);
  });
});
