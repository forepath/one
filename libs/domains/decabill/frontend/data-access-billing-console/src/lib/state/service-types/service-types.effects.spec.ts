import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { ServiceTypesService } from '../../services/service-types.service';
import type { ServiceTypeResponse } from '../../types/billing.types';

import {
  createServiceType,
  createServiceTypeFailure,
  createServiceTypeSuccess,
  deleteServiceType,
  deleteServiceTypeFailure,
  deleteServiceTypeSuccess,
  loadProviderDetails,
  loadProviderDetailsFailure,
  loadProviderDetailsSuccess,
  loadServiceType,
  loadServiceTypeFailure,
  loadServiceTypes,
  loadServiceTypesBatch,
  loadServiceTypesFailure,
  loadServiceTypesSuccess,
  loadServiceTypeSuccess,
  updateServiceType,
  updateServiceTypeFailure,
  updateServiceTypeSuccess,
} from './service-types.actions';
import {
  createServiceType$,
  deleteServiceType$,
  loadProviderDetails$,
  loadServiceType$,
  loadServiceTypes$,
  loadServiceTypesBatch$,
  updateServiceType$,
} from './service-types.effects';

describe('ServiceTypesEffects', () => {
  let actions$: Actions;
  let serviceTypesService: jest.Mocked<ServiceTypesService>;
  const mockServiceType: ServiceTypeResponse = {
    id: 'st-1',
    key: 'cursor',
    name: 'Cursor',
    provider: 'provider-1',
    configSchema: {},
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    serviceTypesService = {
      getProviderDetails: jest.fn(),
      listServiceTypes: jest.fn(),
      getServiceType: jest.fn(),
      createServiceType: jest.fn(),
      updateServiceType: jest.fn(),
      deleteServiceType: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: ServiceTypesService, useValue: serviceTypesService }],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadProviderDetails$', () => {
    it('should return loadProviderDetailsSuccess on success', (done) => {
      const providerDetails = [{ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: {} }];

      actions$ = of(loadProviderDetails());
      serviceTypesService.getProviderDetails.mockReturnValue(of(providerDetails));

      loadProviderDetails$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadProviderDetailsSuccess({ providerDetails }));
        done();
      });
    });

    it('should return loadProviderDetailsFailure on error', (done) => {
      actions$ = of(loadProviderDetails());
      serviceTypesService.getProviderDetails.mockReturnValue(throwError(() => new Error('Load failed')));

      loadProviderDetails$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadProviderDetailsFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('loadServiceTypes$', () => {
    it('should return loadServiceTypesSuccess when batch is empty', (done) => {
      actions$ = of(loadServiceTypes({ params: {} }));
      serviceTypesService.listServiceTypes.mockReturnValue(of([]));

      loadServiceTypes$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadServiceTypesSuccess({ serviceTypes: [] }));
        done();
      });
    });

    it('should return loadServiceTypesFailure on error', (done) => {
      actions$ = of(loadServiceTypes({ params: {} }));
      serviceTypesService.listServiceTypes.mockReturnValue(throwError(() => new Error('Load failed')));

      loadServiceTypes$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadServiceTypesFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('loadServiceTypesBatch$', () => {
    it('should return loadServiceTypesSuccess when batch is empty', (done) => {
      const accumulated = [mockServiceType];

      actions$ = of(loadServiceTypesBatch({ offset: 10, accumulatedServiceTypes: accumulated }));
      serviceTypesService.listServiceTypes.mockReturnValue(of([]));

      loadServiceTypesBatch$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadServiceTypesSuccess({ serviceTypes: accumulated }));
        done();
      });
    });
  });

  describe('loadServiceType$', () => {
    it('should return loadServiceTypeSuccess on success', (done) => {
      actions$ = of(loadServiceType({ id: 'st-1' }));
      serviceTypesService.getServiceType.mockReturnValue(of(mockServiceType));

      loadServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadServiceTypeSuccess({ serviceType: mockServiceType }));
        done();
      });
    });

    it('should return loadServiceTypeFailure on error', (done) => {
      actions$ = of(loadServiceType({ id: 'st-1' }));
      serviceTypesService.getServiceType.mockReturnValue(throwError(() => new Error('Load failed')));

      loadServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(loadServiceTypeFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('createServiceType$', () => {
    it('should return createServiceTypeSuccess on success', (done) => {
      actions$ = of(createServiceType({ serviceType: { key: 'new', name: 'New', provider: 'p' } }));
      serviceTypesService.createServiceType.mockReturnValue(of(mockServiceType));

      createServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(createServiceTypeSuccess({ serviceType: mockServiceType }));
        done();
      });
    });

    it('should return createServiceTypeFailure on error', (done) => {
      actions$ = of(createServiceType({ serviceType: {} as never }));
      serviceTypesService.createServiceType.mockReturnValue(throwError(() => new Error('Create failed')));

      createServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(createServiceTypeFailure({ error: 'Create failed' }));
        done();
      });
    });
  });

  describe('updateServiceType$', () => {
    it('should return updateServiceTypeSuccess on success', (done) => {
      const updated = { ...mockServiceType, name: 'Updated' };

      actions$ = of(updateServiceType({ id: 'st-1', serviceType: { name: 'Updated' } }));
      serviceTypesService.updateServiceType.mockReturnValue(of(updated));

      updateServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(updateServiceTypeSuccess({ serviceType: updated }));
        done();
      });
    });

    it('should return updateServiceTypeFailure on error', (done) => {
      actions$ = of(updateServiceType({ id: 'st-1', serviceType: {} }));
      serviceTypesService.updateServiceType.mockReturnValue(throwError(() => new Error('Update failed')));

      updateServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(updateServiceTypeFailure({ error: 'Update failed' }));
        done();
      });
    });
  });

  describe('deleteServiceType$', () => {
    it('should return deleteServiceTypeSuccess on success', (done) => {
      actions$ = of(deleteServiceType({ id: 'st-1' }));
      serviceTypesService.deleteServiceType.mockReturnValue(of(undefined));

      deleteServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(deleteServiceTypeSuccess({ id: 'st-1' }));
        done();
      });
    });

    it('should return deleteServiceTypeFailure on error', (done) => {
      actions$ = of(deleteServiceType({ id: 'st-1' }));
      serviceTypesService.deleteServiceType.mockReturnValue(throwError(() => new Error('Delete failed')));

      deleteServiceType$(actions$, serviceTypesService).subscribe((result) => {
        expect(result).toEqual(deleteServiceTypeFailure({ error: 'Delete failed' }));
        done();
      });
    });
  });
});
