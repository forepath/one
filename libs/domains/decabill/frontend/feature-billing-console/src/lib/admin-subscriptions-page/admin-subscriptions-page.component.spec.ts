import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminBillingFacade,
  AdminBillingService,
  AdminSubscriptionsFacade,
  MetersFacade,
  SubscriptionMetersFacade,
  type AdminSubscriptionListItem,
  type UsageMeterEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminSubscriptionsPageComponent } from './admin-subscriptions-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

/** Facade stub: unknown members are spies returning `of([])` that can also be subscribed to as streams. */
function facadeStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

const sub = (id: string, status: string): AdminSubscriptionListItem =>
  ({ id, number: `SUB-${id}`, status, planName: `Plan ${id}`, items: [] }) as unknown as AdminSubscriptionListItem;

const entry = (id: string): UsageMeterEntryResponse =>
  ({
    id,
    subscriptionId: 's1',
    meterId: 'm1',
    value: 3,
    attachmentType: 'plan',
    periodStart: '',
    periodEnd: '',
  }) as unknown as UsageMeterEntryResponse;

describe('AdminSubscriptionsPageComponent (bulk actions)', () => {
  let service: Record<string, jest.Mock>;
  let metersFacade: Record<string, unknown>;
  let component: AdminSubscriptionsPageComponent;

  beforeEach(() => {
    service = {
      cancelSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
      deleteSubscriptionMeterEntry: jest.fn(),
    };
    metersFacade = facadeStub({
      summaries$: of([]),
      entries$: of([entry('e1'), entry('e2')]),
      loadAll: jest.fn(),
      loadSummaries: jest.fn(),
      loadEntries: jest.fn(),
      entriesTotal$: of(60),
    });
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminBillingService, useValue: service },
        {
          provide: AdminSubscriptionsFacade,
          useValue: facadeStub({
            subscriptions$: of([sub('a1', 'active'), sub('a2', 'active'), sub('p1', 'pending_cancel')]),
            total$: of(3),
            loading$: of(false),
            error$: of(null),
          }),
        },
        { provide: AdminBillingFacade, useValue: facadeStub({ summary$: of(null) }) },
        { provide: MetersFacade, useValue: facadeStub() },
        { provide: SubscriptionMetersFacade, useValue: metersFacade },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminSubscriptionsPageComponent());
  });

  it('bulk Cancel uses the plural wording and cancels each active contract (incl. a denied one)', async () => {
    service['cancelSubscription'].mockImplementation((id: string) =>
      id === 'a2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selected.set(['a1', 'a2', 'p1']);

    component.openBulkCancelConfirm();
    expect(component.cancelDialogTitle()).toBe('Cancel subscriptions?');
    expect(component.cancelDialogMessage()).toContain('2 selected subscriptions');
    component.confirmDataTeardown.set(true);
    await component.cancelSelected();

    expect(service['cancelSubscription']).toHaveBeenCalledTimes(2);
    expect(service['cancelSubscription']).toHaveBeenCalledWith('a1', { confirmDataTeardown: true });
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('single Cancel keeps the singular wording', () => {
    component.openCancelConfirm(sub('a1', 'active'));
    expect(component.cancelDialogTitle()).toBe('Cancel subscription?');
  });

  it('bulk Resume resumes only contracts pending cancellation, with per-item results (incl. denied)', async () => {
    service['resumeSubscription'].mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selected.set(['a1', 'p1']);

    await component.resumeSelected();

    expect(service['resumeSubscription']).toHaveBeenCalledTimes(1);
    expect(service['resumeSubscription']).toHaveBeenCalledWith('p1');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('usage meters modal: bulk Delete of meter entries fans out per entry and reloads the meters', async () => {
    service['deleteSubscriptionMeterEntry'].mockImplementation((_sub: string, id: string) =>
      id === 'e2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.openMetersModal(sub('s1', 'active'));
    component.selectedEntries.set(['e1', 'e2']);

    await component.deleteSelectedEntries();

    expect(service['deleteSubscriptionMeterEntry']).toHaveBeenCalledWith('s1', 'e1');
    expect(component.entryBulkResult()?.message).toContain('1 done');
    expect(component.entryBulkResult()?.message).toContain('1 not allowed');
    // Summaries + the current entries page (replace-page).
    expect(metersFacade['loadAll']).toHaveBeenCalledWith('s1', 1, 25);
  });

  it('usage meters modal: entries load page 1 on open, then the requested page / size (server total)', () => {
    component.openMetersModal(sub('s1', 'active'));
    TestBed.tick();
    expect(metersFacade['loadSummaries']).toHaveBeenCalledWith('s1');
    expect(metersFacade['loadEntries']).toHaveBeenLastCalledWith('s1', 1, 25);
    expect(component.meterEntriesTotal()).toBe(60);

    component.entriesPage.set(2);
    component.entriesPageSize.set(50);
    TestBed.tick();
    expect(metersFacade['loadEntries']).toHaveBeenLastCalledWith('s1', 2, 50);

    component.selectedEntries.set([]);
    component.openMetersModal(sub('s2', 'active'));
    TestBed.tick();
    expect(metersFacade['loadEntries']).toHaveBeenLastCalledWith('s2', 1, 50);
  });
});
