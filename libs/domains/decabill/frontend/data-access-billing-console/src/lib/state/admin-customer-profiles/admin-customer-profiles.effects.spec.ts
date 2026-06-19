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
  loadAdminCustomerProfilesBatch,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';
import {
  createAdminCustomerProfile$,
  deleteAdminCustomerProfile$,
  loadAdminCustomerProfiles$,
  loadAdminCustomerProfilesBatch$,
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
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminCustomerProfilesService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  describe('loadAdminCustomerProfiles$', () => {
    it('returns empty success when no profiles', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(of({ items: [], total: 0, limit: 10, offset: 0 }));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [] }));
        done();
      });
    });

    it('returns success for partial batch', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(of({ items: [profile], total: 1, limit: 10, offset: 0 }));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [profile] }));
        done();
      });
    });

    it('chains batch when first page is full', (done) => {
      actions$ = of(loadAdminCustomerProfiles());
      service.list.mockReturnValue(of({ items: Array(10).fill(profile), total: 20, limit: 10, offset: 0 }));

      loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
        expect(result.type).toBe(loadAdminCustomerProfilesBatch.type);
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

  describe('loadAdminCustomerProfilesBatch$', () => {
    it('accumulates invoices until partial page', (done) => {
      actions$ = of(loadAdminCustomerProfilesBatch({ offset: 10, accumulatedProfiles: [profile] }));
      service.list.mockReturnValue(of({ items: [profile], total: 2, limit: 10, offset: 10 }));

      loadAdminCustomerProfilesBatch$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [profile, profile] }));
        done();
      });
    });

    it('chains another batch when page is full', (done) => {
      actions$ = of(loadAdminCustomerProfilesBatch({ offset: 10, accumulatedProfiles: [profile] }));
      service.list.mockReturnValue(of({ items: Array(10).fill(profile), total: 30, limit: 10, offset: 10 }));

      loadAdminCustomerProfilesBatch$(actions$, service).subscribe((result) => {
        expect(result.type).toBe(loadAdminCustomerProfilesBatch.type);
        done();
      });
    });

    it('returns failure on batch error', (done) => {
      actions$ = of(loadAdminCustomerProfilesBatch({ offset: 10, accumulatedProfiles: [profile] }));
      service.list.mockReturnValue(throwError(() => ({ message: 'batch failed' })));

      loadAdminCustomerProfilesBatch$(actions$, service).subscribe((result) => {
        expect(result).toEqual(loadAdminCustomerProfilesFailure({ error: 'batch failed' }));
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
});
