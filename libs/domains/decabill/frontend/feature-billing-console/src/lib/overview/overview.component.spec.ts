import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  BackordersFacade,
  BillingDashboardSocketFacade,
  CustomerProfileFacade,
  InvoicesFacade,
  ProjectsFacade,
  SubscriptionItemsService,
  SubscriptionServerInfoFacade,
  SubscriptionsFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { of, throwError } from 'rxjs';

import { OverviewComponent } from './overview.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));
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

const instance = (sub: string, status: string) => ({
  subscription: { id: sub, number: `SUB-${sub}`, planId: 'p' },
  itemId: `item-${sub}`,
  provisioningStatus: 'active',
  serverInfo: { status, metadata: {}, publicIp: '192.0.2.1' },
  sshAccessGranted: false,
});

describe('OverviewComponent (cloud instances bulk actions)', () => {
  let service: Record<string, jest.Mock>;
  let component: OverviewComponent;

  beforeEach(() => {
    service = { startServer: jest.fn(), stopServer: jest.fn(), restartServer: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: ENVIRONMENT, useValue: { billing: {} } },
        { provide: Router, useValue: { navigateByUrl: jest.fn(), navigate: jest.fn() } },
        { provide: SubscriptionItemsService, useValue: stub(service) },
        {
          provide: SubscriptionServerInfoFacade,
          useValue: stub({
            getSubscriptionsWithServerInfo$: jest.fn(() =>
              of([instance('a', 'running'), instance('b', 'running'), instance('c', 'off')]),
            ),
            loadOverviewServerInfo: jest.fn(),
          }),
        },
        { provide: SubscriptionsFacade, useValue: stub() },
        { provide: BillingDashboardSocketFacade, useValue: stub() },
        { provide: BackordersFacade, useValue: stub() },
        { provide: ProjectsFacade, useValue: stub() },
        { provide: CustomerProfileFacade, useValue: stub() },
        { provide: InvoicesFacade, useValue: stub() },
      ],
    });
    component = TestBed.runInInjectionContext(() => new OverviewComponent());
  });

  it('bulk Stop stops only running servers, per-item results incl. denied', async () => {
    service['stopServer'].mockImplementation((sub: string) =>
      sub === 'b' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selected.set(['a:item-a', 'b:item-b', 'c:item-c']);

    await component.runServerBulk('stop');

    expect(service['stopServer']).toHaveBeenCalledTimes(2);
    expect(service['stopServer']).toHaveBeenCalledWith('a', 'item-a');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selected()).toEqual([]);
  });

  it('bulk Start starts only powered-off servers', async () => {
    service['startServer'].mockReturnValue(of({}));
    component.selected.set(['a:item-a', 'c:item-c']);

    await component.runServerBulk('start');

    expect(service['startServer']).toHaveBeenCalledTimes(1);
    expect(service['startServer']).toHaveBeenCalledWith('c', 'item-c');
    expect(component.bulkResult()?.tone).toBe('success');
  });
});

describe('OverviewComponent (instances pager, X-12)', () => {
  const create = (instances: unknown[]) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: ENVIRONMENT, useValue: { billing: {} } },
        { provide: Router, useValue: { navigateByUrl: jest.fn(), navigate: jest.fn() } },
        { provide: SubscriptionItemsService, useValue: stub() },
        {
          provide: SubscriptionServerInfoFacade,
          useValue: stub({
            getSubscriptionsWithServerInfo$: jest.fn(() => of(instances)),
            loadOverviewServerInfo: jest.fn(),
          }),
        },
        { provide: SubscriptionsFacade, useValue: stub({ getHasMore$: jest.fn(() => of(true)) }) },
        { provide: BillingDashboardSocketFacade, useValue: stub() },
        { provide: BackordersFacade, useValue: stub() },
        { provide: ProjectsFacade, useValue: stub() },
        { provide: CustomerProfileFacade, useValue: stub() },
        { provide: InvoicesFacade, useValue: stub() },
      ],
    });

    return TestBed.runInInjectionContext(() => new OverviewComponent());
  };

  it('shows no pager while the first page has no instances, pages on once instances show', () => {
    expect(create([]).instancesHasNext()).toBe(false);

    const withRows = create([instance('a', 'running')]);

    expect(withRows.instancesHasNext()).toBe(true);
    withRows.paging.page.set(2);
    expect(withRows.instancesHasNext()).toBe(true);
  });
});
