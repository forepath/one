import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of } from 'rxjs';

import { AdminCustomerProfilesService } from '../../services/admin-customer-profiles.service';

import { loadAdminCustomerProfiles, loadAdminCustomerProfilesSuccess } from './admin-customer-profiles.actions';
import { loadAdminCustomerProfiles$ } from './admin-customer-profiles.effects';

describe('AdminCustomerProfilesEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<AdminCustomerProfilesService>;

  beforeEach(() => {
    service = { list: jest.fn() } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminCustomerProfilesService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loadAdminCustomerProfiles$ returns success for partial batch', (done) => {
    const profile = {
      id: 'p-1',
      userId: 'u-1',
      isComplete: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    actions$ = of(loadAdminCustomerProfiles());
    service.list.mockReturnValue(of({ items: [profile], total: 1, limit: 10, offset: 0 }));

    loadAdminCustomerProfiles$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAdminCustomerProfilesSuccess({ profiles: [profile] }));
      done();
    });
  });
});
