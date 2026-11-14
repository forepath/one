import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import { SubscriptionItemsService } from '../../services/subscription-items.service';
import { UsageService } from '../../services/usage.service';
import type { SubscriptionItemDetailResponse, SubscriptionMeterHistory } from '../../types/billing.types';
import {
  subscribeBillingSubscriptionMeters,
  unsubscribeBillingSubscriptionMeters,
} from '../billing-dashboard-socket/billing-dashboard-socket.actions';
import { setSubscriptionItemDisplayName } from '../subscription-server-info/subscription-server-info.actions';

import { applyFilters, clearServiceDetail, enterServiceDetail, loadDetailFailure, loadDetailSuccess, loadHistory, loadHistorySuccess, meterSummaryPush, resetFilters, updateDisplayName, updateDisplayNameFailure, updateDisplayNameSuccess } from './service-detail.actions';
import { DEFAULT_METER_HISTORY_FILTERS } from './service-detail.constants';
import {
  clearServiceDetail$,
  enterServiceDetail$,
  loadServiceDetail$,
  loadServiceDetailHistory$,
  reloadServiceDetailHistoryOnFilters$,
  reloadServiceDetailHistoryOnMeterPush$,
  updateServiceDetailDisplayName$,
} from './service-detail.effects';

describe('serviceDetailEffects', () => {
  let actions$: Actions;
  let subscriptionItemsService: jest.Mocked<SubscriptionItemsService>;
  let usageService: jest.Mocked<UsageService>;
  let adminBillingService: jest.Mocked<AdminBillingService>;
  let store: { select: jest.Mock };
  const detail: SubscriptionItemDetailResponse = {
    id: 'item-1',
    subscriptionId: 'sub-1',
    serviceTypeId: 'st-1',
    provisioningStatus: 'active',
    displayName: 'My VPS',
  };
  const history: SubscriptionMeterHistory = {
    subscriptionId: 'sub-1',
    from: '2026-01-01',
    to: '2026-01-31',
    groupBy: 'day',
    meters: [],
  };

  beforeEach(() => {
    subscriptionItemsService = {
      getItemDetail: jest.fn(),
      updateDisplayName: jest.fn(),
    } as never;
    usageService = {
      getSubscriptionMeterHistory: jest.fn(),
    } as never;
    adminBillingService = {
      getAdminSubscriptionItemDetail: jest.fn(),
      getAdminSubscriptionMeterHistory: jest.fn(),
      updateAdminSubscriptionItemDisplayName: jest.fn(),
    } as never;
    store = {
      select: jest.fn((selector: (state: unknown) => unknown) =>
        of(
          selector({
            serviceDetail: {
              subscriptionId: 'sub-1',
              itemId: 'item-1',
              adminMode: false,
              detail: null,
              history: null,
              filters: DEFAULT_METER_HISTORY_FILTERS,
              loadingDetail: false,
              loadingHistory: false,
              renaming: false,
              error: null,
              metersFromSocket: null,
            },
          }),
        ),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: SubscriptionItemsService, useValue: subscriptionItemsService },
        { provide: UsageService, useValue: usageService },
        { provide: AdminBillingService, useValue: adminBillingService },
        { provide: Store, useValue: store },
      ],
    });
  });

  it('enterServiceDetail dispatches meter subscription and history load', (done) => {
    actions$ = of(enterServiceDetail({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    const emitted: unknown[] = [];

    TestBed.runInInjectionContext(() => enterServiceDetail$(actions$)).subscribe((action) => {
      emitted.push(action);

      if (emitted.length === 2) {
        expect(emitted).toEqual([
          subscribeBillingSubscriptionMeters({ subscriptionId: 'sub-1' }),
          loadHistory({ subscriptionId: 'sub-1', filters: DEFAULT_METER_HISTORY_FILTERS, adminMode: undefined }),
        ]);
        done();
      }
    });
  });

  it('loadServiceDetail loads item detail via admin API when adminMode is true', (done) => {
    adminBillingService.getAdminSubscriptionItemDetail.mockReturnValue(of(detail));
    actions$ = of(enterServiceDetail({ subscriptionId: 'sub-1', itemId: 'item-1', adminMode: true }));

    TestBed.runInInjectionContext(() =>
      loadServiceDetail$(actions$, subscriptionItemsService, adminBillingService),
    ).subscribe((action) => {
      expect(adminBillingService.getAdminSubscriptionItemDetail).toHaveBeenCalledWith('sub-1', 'item-1');
      expect(action).toEqual(loadDetailSuccess({ detail }));
      done();
    });
  });

  it('loadServiceDetail loads item detail', (done) => {
    subscriptionItemsService.getItemDetail.mockReturnValue(of(detail));
    actions$ = of(enterServiceDetail({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    TestBed.runInInjectionContext(() =>
      loadServiceDetail$(actions$, subscriptionItemsService, adminBillingService),
    ).subscribe((action) => {
      expect(action).toEqual(loadDetailSuccess({ detail }));
      done();
    });
  });

  it('loadServiceDetail maps errors', (done) => {
    subscriptionItemsService.getItemDetail.mockReturnValue(throwError(() => new Error('Not found')));
    actions$ = of(enterServiceDetail({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    TestBed.runInInjectionContext(() =>
      loadServiceDetail$(actions$, subscriptionItemsService, adminBillingService),
    ).subscribe((action) => {
      expect(action).toEqual(loadDetailFailure({ error: 'Not found' }));
      done();
    });
  });

  it('loadServiceDetailHistory uses customer or admin API', (done) => {
    usageService.getSubscriptionMeterHistory.mockReturnValue(of(history));
    adminBillingService.getAdminSubscriptionMeterHistory.mockReturnValue(of(history));

    actions$ = of(loadHistory({ subscriptionId: 'sub-1', filters: DEFAULT_METER_HISTORY_FILTERS, adminMode: true }));

    TestBed.runInInjectionContext(() => loadServiceDetailHistory$(actions$)).subscribe((action) => {
      expect(adminBillingService.getAdminSubscriptionMeterHistory).toHaveBeenCalled();
      expect(action).toEqual(loadHistorySuccess({ history }));
      done();
    });
  });

  it('reloadServiceDetailHistoryOnFilters reloads with subscription id from store', (done) => {
    actions$ = of(applyFilters({ filters: { from: '2026-02-01', to: '2026-02-28', groupBy: 'month' } }));

    TestBed.runInInjectionContext(() => reloadServiceDetailHistoryOnFilters$(actions$)).subscribe((action) => {
      expect(action).toEqual(
        loadHistory({
          subscriptionId: 'sub-1',
          filters: { from: '2026-02-01', to: '2026-02-28', groupBy: 'month' },
          adminMode: undefined,
        }),
      );
      done();
    });
  });

  it('reloadServiceDetailHistoryOnFilters resets to defaults', (done) => {
    actions$ = of(resetFilters({}));

    TestBed.runInInjectionContext(() => reloadServiceDetailHistoryOnFilters$(actions$)).subscribe((action) => {
      expect(action).toEqual(
        loadHistory({
          subscriptionId: 'sub-1',
          filters: DEFAULT_METER_HISTORY_FILTERS,
          adminMode: undefined,
        }),
      );
      done();
    });
  });

  it('reloadServiceDetailHistoryOnMeterPush reloads history for the active subscription', (done) => {
    actions$ = of(meterSummaryPush({ subscriptionId: 'sub-1', meters: [] }));

    TestBed.runInInjectionContext(() => reloadServiceDetailHistoryOnMeterPush$(actions$)).subscribe((action) => {
      expect(action).toEqual(
        loadHistory({
          subscriptionId: 'sub-1',
          filters: DEFAULT_METER_HISTORY_FILTERS,
          adminMode: false,
        }),
      );
      done();
    });
  });

  it('updateServiceDetailDisplayName updates detail and overview label', (done) => {
    subscriptionItemsService.updateDisplayName.mockReturnValue(of({ ...detail, displayName: 'Renamed' }));
    actions$ = of(updateDisplayName({ subscriptionId: 'sub-1', itemId: 'item-1', displayName: 'Renamed' }));

    const emitted: unknown[] = [];

    TestBed.runInInjectionContext(() =>
      updateServiceDetailDisplayName$(actions$, subscriptionItemsService, adminBillingService),
    ).subscribe((action) => {
      emitted.push(action);

      if (emitted.length === 2) {
        expect(emitted).toEqual([
          updateDisplayNameSuccess({ subscriptionId: 'sub-1', itemId: 'item-1', displayName: 'Renamed' }),
          setSubscriptionItemDisplayName({ subscriptionId: 'sub-1', displayName: 'Renamed' }),
        ]);
        done();
      }
    });
  });

  it('updateServiceDetailDisplayName maps rename failures', (done) => {
    subscriptionItemsService.updateDisplayName.mockReturnValue(throwError(() => new Error('Forbidden')));
    actions$ = of(updateDisplayName({ subscriptionId: 'sub-1', itemId: 'item-1', displayName: 'Renamed' }));

    TestBed.runInInjectionContext(() =>
      updateServiceDetailDisplayName$(actions$, subscriptionItemsService, adminBillingService),
    ).subscribe((action) => {
      expect(action).toEqual(updateDisplayNameFailure({ error: 'Forbidden' }));
      done();
    });
  });

  it('clearServiceDetail unsubscribes meters', (done) => {
    actions$ = of(clearServiceDetail());

    TestBed.runInInjectionContext(() => clearServiceDetail$(actions$)).subscribe((action) => {
      expect(action).toEqual(unsubscribeBillingSubscriptionMeters({ subscriptionId: 'sub-1' }));
      done();
    });
  });
});
