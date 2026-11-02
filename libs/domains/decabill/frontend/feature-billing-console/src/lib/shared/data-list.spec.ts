import { ApplicationRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { fpcRunBulk } from '@forepath/shared/frontend/ui-components';

import { dbBulkSummary, dbCopyIdItem, dbOpenItem } from './data-list';
import { invoiceSummaryItems, invoiceTaxItems } from './invoice-totals';
import { dbServerPaging, type DbPageQuery } from './server-paging';
import { invoiceState, projectState, subscriptionState, timeEntryBillingState } from './table-states';

// The country list registers i18n-iso-countries locales (JSON import), not needed here.
jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

describe('Decabill data-list helpers', () => {
  it('builds the shared row-menu entries', () => {
    expect(dbOpenItem().id).toBe('open');
    expect(dbCopyIdItem()).toEqual(expect.objectContaining({ id: 'copy-id', dividerBefore: true }));
  });

  it('summarises a bulk run per item (done / not allowed / failed)', async () => {
    const result = await fpcRunBulk(['a', 'b', 'c'], async (item) => {
      if (item === 'b') throw { status: 403, message: 'forbidden' };

      if (item === 'c') throw new Error('boom');
    });
    const summary = dbBulkSummary(result, (item) => item.toUpperCase());

    expect(summary.tone).toBe('warning');
    expect(summary.message).toContain('1 done');
    expect(summary.message).toContain('1 not allowed');
    expect(summary.message).toContain('1 failed');
    expect(summary.message).toContain('C (boom)');
  });

  it('maps enum values to readable state labels with tones (unknown → raw / neutral)', () => {
    expect(subscriptionState('pending_cancel')).toEqual(
      expect.objectContaining({ label: 'Pending cancellation', tone: 'info' }),
    );
    expect(invoiceState('overdue')).toEqual(expect.objectContaining({ label: 'Overdue', tone: 'danger' }));
    expect(projectState('archived')).toEqual(expect.objectContaining({ label: 'Archived', tone: 'neutral' }));
    expect(projectState('other').label).toBe('other');
    expect(timeEntryBillingState(true).label).toBe('Billed');
  });

  it('renders invoice tax breakdown and totals as key-value rows', () => {
    expect(invoiceTaxItems({ taxBreakdown: [{ taxRate: 19, taxAmount: 3.8 }] }, 'en-US')).toEqual([
      { key: 'tax-0', label: '19%', value: '€3.80' },
    ]);
    expect(
      invoiceSummaryItems({ subtotalNet: 20, taxTotal: 3.8, totalGross: 23.8, balanceDue: 0 }, 'en-US').map(
        (i) => i.value,
      ),
    ).toEqual(['€20.00', '€3.80', '€23.80', '€0.00']);
  });

  it('loads the page on page / size changes at once and debounces search (replace-page)', fakeAsync(() => {
    const calls: DbPageQuery[] = [];
    const paging = runInInjectionContext(TestBed.inject(Injector), () => dbServerPaging((query) => calls.push(query)));
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    expect(calls).toEqual([{ search: undefined, page: 1, pageSize: 25 }]);

    paging.page.set(3);
    appRef.tick();
    expect(calls.at(-1)).toEqual({ search: undefined, page: 3, pageSize: 25 });

    paging.search.set('acme');
    paging.page.set(1);
    appRef.tick();
    tick(300);
    appRef.tick();
    expect(calls.at(-1)).toEqual({ search: 'acme', page: 1, pageSize: 25 });

    paging.reload();
    expect(calls.at(-1)).toEqual({ search: 'acme', page: 1, pageSize: 25 });
  }));

  it('goes back to page 1 when a tracked filter changes (one load of the new filter)', fakeAsync(() => {
    const calls: DbPageQuery[] = [];
    const scope = signal('tenant');
    const paging = runInInjectionContext(TestBed.inject(Injector), () =>
      dbServerPaging((query) => calls.push(query), { filters: () => scope() }),
    );
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    paging.page.set(4);
    appRef.tick();
    expect(calls.at(-1)).toEqual({ search: undefined, page: 4, pageSize: 25 });

    const before = calls.length;

    scope.set('unified');
    appRef.tick();
    expect(paging.page()).toBe(1);
    expect(calls.slice(before)).toEqual([{ search: undefined, page: 1, pageSize: 25 }]);
  }));

  it('seeds search / page / size from the URL keys of its prefix', fakeAsync(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ 'hist-q': 'acme', 'hist-p': '3', 'hist-n': '50' }) },
          },
        },
      ],
    });
    const calls: DbPageQuery[] = [];
    const paging = runInInjectionContext(TestBed.inject(Injector), () =>
      dbServerPaging((query) => calls.push(query), { url: 'hist-' }),
    );

    TestBed.inject(ApplicationRef).tick();
    expect(paging.search()).toBe('acme');
    expect(calls[0]).toEqual({ search: 'acme', page: 3, pageSize: 50 });
    tick(300);
  }));
});
