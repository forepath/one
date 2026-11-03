import { DatePipe } from '@angular/common';
import { ApplicationRef, ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  AvailabilityService,
  BackordersFacade,
  BackordersService,
  CustomerProfileFacade,
  PromotionsFacade,
  ServicePlansFacade,
  ServicePlansService,
  ServiceTypesFacade,
  ServiceTypesService,
  SubscriptionConfigChangeFacade,
  SubscriptionServerInfoFacade,
  SubscriptionsFacade,
  SubscriptionsService,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { EMPTY, of, throwError } from 'rxjs';

import { SubscriptionsComponent } from './subscriptions.component';

jest.mock('../billing-country-options', () => ({
  BILLING_COUNTRY_OPTIONS: [],
  DEFAULT_BILLING_COUNTRY_CODE: 'DE',
  getCountryDisplayName: (code: string) => code,
}));
jest.mock('../monaco-editor-wrapper/monaco-editor-wrapper.component', () => {
  const { Component } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-monaco-editor-wrapper', standalone: true, template: '' })
  class MonacoEditorWrapperComponent {}

  return { MonacoEditorWrapperComponent };
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

describe('SubscriptionsComponent (bulk actions)', () => {
  let subscriptionsService: Record<string, jest.Mock>;
  let backordersService: Record<string, jest.Mock>;
  let backordersFacade: Record<string, jest.Mock>;
  let component: SubscriptionsComponent;

  beforeEach(() => {
    subscriptionsService = { resumeSubscription: jest.fn() };
    backordersService = { retryBackorder: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { billing: {}, cookieConsent: { urls: { terms: '', privacyPolicy: '' } } } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) },
        },
        {
          provide: Router,
          useValue: {
            events: EMPTY,
            url: '/subscriptions',
            parseUrl: () => ({ queryParams: {} }),
            navigate: jest.fn(() => Promise.resolve(true)),
          },
        },
        {
          provide: SubscriptionsFacade,
          useValue: stub({
            getSubscriptions$: jest.fn(() =>
              of([
                { id: 's1', number: 'SUB-1', status: 'pending_cancel', planId: 'p' },
                { id: 's2', number: 'SUB-2', status: 'pending_cancel', planId: 'p' },
                { id: 's3', number: 'SUB-3', status: 'active', planId: 'p' },
              ]),
            ),
          }),
        },
        {
          provide: BackordersFacade,
          useValue: (backordersFacade = stub({
            getPendingBackorders$: jest.fn(() =>
              of([
                { id: 'b1', planId: 'p', status: 'pending' },
                { id: 'b2', planId: 'p', status: 'pending' },
              ]),
            ),
          }) as Record<string, jest.Mock>),
        },
        { provide: SubscriptionsService, useValue: stub(subscriptionsService) },
        { provide: BackordersService, useValue: stub(backordersService) },
        { provide: SubscriptionConfigChangeFacade, useValue: stub() },
        { provide: SubscriptionServerInfoFacade, useValue: stub() },
        { provide: ServicePlansFacade, useValue: stub() },
        { provide: ServicePlansService, useValue: stub() },
        { provide: ServiceTypesFacade, useValue: stub() },
        { provide: ServiceTypesService, useValue: stub() },
        { provide: AvailabilityService, useValue: stub() },
        { provide: CustomerProfileFacade, useValue: stub() },
        { provide: PromotionsFacade, useValue: stub() },
      ],
    });
    component = TestBed.runInInjectionContext(() => new SubscriptionsComponent());
  });

  it('bulk Resume resumes only subscriptions pending cancellation, per-item results incl. denied', async () => {
    subscriptionsService['resumeSubscription'].mockImplementation((id: string) =>
      id === 's2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedSubscriptions.set(['s1', 's2', 's3']);

    await component.resumeSelected();

    expect(subscriptionsService['resumeSubscription']).toHaveBeenCalledTimes(2);
    expect(subscriptionsService['resumeSubscription']).not.toHaveBeenCalledWith('s3');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedSubscriptions()).toEqual([]);
  });

  it('bulk Retry retries each selected backorder, per-item results incl. denied', async () => {
    backordersService['retryBackorder'].mockImplementation((id: string) =>
      id === 'b1' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedBackorders.set(['b1', 'b2']);

    await component.retrySelectedBackorders();

    expect(backordersService['retryBackorder']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('loads the pending backorders page only on the Backorders tab and reloads that page after a bulk Retry', async () => {
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    expect(backordersFacade['loadBackorders']).not.toHaveBeenCalled();

    component.onMobilePanelTabChange('backorders');
    appRef.tick();
    component.backordersPaging.page.set(2);
    appRef.tick();
    expect(backordersFacade['loadBackorders']).toHaveBeenLastCalledWith({
      search: undefined,
      limit: 25,
      offset: 25,
      status: ['pending', 'retrying'],
    });

    backordersService['retryBackorder'].mockReturnValue(of({}));
    component.selectedBackorders.set(['b1']);
    await component.retrySelectedBackorders();
    expect(backordersFacade['loadBackorders']).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }));
  });
});
