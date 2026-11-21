import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  BillingCapabilitiesFacade,
  type AccountingOpenItemRow,
  type AccountingOpenItems,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject } from 'rxjs';

import { AccountingOpenItemsPageComponent, openItemState } from './accounting-open-items-page.component';

describe('AccountingOpenItemsPageComponent', () => {
  const item = (openItemId: string, open: number, daysOverdue: number): AccountingOpenItemRow => ({
    openItemId,
    counterpartyId: 'c1',
    documentNumber: `INV-${openItemId}`,
    documentDate: '2026-01-01',
    dueDate: '2026-01-15',
    amount: open,
    open,
    daysOverdue,
    tenantId: null,
  });
  const data: AccountingOpenItems = {
    items: [item('a', 100, 0), item('b', 50, 10), item('c', 25, 120)],
    aging: { current: 100, '1-30': 50, '90+': 25 },
    total: 175,
  };
  let facade: { openItems$: BehaviorSubject<unknown>; load: jest.Mock };
  const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

  function create() {
    facade = {
      openItems$: new BehaviorSubject<unknown>({ data, loading: false, error: null, loaded: true }),
      load: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AccountingOpenItemsPageComponent],
      providers: [
        { provide: AccountingFacade, useValue: facade },
        {
          provide: BillingCapabilitiesFacade,
          useValue: {
            accountingGlobalAccess$: new BehaviorSubject(true),
            viewableTenants$: new BehaviorSubject(['default']),
            loadCapabilities: jest.fn(),
          },
        },
        { provide: Router, useValue: router },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingOpenItemsPageComponent());
  }

  it('loads customer open items as of today', () => {
    const page = create();

    page.ngOnInit();

    expect(facade.load).toHaveBeenCalledWith({ key: 'openItems', type: 'customer', asOf: page.asOf });
  });

  it('reloads when switching to suppliers', () => {
    const page = create();

    page.onTypeChange('supplier');

    expect(facade.load).toHaveBeenLastCalledWith({ key: 'openItems', type: 'supplier', asOf: page.asOf });
  });

  it('computes the KPIs and the aging chart', () => {
    const page = create();

    expect(page.kpis()).toEqual({ total: 175, count: 3, overdue: 75, overdue90: 25 });
    expect(page.agingChart()?.series[0]).toEqual(expect.objectContaining({ data: [100, 50, 0, 0, 25] }));
  });

  it('opens the bookings of a supplier document', () => {
    const page = create();

    page.onTypeChange('supplier');
    page.onRowAction(item('b', 50, 10), 'bookings');

    expect(router.navigate).toHaveBeenCalledWith(['/administration/accounting/journal'], {
      queryParams: { linkType: 'supplier_invoice', targetId: 'b' },
    });
  });

  it('tones overdue items', () => {
    expect(openItemState({ daysOverdue: 0 }).tone).toBe('success');
    expect(openItemState({ daysOverdue: 5 }).tone).toBe('warning');
    expect(openItemState({ daysOverdue: 91 }).tone).toBe('danger');
  });
});
