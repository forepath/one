import { DatePipe } from '@angular/common';
import { ApplicationRef, ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { InvoicesFacade, SubscriptionsFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { InvoicesComponent } from './invoices.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

/** Facade stub: unknown members are spies returning `of([])` that can also be subscribed to. */
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

describe('InvoicesComponent (bulk Download PDFs)', () => {
  let facade: Record<string, unknown>;
  let component: InvoicesComponent;

  beforeEach(() => {
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    facade = stub({
      getOpenOverdueList$: jest.fn(() =>
        of([
          { id: 'i1', invoiceNumber: 'INV-1', subscriptionId: 's1', status: 'issued', canDownload: true },
          { id: 'i2', invoiceNumber: 'INV-2', subscriptionId: 's1', status: 'overdue', canDownload: true },
          { id: 'i3', invoiceNumber: 'INV-3', subscriptionId: 's1', status: 'issued', canDownload: false },
        ]),
      ),
      downloadInvoicePdf: jest.fn(),
    });
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: Router, useValue: { navigate: jest.fn(() => Promise.resolve(true)) } },
        { provide: InvoicesFacade, useValue: facade },
        { provide: SubscriptionsFacade, useValue: stub() },
        { provide: AuthenticationFacade, useValue: stub({ users$: of([]) }) },
      ],
    });
    component = TestBed.runInInjectionContext(() => new InvoicesComponent());
  });

  it('downloads one PDF per selected downloadable invoice with per-item results (incl. denied)', async () => {
    (facade['downloadInvoicePdf'] as jest.Mock).mockImplementation((_sub: string, id: string) =>
      id === 'i2' ? throwError(() => ({ status: 403 })) : of(new Blob(['%PDF'])),
    );

    await component.downloadSelected(['i1', 'i2', 'i3']);

    expect(facade['downloadInvoicePdf']).toHaveBeenCalledTimes(2);
    expect(facade['downloadInvoicePdf']).toHaveBeenCalledWith('s1', 'i1');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('loads one server page of the shown tab only (hasNext list) and the other tab on switch', () => {
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    expect(facade['loadOpenOverdueInvoices']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
    expect(facade['loadHistoryInvoices']).not.toHaveBeenCalled();

    component.openPaging.page.set(2);
    appRef.tick();
    expect(facade['loadOpenOverdueInvoices']).toHaveBeenLastCalledWith({ search: undefined, page: 2, pageSize: 25 });

    component.onMobilePanelTabChange('history');
    appRef.tick();
    expect(facade['loadHistoryInvoices']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
  });
});
