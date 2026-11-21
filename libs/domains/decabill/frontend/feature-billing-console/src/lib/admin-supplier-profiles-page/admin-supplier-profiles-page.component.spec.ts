import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminSupplierProfilesFacade,
  AdminSupplierProfilesService,
  BillingCapabilitiesFacade,
  type AdminSupplierProfileListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminSupplierProfilesPageComponent } from './admin-supplier-profiles-page.component';

jest.mock('../billing-country-options', () => ({
  BILLING_COUNTRY_OPTIONS: [],
  DEFAULT_BILLING_COUNTRY_CODE: 'DE',
  getCountryDisplayName: (code: string) => code,
  withOptionalCountry: jest.requireActual('../billing-country-default').withOptionalCountry,
}));

const profile = (id: string, isComplete = true): AdminSupplierProfileListItem =>
  ({
    id,
    supplierNumber: `S-${id}`,
    company: `Supplier ${id}`,
    isComplete,
    updatedAt: '2026-10-01T00:00:00Z',
  }) as AdminSupplierProfileListItem;

describe('AdminSupplierProfilesPageComponent (data list)', () => {
  let service: { delete: jest.Mock; getById: jest.Mock };
  let facade: Record<string, unknown>;
  let component: AdminSupplierProfilesPageComponent;

  beforeEach(() => {
    service = { delete: jest.fn(), getById: jest.fn() };
    facade = {
      profiles$: of([profile('s1'), profile('s2', false)]),
      loading$: of(false),
      creating$: of(false),
      updating$: of(false),
      deleting$: of(false),
      customDataSaving$: of(false),
      error$: of(null),
      total$: of(2),
      loadProfiles: jest.fn(),
      createProfile: jest.fn(),
      updateProfile: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminSupplierProfilesFacade, useValue: facade },
        { provide: AdminSupplierProfilesService, useValue: service },
        {
          provide: BillingCapabilitiesFacade,
          useValue: { accountingEnabled$: of(true), loadCapabilities: jest.fn() },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminSupplierProfilesPageComponent());
  });

  it('shows completeness as State, the supplier as name, the supplier number, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[0].state?.(profile('s2', false))).toEqual(expect.objectContaining({ tone: 'warning' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns[2].value?.(profile('s1'))).toBe('S-s1');
    expect(component.columns.map((c) => c.id)).not.toContain('id');
  });

  it('bulk Delete calls delete per supplier profile with per-item results (incl. denied)', async () => {
    service.delete.mockImplementation((id: string) =>
      id === 's2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.paging.page.set(2);
    component.selected.set(['s1', 's2']);

    await component.deleteSelected();

    expect(service.delete).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selected()).toEqual([]);
    // Reloads the current page (replace-page), not page 1 / append.
    expect(facade['loadProfiles']).toHaveBeenLastCalledWith({ search: undefined, page: 2, pageSize: 25 });
  });

  it('saves the default expense account (trimmed, empty cleared) with accounting enabled', () => {
    service.getById.mockReturnValue(of({ id: 's1', supplierNumber: 'S-s1', defaultExpenseAccountNumber: '3400' }));
    component.openEditModal(profile('s1'));
    expect(component.editForm.defaultExpenseAccountNumber).toBe('3400');

    component.editForm.defaultExpenseAccountNumber = ' 4980 ';
    component.submitEdit();
    expect(facade['updateProfile']).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ defaultExpenseAccountNumber: '4980' }),
    );

    component.createForm.defaultExpenseAccountNumber = '';
    component.submitCreate();
    expect(facade['createProfile']).toHaveBeenCalledWith(
      expect.objectContaining({ defaultExpenseAccountNumber: null }),
    );
  });
});
