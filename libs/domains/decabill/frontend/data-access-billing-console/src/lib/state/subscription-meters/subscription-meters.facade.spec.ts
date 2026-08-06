import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type { CreateUsageMeterEntryDto, UpdateUsageMeterEntryDto } from '../../types/billing.types';

import {
  clearSubscriptionMeters,
  createMeterEntry,
  deleteMeterEntry,
  loadMeterEntries,
  loadSubscriptionMeters,
  updateMeterEntry,
} from './subscription-meters.actions';
import { SubscriptionMetersFacade } from './subscription-meters.facade';

describe('SubscriptionMetersFacade', () => {
  let facade: SubscriptionMetersFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [SubscriptionMetersFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(SubscriptionMetersFacade);
    store.select.mockReturnValue(of([]));
  });

  it('dispatches load actions', () => {
    facade.loadSummaries('sub-1');
    facade.loadEntries('sub-1');
    facade.loadAll('sub-1');

    expect(store.dispatch).toHaveBeenCalledWith(loadSubscriptionMeters({ subscriptionId: 'sub-1' }));
    expect(store.dispatch).toHaveBeenCalledWith(loadMeterEntries({ subscriptionId: 'sub-1' }));
  });

  it('dispatches entry mutations', () => {
    const createDto: CreateUsageMeterEntryDto = {
      meterId: 'meter-1',
      value: 10,
      periodStart: '2026-01-01T00:00:00Z',
      periodEnd: '2026-01-31T23:59:59Z',
    };
    const updateDto: UpdateUsageMeterEntryDto = { value: 20 };

    facade.createEntry('sub-1', createDto);
    facade.updateEntry('sub-1', 'entry-1', updateDto);
    facade.deleteEntry('sub-1', 'entry-1');
    facade.clear();

    expect(store.dispatch).toHaveBeenCalledWith(createMeterEntry({ subscriptionId: 'sub-1', entry: createDto }));
    expect(store.dispatch).toHaveBeenCalledWith(
      updateMeterEntry({ subscriptionId: 'sub-1', entryId: 'entry-1', entry: updateDto }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(deleteMeterEntry({ subscriptionId: 'sub-1', entryId: 'entry-1' }));
    expect(store.dispatch).toHaveBeenCalledWith(clearSubscriptionMeters());
  });
});
