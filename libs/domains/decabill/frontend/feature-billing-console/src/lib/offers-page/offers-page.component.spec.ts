import { DatePipe, DecimalPipe } from '@angular/common';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OffersFacade, type CustomerOfferListItem } from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { OffersPageComponent } from './offers-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const offer = (id: string, status = 'archived'): CustomerOfferListItem =>
  ({ id, offerNumber: `OF-${id}`, status, currency: 'EUR', totalGross: 119 }) as CustomerOfferListItem;

describe('OffersPageComponent (data list)', () => {
  let facade: Record<string, jest.Mock>;
  let component: OffersPageComponent;

  beforeEach(() => {
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    facade = new Proxy(
      {
        getPendingList$: jest.fn(() => of([offer('o1'), offer('o2')])),
        getHistoryList$: jest.fn(() => of([offer('o3', 'accepted')])),
        getRespondingOfferId$: jest.fn(() => of(null)),
        downloadOfferPdf: jest.fn(),
      } as Record<string, jest.Mock>,
      {
        get: (target, key: string) => {
          if (!(key in target)) target[key] = jest.fn(() => of(null));

          return target[key];
        },
      },
    );
    TestBed.configureTestingModule({
      providers: [DatePipe, DecimalPipe, { provide: OffersFacade, useValue: facade }],
    });
    component = TestBed.runInInjectionContext(() => new OffersPageComponent());
  });

  it('shows State + offer number, readable states, tabs instead of lanes, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[0].state?.(offer('o1'))).toEqual(expect.objectContaining({ label: 'Pending response' }));
    expect(component.columns[1].value?.(offer('o1'))).toBe('OF-o1');
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    component.onTabChange('history');
    expect(component.activeTab()).toBe('history');
  });

  it('bulk Download PDFs fetches one PDF per selected offer with per-item results (incl. denied)', async () => {
    facade['downloadOfferPdf'].mockImplementation((id: string) =>
      id === 'o2' ? throwError(() => ({ status: 403 })) : of(new Blob(['%PDF'])),
    );
    component.selected.set(['o1', 'o2']);

    await component.downloadSelected();

    expect(facade['downloadOfferPdf']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selected()).toEqual([]);
  });

  it('loads one server page of the shown tab only and the other tab on switch (replace-page)', () => {
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    expect(facade['loadPendingOffers']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
    expect(facade['loadHistoryOffers']).not.toHaveBeenCalled();

    component.pendingPaging.page.set(3);
    appRef.tick();
    expect(facade['loadPendingOffers']).toHaveBeenLastCalledWith({ search: undefined, page: 3, pageSize: 25 });

    component.onTabChange('history');
    appRef.tick();
    expect(facade['loadHistoryOffers']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
  });
});
