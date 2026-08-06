import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import { UsageService } from '../../services/usage.service';
import type { SubscriptionMeterSummary, UsageMeterEntryResponse } from '../../types/billing.types';

import {
  createMeterEntry,
  createMeterEntryFailure,
  createMeterEntrySuccess,
  deleteMeterEntry,
  deleteMeterEntryFailure,
  deleteMeterEntrySuccess,
  loadMeterEntries,
  loadMeterEntriesFailure,
  loadMeterEntriesSuccess,
  loadSubscriptionMeters,
  loadSubscriptionMetersFailure,
  loadSubscriptionMetersSuccess,
  updateMeterEntry,
  updateMeterEntryFailure,
  updateMeterEntrySuccess,
} from './subscription-meters.actions';
import {
  createMeterEntry$,
  deleteMeterEntry$,
  loadMeterEntries$,
  loadSubscriptionMeters$,
  updateMeterEntry$,
} from './subscription-meters.effects';

describe('subscriptionMetersEffects', () => {
  let actions$: Actions;
  let usageService: jest.Mocked<UsageService>;
  let adminBillingService: jest.Mocked<AdminBillingService>;
  const summary: SubscriptionMeterSummary = {
    meterId: 'meter-1',
    key: 'api_calls',
    name: 'API Calls',
    aggregator: 'max',
    attachmentType: 'plan',
    effectiveUnitPriceNet: 0.01,
    aggregatedValue: 100,
    estimatedChargeNet: 1,
    entryCount: 1,
  };
  const entry: UsageMeterEntryResponse = {
    id: 'entry-1',
    subscriptionId: 'sub-1',
    meterId: 'meter-1',
    value: 50,
    attachmentType: 'plan',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: '2026-01-31T23:59:59Z',
    usageSource: 'admin',
    usagePayload: {},
    createdAt: '2026-01-15T00:00:00Z',
  };

  beforeEach(() => {
    usageService = {
      getSubscriptionMeters: jest.fn(),
    } as never;
    adminBillingService = {
      listSubscriptionMeterEntries: jest.fn(),
      createSubscriptionMeterEntry: jest.fn(),
      updateSubscriptionMeterEntry: jest.fn(),
      deleteSubscriptionMeterEntry: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: UsageService, useValue: usageService },
        { provide: AdminBillingService, useValue: adminBillingService },
      ],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads summaries', (done) => {
    actions$ = of(loadSubscriptionMeters({ subscriptionId: 'sub-1' }));
    usageService.getSubscriptionMeters.mockReturnValue(of([summary]));

    const results: unknown[] = [];
    loadSubscriptionMeters$(actions$, usageService).subscribe((result) => {
      results.push(result);
      if (results.length === 1) {
        expect(result).toEqual(loadSubscriptionMetersSuccess({ subscriptionId: 'sub-1', summaries: [summary] }));
        done();
      }
    });
  });

  it('maps summary load errors', (done) => {
    actions$ = of(loadSubscriptionMeters({ subscriptionId: 'sub-1' }));
    usageService.getSubscriptionMeters.mockReturnValue(throwError(() => new Error('Failed')));

    loadSubscriptionMeters$(actions$, usageService).subscribe((result) => {
      expect(result).toEqual(loadSubscriptionMetersFailure({ error: 'Failed' }));
      done();
    });
  });

  it('loads entries', (done) => {
    actions$ = of(loadMeterEntries({ subscriptionId: 'sub-1' }));
    adminBillingService.listSubscriptionMeterEntries.mockReturnValue(of([entry]));

    loadMeterEntries$(actions$, adminBillingService).subscribe((result) => {
      expect(result).toEqual(loadMeterEntriesSuccess({ subscriptionId: 'sub-1', entries: [entry] }));
      done();
    });
  });

  it('maps entry load errors', (done) => {
    actions$ = of(loadMeterEntries({ subscriptionId: 'sub-1' }));
    adminBillingService.listSubscriptionMeterEntries.mockReturnValue(throwError(() => 'Failed'));

    loadMeterEntries$(actions$, adminBillingService).subscribe((result) => {
      expect(result).toEqual(loadMeterEntriesFailure({ error: 'Failed' }));
      done();
    });
  });

  it('creates an entry and reloads summaries', (done) => {
    actions$ = of(createMeterEntry({ subscriptionId: 'sub-1', entry: {} as never }));
    adminBillingService.createSubscriptionMeterEntry.mockReturnValue(of(entry));

    const results: unknown[] = [];
    createMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      results.push(result);
      if (results.length === 2) {
        expect(results[0]).toEqual(createMeterEntrySuccess({ subscriptionId: 'sub-1', entry }));
        expect(results[1]).toEqual(loadSubscriptionMeters({ subscriptionId: 'sub-1' }));
        done();
      }
    });
  });

  it('maps create errors', (done) => {
    actions$ = of(createMeterEntry({ subscriptionId: 'sub-1', entry: {} as never }));
    adminBillingService.createSubscriptionMeterEntry.mockReturnValue(throwError(() => new Error('Create failed')));

    createMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      expect(result).toEqual(createMeterEntryFailure({ error: 'Create failed' }));
      done();
    });
  });

  it('updates an entry and reloads summaries', (done) => {
    actions$ = of(updateMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id, entry: { value: 60 } }));
    adminBillingService.updateSubscriptionMeterEntry.mockReturnValue(of({ ...entry, value: 60 }));

    const results: unknown[] = [];
    updateMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      results.push(result);
      if (results.length === 2) {
        expect(results[0]).toEqual(
          updateMeterEntrySuccess({ subscriptionId: 'sub-1', entry: { ...entry, value: 60 } }),
        );
        done();
      }
    });
  });

  it('maps update errors', (done) => {
    actions$ = of(updateMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id, entry: { value: 60 } }));
    adminBillingService.updateSubscriptionMeterEntry.mockReturnValue(throwError(() => new Error('Update failed')));

    updateMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      expect(result).toEqual(updateMeterEntryFailure({ error: 'Update failed' }));
      done();
    });
  });

  it('deletes an entry and reloads summaries', (done) => {
    actions$ = of(deleteMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id }));
    adminBillingService.deleteSubscriptionMeterEntry.mockReturnValue(of(undefined));

    const results: unknown[] = [];
    deleteMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      results.push(result);
      if (results.length === 2) {
        expect(results[0]).toEqual(deleteMeterEntrySuccess({ subscriptionId: 'sub-1', entryId: entry.id }));
        done();
      }
    });
  });

  it('maps delete errors', (done) => {
    actions$ = of(deleteMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id }));
    adminBillingService.deleteSubscriptionMeterEntry.mockReturnValue(throwError(() => new Error('Delete failed')));

    deleteMeterEntry$(actions$, adminBillingService).subscribe((result) => {
      expect(result).toEqual(deleteMeterEntryFailure({ error: 'Delete failed' }));
      done();
    });
  });
});
