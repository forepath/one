import type { SubscriptionMeterSummary, UsageMeterEntryResponse } from '../../types/billing.types';

import {
  clearSubscriptionMeters,
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
import { initialSubscriptionMetersState, subscriptionMetersReducer } from './subscription-meters.reducer';

describe('subscriptionMetersReducer', () => {
  const summary: SubscriptionMeterSummary = {
    meterId: 'meter-1',
    key: 'api_calls',
    name: 'API Calls',
    aggregator: 'max',
    attachmentType: 'plan',
    effectiveUnitPriceNet: 0.01,
    effectiveIncludedUsage: 10,
    aggregatedValue: 100,
    billableValue: 90,
    estimatedChargeNet: 1,
    entryCount: 2,
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

  it('returns the initial state', () => {
    expect(subscriptionMetersReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialSubscriptionMetersState);
  });

  it('loads summaries and entries', () => {
    const loadingSummaries = subscriptionMetersReducer(
      initialSubscriptionMetersState,
      loadSubscriptionMeters({ subscriptionId: 'sub-1' }),
    );
    const loadedSummaries = subscriptionMetersReducer(
      loadingSummaries,
      loadSubscriptionMetersSuccess({ subscriptionId: 'sub-1', summaries: [summary] }),
    );
    const loadingEntries = subscriptionMetersReducer(loadedSummaries, loadMeterEntries({ subscriptionId: 'sub-1' }));
    const loadedEntries = subscriptionMetersReducer(
      loadingEntries,
      loadMeterEntriesSuccess({ subscriptionId: 'sub-1', entries: [entry], total: 1 }),
    );

    expect(loadingSummaries.loadingSummaries).toBe(true);
    expect(loadedSummaries.summaries).toEqual([summary]);
    expect(loadedEntries.entries).toEqual([entry]);
    expect(loadedEntries.entriesTotal).toBe(1);
  });

  it('pages the entries (replace-page with total; another subscription starts empty)', () => {
    const loaded = subscriptionMetersReducer(
      subscriptionMetersReducer(
        initialSubscriptionMetersState,
        loadMeterEntries({ subscriptionId: 'sub-1', page: 2, pageSize: 50 }),
      ),
      loadMeterEntriesSuccess({ subscriptionId: 'sub-1', entries: [entry], total: 80 }),
    );
    const nextPage = subscriptionMetersReducer(loaded, loadMeterEntries({ subscriptionId: 'sub-1', page: 1 }));
    const replaced = subscriptionMetersReducer(
      nextPage,
      loadMeterEntriesSuccess({ subscriptionId: 'sub-1', entries: [{ ...entry, id: 'entry-9' }], total: 80 }),
    );
    const other = subscriptionMetersReducer(replaced, loadMeterEntries({ subscriptionId: 'sub-2' }));

    expect(loaded.entriesPage).toBe(2);
    expect(loaded.entriesPageSize).toBe(50);
    expect(loaded.entriesTotal).toBe(80);
    expect(nextPage.entries).toEqual([entry]);
    expect(nextPage.entriesPageSize).toBe(50);
    expect(replaced.entries.map((e) => e.id)).toEqual(['entry-9']);
    expect(other.entries).toEqual([]);
    expect(other.entriesTotal).toBe(0);
    expect(other.entriesPage).toBe(1);
  });

  it('stores failures', () => {
    const summaryFailed = subscriptionMetersReducer(
      { ...initialSubscriptionMetersState, loadingSummaries: true },
      loadSubscriptionMetersFailure({ error: 'Summary failed' }),
    );
    const entriesFailed = subscriptionMetersReducer(
      { ...initialSubscriptionMetersState, loadingEntries: true },
      loadMeterEntriesFailure({ error: 'Entries failed' }),
    );

    expect(summaryFailed.error).toBe('Summary failed');
    expect(entriesFailed.error).toBe('Entries failed');
  });

  it('creates, updates, and deletes entries', () => {
    const withEntry = subscriptionMetersReducer(
      initialSubscriptionMetersState,
      loadMeterEntriesSuccess({ subscriptionId: 'sub-1', entries: [entry], total: 1 }),
    );
    const creating = subscriptionMetersReducer(
      withEntry,
      createMeterEntry({ subscriptionId: 'sub-1', entry: {} as never }),
    );
    const created = subscriptionMetersReducer(
      creating,
      createMeterEntrySuccess({ subscriptionId: 'sub-1', entry: { ...entry, id: 'entry-2' } }),
    );
    const updating = subscriptionMetersReducer(
      created,
      updateMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id, entry: { value: 60 } }),
    );
    const updated = subscriptionMetersReducer(
      updating,
      updateMeterEntrySuccess({ subscriptionId: 'sub-1', entry: { ...entry, value: 60 } }),
    );
    const deleting = subscriptionMetersReducer(
      updated,
      deleteMeterEntry({ subscriptionId: 'sub-1', entryId: entry.id }),
    );
    const deleted = subscriptionMetersReducer(
      deleting,
      deleteMeterEntrySuccess({ subscriptionId: 'sub-1', entryId: entry.id }),
    );
    const createFailed = subscriptionMetersReducer(creating, createMeterEntryFailure({ error: 'Create failed' }));
    const updateFailed = subscriptionMetersReducer(updating, updateMeterEntryFailure({ error: 'Update failed' }));
    const deleteFailed = subscriptionMetersReducer(deleting, deleteMeterEntryFailure({ error: 'Delete failed' }));
    const cleared = subscriptionMetersReducer(updated, clearSubscriptionMeters());

    // Create no longer appends (the page is reloaded by an effect); delete removes the row at once.
    expect(created.entries).toHaveLength(1);
    expect(created.creating).toBe(false);
    expect(updated.entries[0].value).toBe(60);
    expect(deleted.entries).toHaveLength(0);
    expect(createFailed.creating).toBe(false);
    expect(updateFailed.updating).toBe(false);
    expect(deleteFailed.deleting).toBe(false);
    expect(cleared).toEqual(initialSubscriptionMetersState);
  });
});
