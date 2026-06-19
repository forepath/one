import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type { CustomerProfileDto, CustomerProfileResponse } from '../../types/billing.types';

import { clearCustomerProfile, loadCustomerProfile, updateCustomerProfile } from './customer-profile.actions';
import { CustomerProfileFacade } from './customer-profile.facade';

describe('CustomerProfileFacade', () => {
  let facade: CustomerProfileFacade;
  let store: jest.Mocked<Store>;
  const mockProfile: CustomerProfileResponse = {
    id: 'cp-1',
    userId: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [CustomerProfileFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(CustomerProfileFacade);
  });

  describe('State Observables', () => {
    it('should return customer profile observable', (done) => {
      store.select.mockReturnValue(of(mockProfile));
      facade.getCustomerProfile$().subscribe((result) => {
        expect(result).toEqual(mockProfile);
        done();
      });
    });

    it('should return has customer profile observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.hasCustomerProfile$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadCustomerProfile', () => {
      facade.loadCustomerProfile();
      expect(store.dispatch).toHaveBeenCalledWith(loadCustomerProfile());
    });

    it('should dispatch updateCustomerProfile', () => {
      const profile: CustomerProfileDto = { firstName: 'Jane' };

      facade.updateCustomerProfile(profile);
      expect(store.dispatch).toHaveBeenCalledWith(updateCustomerProfile({ profile }));
    });

    it('should dispatch clearCustomerProfile', () => {
      facade.clearCustomerProfile();
      expect(store.dispatch).toHaveBeenCalledWith(clearCustomerProfile());
    });
  });
});
