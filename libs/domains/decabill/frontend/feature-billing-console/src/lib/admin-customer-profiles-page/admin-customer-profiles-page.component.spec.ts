import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminCustomerProfilesFacade,
  AdminCustomerProfilesService,
  type AdminCustomerProfileListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { AdminCustomerProfilesPageComponent } from './admin-customer-profiles-page.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
jest.mock('../billing-country-options', () => ({
  BILLING_COUNTRY_OPTIONS: [],
  DEFAULT_BILLING_COUNTRY_CODE: 'DE',
  getCountryDisplayName: (code: string) => code,
}));

const profile = (id: string, trustLevel?: 'green' | 'red'): AdminCustomerProfileListItem =>
  ({
    id,
    userId: `u-${id}`,
    customerNumber: `C-${id}`,
    company: `Company ${id}`,
    isComplete: true,
    trustLevel,
    updatedAt: '2026-10-01T00:00:00Z',
  }) as AdminCustomerProfileListItem;

describe('AdminCustomerProfilesPageComponent (data list)', () => {
  let service: { recomputeTrustScore: jest.Mock; delete: jest.Mock; getById: jest.Mock };
  let facade: Record<string, unknown>;
  let component: AdminCustomerProfilesPageComponent;

  beforeEach(() => {
    service = { recomputeTrustScore: jest.fn(), delete: jest.fn(), getById: jest.fn() };
    facade = {
      profiles$: of([profile('p1', 'green'), profile('p2', 'red'), profile('p3')]),
      loading$: of(false),
      creating$: of(false),
      updating$: of(false),
      deleting$: of(false),
      customDataSaving$: of(false),
      error$: of(null),
      trustScoreDetail$: of(null),
      trustScoreLoading$: of(false),
      trustScoreRefreshing$: of(false),
      total$: of(3),
      loadProfiles: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminCustomerProfilesFacade, useValue: facade },
        { provide: AdminCustomerProfilesService, useValue: service },
        { provide: AuthenticationFacade, useValue: { users$: of([]), loadUsers: jest.fn() } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminCustomerProfilesPageComponent());
  });

  it('shows Trust as State, the customer as name, the customer number, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'trust', type: 'state' }));
    expect(component.columns[0].state?.(profile('p2', 'red'))).toEqual(expect.objectContaining({ tone: 'danger' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns[2].value?.(profile('p1'))).toBe('C-p1');
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.rowMenu().map((item) => item.id)).toEqual(['trust', 'custom-data', 'edit', 'delete', 'copy-id']);
  });

  it('bulk Recompute trust calls the recompute endpoint per profile with per-item results (incl. denied)', async () => {
    service.recomputeTrustScore.mockImplementation((id: string) =>
      id === 'p2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selected.set(['p1', 'p2']);

    await component.recomputeTrustSelected();

    expect(service.recomputeTrustScore).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(facade['loadProfiles']).toHaveBeenCalled();
  });

  it('reloads the current page after a bulk action (replace-page, not page 1 / append)', async () => {
    service.delete.mockReturnValue(of(undefined));
    component.paging.page.set(2);
    component.selected.set(['p1']);

    await component.deleteSelected();

    expect(facade['loadProfiles']).toHaveBeenLastCalledWith({ search: undefined, page: 2, pageSize: 25 });
  });

  it('bulk Delete calls delete per profile', async () => {
    service.delete.mockImplementation((id: string) =>
      id === 'p3' ? throwError(() => ({ status: 409 })) : of(undefined),
    );
    component.selected.set(['p1', 'p3']);

    await component.deleteSelected();

    expect(service.delete).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 failed');
  });
});
