import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type {
  CreateServiceTypeDto,
  ListParams,
  ServiceTypeResponse,
  UpdateServiceTypeDto,
} from '../../types/billing.types';

import {
  clearSelectedServiceType,
  createServiceType,
  deleteServiceType,
  loadProviderDetails,
  loadServiceType,
  loadServiceTypes,
  updateServiceType,
} from './service-types.actions';
import { ServiceTypesFacade } from './service-types.facade';

describe('ServiceTypesFacade', () => {
  let facade: ServiceTypesFacade;
  let store: jest.Mocked<Store>;
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
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [ServiceTypesFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ServiceTypesFacade);
  });

  describe('State Observables', () => {
    it('should return service types observable', (done) => {
      store.select.mockReturnValue(of([mockServiceType]));
      facade.getServiceTypes$().subscribe((result) => {
        expect(result).toEqual([mockServiceType]);
        done();
      });
    });

    it('should return selected service type observable', (done) => {
      store.select.mockReturnValue(of(mockServiceType));
      facade.getSelectedServiceType$().subscribe((result) => {
        expect(result).toEqual(mockServiceType);
        done();
      });
    });

    it('should return provider details observable', (done) => {
      const providerDetails = [{ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: {} }];

      store.select.mockReturnValue(of(providerDetails));
      facade.getProviderDetails$().subscribe((result) => {
        expect(result).toEqual(providerDetails);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadProviderDetails', () => {
      facade.loadProviderDetails();
      expect(store.dispatch).toHaveBeenCalledWith(loadProviderDetails());
    });

    it('should dispatch loadServiceTypes', () => {
      const params: ListParams = { limit: 10 };

      facade.loadServiceTypes(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadServiceTypes({ params }));
    });

    it('should dispatch loadServiceType', () => {
      facade.loadServiceType('st-1');
      expect(store.dispatch).toHaveBeenCalledWith(loadServiceType({ id: 'st-1' }));
    });

    it('should dispatch createServiceType', () => {
      const dto: CreateServiceTypeDto = { key: 'new', name: 'New', provider: 'p' };

      facade.createServiceType(dto);
      expect(store.dispatch).toHaveBeenCalledWith(createServiceType({ serviceType: dto }));
    });

    it('should dispatch updateServiceType', () => {
      const dto: UpdateServiceTypeDto = { name: 'Updated' };

      facade.updateServiceType('st-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(updateServiceType({ id: 'st-1', serviceType: dto }));
    });

    it('should dispatch deleteServiceType', () => {
      facade.deleteServiceType('st-1');
      expect(store.dispatch).toHaveBeenCalledWith(deleteServiceType({ id: 'st-1' }));
    });

    it('should dispatch clearSelectedServiceType', () => {
      facade.clearSelectedServiceType();
      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedServiceType());
    });
  });
});
