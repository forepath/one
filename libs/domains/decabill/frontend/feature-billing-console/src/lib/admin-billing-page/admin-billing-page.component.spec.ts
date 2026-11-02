import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminBillingFacade,
  AdminBillingService,
  AdminInvoiceManagerFacade,
  AdminSupplierInvoiceManagerFacade,
  AdminSupplierInvoicesService,
  AdminSupplierProfilesService,
  InvoicesFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { AdminBillingPageComponent } from './admin-billing-page.component';

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
jest.mock('ng-apexcharts', () => {
  const { NgModule } = jest.requireActual('@angular/core');

  @NgModule({})
  class NgApexchartsModule {}

  return { NgApexchartsModule };
});

/** Facade / service stub: unknown members are spies returning `of([])` that can also be subscribed to. */
function stub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(overrides, {
    get: (target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;

      if (!(key in target)) {
        const fn = jest.fn(() => of([]));

        Object.assign(fn, {
          subscribe: (...args: unknown[]) => (of([]).subscribe as (...a: unknown[]) => unknown)(...args),
          pipe: (...ops: unknown[]) => (of([]).pipe as (...o: unknown[]) => unknown)(...ops),
        });
        target[key] = fn;
      }

      return target[key];
    },
  });
}

const invoice = (id: string, status: string) => ({ id, invoiceNumber: `INV-${id}`, status });

describe('AdminBillingPageComponent (bulk actions)', () => {
  let billingService: Record<string, jest.Mock>;
  let supplierService: Record<string, jest.Mock>;
  let billingFacade: Record<string, unknown>;
  let component: AdminBillingPageComponent;

  beforeEach(() => {
    billingService = { markPaid: jest.fn(), voidInvoice: jest.fn(), deleteManualInvoice: jest.fn() };
    supplierService = { markPaid: jest.fn(), delete: jest.fn(), listAuditLogs: jest.fn() };
    billingFacade = stub({ loadAuditLogs: jest.fn(), auditLogsTotalByInvoice$: of({ i1: 60 }) });
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminBillingService, useValue: stub(billingService) },
        { provide: AdminSupplierInvoicesService, useValue: stub(supplierService) },
        { provide: AdminSupplierProfilesService, useValue: stub() },
        { provide: AdminBillingFacade, useValue: billingFacade },
        {
          provide: AdminInvoiceManagerFacade,
          useValue: stub({
            invoices$: of([
              invoice('d1', 'draft'),
              invoice('d2', 'draft'),
              invoice('i1', 'issued'),
              invoice('i2', 'overdue'),
              invoice('p1', 'paid'),
            ]),
            total$: of(5),
            error$: of(null),
          }),
        },
        {
          provide: AdminSupplierInvoiceManagerFacade,
          useValue: stub({
            invoices$: of([invoice('sd1', 'draft'), invoice('si1', 'issued'), invoice('si2', 'issued')]),
            total$: of(3),
            error$: of(null),
          }),
        },
        { provide: InvoicesFacade, useValue: stub() },
        { provide: AuthenticationFacade, useValue: stub({ users$: of([]) }) },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminBillingPageComponent());
  });

  it('customer invoices: bulk Mark paid only hits payable invoices, per-item results incl. denied', async () => {
    billingService['markPaid'].mockImplementation((id: string) =>
      id === 'i2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedInvoices.set(['d1', 'i1', 'i2', 'p1']);

    await component.runInvoiceBulk('markPaid');

    expect(billingService['markPaid']).toHaveBeenCalledTimes(2);
    expect(billingService['markPaid']).toHaveBeenCalledWith('i1', {});
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedInvoices()).toEqual([]);
  });

  it('customer invoices: bulk Void (after confirm) voids issued / overdue only, incl. a denied one', async () => {
    billingService['voidInvoice'].mockImplementation((id: string) =>
      id === 'i1' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedInvoices.set(['d1', 'i1', 'i2', 'p1']);
    component.pendingBulk.set('void');
    expect(component.bulkConfirmMessage()).toContain('2 selected invoices');

    await component.runInvoiceBulk('void');

    expect(billingService['voidInvoice']).toHaveBeenCalledTimes(2);
    expect(billingService['voidInvoice']).not.toHaveBeenCalledWith('p1');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('customer invoices: bulk Delete drafts deletes drafts only, incl. a denied one', async () => {
    billingService['deleteManualInvoice'].mockImplementation((id: string) =>
      id === 'd2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selectedInvoices.set(['d1', 'd2', 'i1']);

    await component.runInvoiceBulk('delete');

    expect(billingService['deleteManualInvoice']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('supplier invoices: bulk Mark paid / Delete drafts fan out per invoice, incl. a denied one', async () => {
    supplierService['markPaid'].mockImplementation((id: string) =>
      id === 'si2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedSupplierInvoices.set(['sd1', 'si1', 'si2']);
    await component.runSupplierBulk('markPaid');
    expect(supplierService['markPaid']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 not allowed');

    supplierService['delete'].mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selectedSupplierInvoices.set(['sd1', 'si1']);
    await component.runSupplierBulk('delete');
    expect(supplierService['delete']).toHaveBeenCalledTimes(1);
    expect(supplierService['delete']).toHaveBeenCalledWith('sd1');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('audit history: loads page 1 on open, then the requested page / size (replace-page, server total)', () => {
    component.openAuditHistory(invoice('i1', 'issued') as never);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 1, 25);
    expect(component.auditLogsTotal()).toBe(60);

    component.auditPage.set(3);
    component.auditPageSize.set(50);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 3, 50);

    // Reopening starts on page 1 again.
    component.openAuditHistory(invoice('i1', 'issued') as never);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 1, 50);
  });

  it('supplier audit history: requests limit / offset per page and keeps the total', () => {
    supplierService['listAuditLogs'].mockReturnValue(
      of({ items: [{ id: 'log-1' }], total: 30, limit: 25, offset: 25 }),
    );
    component.openSupplierAuditHistory(invoice('si1', 'issued') as never);
    TestBed.tick();
    expect(supplierService['listAuditLogs']).toHaveBeenLastCalledWith('si1', 25, 0);

    component.auditPage.set(2);
    TestBed.tick();
    expect(supplierService['listAuditLogs']).toHaveBeenLastCalledWith('si1', 25, 25);
    expect(component.selectedAuditLogs()).toEqual([{ id: 'log-1' }]);
    expect(component.auditLogsTotal()).toBe(30);
    expect(billingFacade['loadAuditLogs']).not.toHaveBeenCalled();
  });
});
