import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminBillingService,
  AdminDatevExportsFacade,
  BillingCapabilitiesFacade,
  type AdminDatevExportListEntry,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { AdminDatevExportsPageComponent } from './admin-datev-exports-page.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const exportItem = (id: string, status: string, month = 1): AdminDatevExportListEntry =>
  ({
    id,
    scope: 'tenant',
    periodYear: 2026,
    periodMonth: month,
    status,
    fileName: `EXTF_${id}.zip`,
    bookingCount: 3,
    invoiceCount: 2,
    debtorCount: 1,
  }) as unknown as AdminDatevExportListEntry;

describe('AdminDatevExportsPageComponent (data list)', () => {
  let service: { downloadDatevExport: jest.Mock };
  let component: AdminDatevExportsPageComponent;

  beforeEach(() => {
    service = { downloadDatevExport: jest.fn() };
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminBillingService, useValue: service },
        {
          provide: AdminDatevExportsFacade,
          useValue: {
            items$: of([
              exportItem('e1', 'completed'),
              exportItem('e2', 'completed', 2),
              exportItem('e3', 'failed', 3),
            ]),
            loading$: of(false),
            error$: of(null),
            scope$: of('tenant'),
            viewTenantId$: of(null),
            triggerLoading$: of(false),
            triggerError$: of(null),
            total$: of(3),
            loadExports: jest.fn(),
            loadPage: jest.fn(),
            downloadExport: jest.fn(),
          },
        },
        {
          provide: BillingCapabilitiesFacade,
          useValue: {
            unifiedExportAllowed$: of(false),
            globalViewsAllowed$: of(false),
            viewableTenants$: of([]),
            loadCapabilities: jest.fn(),
          },
        },
        { provide: AuthenticationFacade, useValue: { users$: of([]), loadUsers: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default' } } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminDatevExportsPageComponent());
  });

  it('shows State + period, readable status labels and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns[1].value?.(exportItem('e1', 'completed'))).toBe('2026-01');
    expect(component.exportState(exportItem('e3', 'failed'))).toEqual(
      expect.objectContaining({ label: 'Failed', tone: 'danger' }),
    );
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.rowInlineActions(exportItem('e3', 'failed'))).toEqual([]);
  });

  it('bulk Download fetches each completed export (skips failed ones) with per-item results (incl. denied)', async () => {
    service.downloadDatevExport.mockImplementation((id: string) =>
      id === 'e2' ? throwError(() => ({ status: 403 })) : of(new Blob(['x'])),
    );
    component.selected.set(['e1', 'e2', 'e3']);

    await component.downloadSelected();

    expect(service.downloadDatevExport).toHaveBeenCalledTimes(2);
    expect(service.downloadDatevExport).toHaveBeenCalledWith('e1', 'default');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('loads one page per scope / search / page (server paging) and a scope tab change goes back to page 1', () => {
    const facade = TestBed.inject(AdminDatevExportsFacade) as unknown as { loadPage: jest.Mock };

    TestBed.tick();
    expect(facade.loadPage).toHaveBeenLastCalledWith({
      scope: 'tenant',
      viewTenantId: 'default',
      search: undefined,
      page: 1,
      pageSize: 25,
    });

    component.paging.page.set(3);
    TestBed.tick();
    expect(facade.loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'tenant', page: 3 }));

    component.onScopeTabChange('unified');
    TestBed.tick();
    expect(component.paging.page()).toBe(1);
    expect(facade.loadPage).toHaveBeenLastCalledWith({
      scope: 'unified',
      viewTenantId: undefined,
      search: undefined,
      page: 1,
      pageSize: 25,
    });
  });
});
