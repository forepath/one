import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminCustomerProfilesService } from '../../services/admin-customer-profiles.service';

import {
  createAdminCustomerProfile,
  createAdminCustomerProfileFailure,
  createAdminCustomerProfileSuccess,
  deleteAdminCustomerProfile,
  deleteAdminCustomerProfileFailure,
  deleteAdminCustomerProfileSuccess,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  saveAdminCustomerProfileCustomData,
  saveAdminCustomerProfileCustomDataFailure,
  saveAdminCustomerProfileCustomDataSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';
import {
  createAdminCustomerProfile$,
  deleteAdminCustomerProfile$,
  loadAdminCustomerProfiles$,
  loadAdminCustomerProfileTrustScore$,
  recomputeAdminCustomerProfileTrustScore$,
  saveAdminCustomerProfileCustomData$,
  updateAdminCustomerProfile$,
} from './admin-customer-profiles.effects';

describe('AdminCustomerProfilesEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<AdminCustomerProfilesService>;
  const profile = {
    id: 'p-1',
    userId: 'u-1',
    isComplete: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      getTrustScore: jest.fn(),
      recomputeTrustScore: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      addCustomData: jest.fn(),
      updateCustomData: jest.fn(),
      deleteCustomData: jest.fn(),
    } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminCustomerProfilesService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  describe('loadAdminCustomerProfiles$', () => {
    it('returns an empty page with total 0', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(of({ items: [], total: 0, limit: 25, offset: 0 }));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [], total: 0 }));
        expect(service.list).toHaveBeenCalledWith({ limit: 25, offset: 0, search: undefined });
        done();
      });
    });

    it('loads exactly the requested page with the total in one request (replace-page)', (done) => {
      actions$ = of(loadAdminCustomerProfiles({ search: 'ada', page: 3, pageSize: 50 }));
      service.list.mockReturnValue(of({ items: [profile], total: 101, limit: 50, offset: 100 }));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [profile] as never, total: 101 }));
        expect(service.list).toHaveBeenCalledTimes(1);
        expect(service.list).toHaveBeenCalledWith({ limit: 50, offset: 100, search: 'ada' });
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(throwError(() => new Error('Load failed')));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesFailure({ error: 'Load failed' }));
        done();
      });
    });

    it('normalizes non-Error failures', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(throwError(() => 'network'));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesFailure({ error: 'network' }));
        done();
      });
    });
  });

  describe('createAdminCustomerProfile$', () => {
    it('returns success', (done) => {
      const dto = { userId: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

      actions$ = of(createAdminCustomerProfile({ dto }));
      service.create.mockReturnValue(of(profile as never));

      createAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(createAdminCustomerProfileSuccess({ profile: profile as never }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(
        createAdminCustomerProfile({
          dto: { userId: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
        }),
      );
      service.create.mockReturnValue(throwError(() => new Error('Create failed')));

      createAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(createAdminCustomerProfileFailure({ error: 'Create failed' }));
        done();
      });
    });
  });

  describe('updateAdminCustomerProfile$', () => {
    it('returns success', (done) => {
      const dto = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', country: 'DE' };

      actions$ = of(updateAdminCustomerProfile({ id: 'p-1', dto }));
      service.update.mockReturnValue(of(profile as never));

      updateAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(updateAdminCustomerProfileSuccess({ profile: profile as never }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(
        updateAdminCustomerProfile({
          id: 'p-1',
          dto: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', country: 'DE' },
        }),
      );
      service.update.mockReturnValue(throwError(() => new Error('Update failed')));

      updateAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(updateAdminCustomerProfileFailure({ error: 'Update failed' }));
        done();
      });
    });
  });

  describe('deleteAdminCustomerProfile$', () => {
    it('returns success', (done) => {
      actions$ = of(deleteAdminCustomerProfile({ id: 'p-1' }));
      service.delete.mockReturnValue(of(null));

      deleteAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(deleteAdminCustomerProfileSuccess({ id: 'p-1' }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(deleteAdminCustomerProfile({ id: 'p-1' }));
      service.delete.mockReturnValue(throwError(() => new Error('Delete failed')));

      deleteAdminCustomerProfile$(actions$, service).subscribe((result) => {
        expect(result).toEqual(deleteAdminCustomerProfileFailure({ error: 'Delete failed' }));
        done();
      });
    });
  });

  describe('loadAdminCustomerProfileTrustScore$', () => {
    it('returns success', (done) => {
      const detail = { profileId: 'p-1', userId: 'u-1', score: 120, level: 'green', baseScore: 100, factors: [] };

      actions$ = of(loadAdminCustomerProfileTrustScore({ id: 'p-1' }));
      service.getTrustScore.mockReturnValue(of(detail as never));

      loadAdminCustomerProfileTrustScore$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfileTrustScoreSuccess({ detail: detail as never }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(loadAdminCustomerProfileTrustScore({ id: 'p-1' }));
      service.getTrustScore.mockReturnValue(throwError(() => new Error('Trust load failed')));

      loadAdminCustomerProfileTrustScore$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfileTrustScoreFailure({ error: 'Trust load failed' }));
        done();
      });
    });
  });

  describe('recomputeAdminCustomerProfileTrustScore$', () => {
    it('returns success', (done) => {
      const detail = { profileId: 'p-1', userId: 'u-1', score: 95, level: 'yellow', baseScore: 100, factors: [] };

      actions$ = of(recomputeAdminCustomerProfileTrustScore({ id: 'p-1' }));
      service.recomputeTrustScore.mockReturnValue(of(detail as never));

      recomputeAdminCustomerProfileTrustScore$(actions$, service).subscribe((result) => {
        expect(result).toEqual(recomputeAdminCustomerProfileTrustScoreSuccess({ detail: detail as never }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(recomputeAdminCustomerProfileTrustScore({ id: 'p-1' }));
      service.recomputeTrustScore.mockReturnValue(throwError(() => new Error('Trust recompute failed')));

      recomputeAdminCustomerProfileTrustScore$(actions$, service).subscribe((result) => {
        expect(result).toEqual(recomputeAdminCustomerProfileTrustScoreFailure({ error: 'Trust recompute failed' }));
        done();
      });
    });
  });

  describe('saveAdminCustomerProfileCustomData$', () => {
    it('applies add, update, and delete mutations', (done) => {
      const detail = {
        id: 'p-1',
        userId: 'u-1',
        isComplete: true,
        customData: { keep: '2', added: 'a' },
        createdAt: '',
        updatedAt: '',
      };

      actions$ = of(
        saveAdminCustomerProfileCustomData({
          id: 'p-1',
          original: { keep: '1', remove: 'x' },
          next: { keep: '2', added: 'a' },
        }),
      );
      service.updateCustomData.mockReturnValue(of({ ...detail, customData: { keep: '2', remove: 'x' } } as never));
      service.addCustomData.mockReturnValue(
        of({ ...detail, customData: { keep: '2', remove: 'x', added: 'a' } } as never),
      );
      service.deleteCustomData.mockReturnValue(of(detail as never));

      saveAdminCustomerProfileCustomData$(actions$, service).subscribe((result) => {
        expect(service.updateCustomData).toHaveBeenCalledWith('p-1', 'keep', { value: '2' });
        expect(service.addCustomData).toHaveBeenCalledWith('p-1', { key: 'added', value: 'a' });
        expect(service.deleteCustomData).toHaveBeenCalledWith('p-1', 'remove');
        expect(result).toEqual(saveAdminCustomerProfileCustomDataSuccess({ detail: detail as never }));
        done();
      });
    });

    it('reloads detail when there are no mutations', (done) => {
      const detail = {
        id: 'p-1',
        userId: 'u-1',
        isComplete: true,
        customData: { erpId: 'ERP-1' },
        createdAt: '',
        updatedAt: '',
      };

      actions$ = of(
        saveAdminCustomerProfileCustomData({
          id: 'p-1',
          original: { erpId: 'ERP-1' },
          next: { erpId: 'ERP-1' },
        }),
      );
      service.getById.mockReturnValue(of(detail as never));

      saveAdminCustomerProfileCustomData$(actions$, service).subscribe((result) => {
        expect(service.getById).toHaveBeenCalledWith('p-1');
        expect(result).toEqual(saveAdminCustomerProfileCustomDataSuccess({ detail: detail as never }));
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(
        saveAdminCustomerProfileCustomData({
          id: 'p-1',
          original: {},
          next: { erpId: 'ERP-1' },
        }),
      );
      service.addCustomData.mockReturnValue(throwError(() => new Error('Save failed')));

      saveAdminCustomerProfileCustomData$(actions$, service).subscribe((result) => {
        expect(result).toEqual(saveAdminCustomerProfileCustomDataFailure({ error: 'Save failed' }));
        done();
      });
    });
  });
});
