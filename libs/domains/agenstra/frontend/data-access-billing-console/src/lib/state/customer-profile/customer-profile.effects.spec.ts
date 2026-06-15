import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { CustomerProfileService } from '../../services/customer-profile.service';
import type { CustomerProfileResponse } from '../../types/billing.types';

import {
  loadCustomerProfile,
  loadCustomerProfileFailure,
  loadCustomerProfileSuccess,
  updateCustomerProfile,
  updateCustomerProfileFailure,
  updateCustomerProfileSuccess,
} from './customer-profile.actions';
import { loadCustomerProfile$, updateCustomerProfile$ } from './customer-profile.effects';

describe('CustomerProfileEffects', () => {
  let actions$: Actions;
  let customerProfileService: jest.Mocked<CustomerProfileService>;
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
    customerProfileService = {
      getCustomerProfile: jest.fn(),
      updateCustomerProfile: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: CustomerProfileService, useValue: customerProfileService },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadCustomerProfile$', () => {
    it('should return loadCustomerProfileSuccess on success', (done) => {
      actions$ = of(loadCustomerProfile());
      customerProfileService.getCustomerProfile.mockReturnValue(of(mockProfile));

      loadCustomerProfile$(actions$, customerProfileService).subscribe((result) => {
        expect(result).toEqual(loadCustomerProfileSuccess({ profile: mockProfile }));
        done();
      });
    });

    it('should return loadCustomerProfileFailure on error', (done) => {
      actions$ = of(loadCustomerProfile());
      customerProfileService.getCustomerProfile.mockReturnValue(throwError(() => new Error('Load failed')));

      loadCustomerProfile$(actions$, customerProfileService).subscribe((result) => {
        expect(result).toEqual(loadCustomerProfileFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('updateCustomerProfile$', () => {
    it('should return updateCustomerProfileSuccess on success', (done) => {
      const dto = { firstName: 'Jane' };

      actions$ = of(updateCustomerProfile({ profile: dto }));
      const updated = { ...mockProfile, firstName: 'Jane' };

      customerProfileService.updateCustomerProfile.mockReturnValue(of(updated));

      updateCustomerProfile$(actions$, customerProfileService).subscribe((result) => {
        expect(result).toEqual(updateCustomerProfileSuccess({ profile: updated }));
        expect(customerProfileService.updateCustomerProfile).toHaveBeenCalledWith(dto);
        done();
      });
    });

    it('should return updateCustomerProfileFailure on error', (done) => {
      actions$ = of(updateCustomerProfile({ profile: {} }));
      customerProfileService.updateCustomerProfile.mockReturnValue(throwError(() => new Error('Update failed')));

      updateCustomerProfile$(actions$, customerProfileService).subscribe((result) => {
        expect(result).toEqual(updateCustomerProfileFailure({ error: 'Update failed' }));
        done();
      });
    });
  });
});
