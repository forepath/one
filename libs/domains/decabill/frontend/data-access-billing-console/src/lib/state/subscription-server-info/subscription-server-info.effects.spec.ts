import { TestBed } from '@angular/core/testing';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { SubscriptionItemsService } from '../../services/subscription-items.service';
import type { ServerInfoResponse, SubscriptionItemResponse, SubscriptionResponse } from '../../types/billing.types';

import {
  loadOverviewServerInfo,
  refreshSubscriptionServerInfoSuccess,
  restartServer,
  restartServerFailure,
  restartServerSuccess,
  startServer,
  startServerFailure,
  startServerSuccess,
  stopServer,
  stopServerFailure,
  stopServerSuccess,
} from './subscription-server-info.actions';
import { loadOverviewServerInfoFailure, loadOverviewServerInfoSuccess } from './subscription-server-info.actions';
import {
  loadOverviewServerInfoEffect,
  restartServerEffect,
  startServerEffect,
  stopServerEffect,
} from './subscription-server-info.effects';

function mockBillingEnvironment(websocketUrl?: string): Environment {
  return { billing: { restApiUrl: '', frontendUrl: '', websocketUrl } } as Environment;
}

describe('Subscription Server Info Effects', () => {
  let actions$: Actions;
  let subscriptionItemsService: jest.Mocked<SubscriptionItemsService>;
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    number: 'SUB-001',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockItem: SubscriptionItemResponse = {
    id: 'item-1',
    subscriptionId: 'sub-1',
    serviceTypeId: 'st-1',
    provisioningStatus: 'active',
  };
  const mockServerInfo: ServerInfoResponse = {
    name: 'server-1',
    publicIp: '1.2.3.4',
    status: 'running',
  };
  const createMockStore = (entities: SubscriptionResponse[]) => ({
    select: () => of(entities),
  });

  beforeEach(() => {
    subscriptionItemsService = {
      listSubscriptionItems: jest.fn(),
      getServerInfo: jest.fn(),
      startServer: jest.fn(),
      stopServer: jest.fn(),
      restartServer: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: SubscriptionItemsService, useValue: subscriptionItemsService },
        { provide: ENVIRONMENT, useValue: mockBillingEnvironment() },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should return loadOverviewServerInfoSuccess with empty map when no subscriptions', (done) => {
    const store = createMockStore([]);

    actions$ = of(loadOverviewServerInfo());

    loadOverviewServerInfoEffect(actions$, store as never, subscriptionItemsService).subscribe((result) => {
      expect(result).toEqual(
        loadOverviewServerInfoSuccess({
          serverInfoBySubscriptionId: {},
          activeItemIdBySubscriptionId: {},
          serviceBySubscriptionId: {},
        }),
      );
      done();
    });
  });

  it('should return loadOverviewServerInfoSuccess with server info when subscription has active item', (done) => {
    const store = createMockStore([mockSubscription]);

    subscriptionItemsService.listSubscriptionItems.mockReturnValue(of([mockItem]));
    subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
    actions$ = of(loadOverviewServerInfo());

    loadOverviewServerInfoEffect(actions$, store as never, subscriptionItemsService).subscribe((result) => {
      expect(result).toEqual(
        loadOverviewServerInfoSuccess({
          serverInfoBySubscriptionId: { 'sub-1': mockServerInfo },
          activeItemIdBySubscriptionId: { 'sub-1': 'item-1' },
          serviceBySubscriptionId: { 'sub-1': 'controller' },
        }),
      );
      expect(subscriptionItemsService.listSubscriptionItems).toHaveBeenCalledWith('sub-1');
      expect(subscriptionItemsService.getServerInfo).toHaveBeenCalledWith('sub-1', 'item-1');
      done();
    });
  });

  it('should return loadOverviewServerInfoSuccess with empty map when subscription has no active item', (done) => {
    const store = createMockStore([mockSubscription]);

    subscriptionItemsService.listSubscriptionItems.mockReturnValue(
      of([{ ...mockItem, provisioningStatus: 'pending' as const }]),
    );
    actions$ = of(loadOverviewServerInfo());

    loadOverviewServerInfoEffect(actions$, store as never, subscriptionItemsService).subscribe((result) => {
      expect(result).toEqual(
        loadOverviewServerInfoSuccess({
          serverInfoBySubscriptionId: {},
          activeItemIdBySubscriptionId: {},
          serviceBySubscriptionId: {},
        }),
      );
      expect(subscriptionItemsService.getServerInfo).not.toHaveBeenCalled();
      done();
    });
  });

  it('should return loadOverviewServerInfoFailure on API error', (done) => {
    const store = createMockStore([mockSubscription]);

    subscriptionItemsService.listSubscriptionItems.mockReturnValue(throwError(() => new Error('List items failed')));
    actions$ = of(loadOverviewServerInfo());

    loadOverviewServerInfoEffect(actions$, store as never, subscriptionItemsService).subscribe((result) => {
      expect(result).toEqual(loadOverviewServerInfoFailure({ error: 'List items failed' }));
      done();
    });
  });

  it('should only request items and server info for active subscriptions, not canceled', (done) => {
    const canceledSubscription: SubscriptionResponse = {
      ...mockSubscription,
      id: 'sub-canceled',
      number: 'SUB-002',
      status: 'canceled',
    };
    const store = createMockStore([mockSubscription, canceledSubscription]);

    subscriptionItemsService.listSubscriptionItems.mockReturnValue(of([mockItem]));
    subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
    actions$ = of(loadOverviewServerInfo());

    loadOverviewServerInfoEffect(actions$, store as never, subscriptionItemsService).subscribe((result) => {
      expect(result).toEqual(
        loadOverviewServerInfoSuccess({
          serverInfoBySubscriptionId: { 'sub-1': mockServerInfo },
          activeItemIdBySubscriptionId: { 'sub-1': 'item-1' },
          serviceBySubscriptionId: { 'sub-1': 'controller' },
        }),
      );
      expect(subscriptionItemsService.listSubscriptionItems).toHaveBeenCalledTimes(1);
      expect(subscriptionItemsService.listSubscriptionItems).toHaveBeenCalledWith('sub-1');
      expect(subscriptionItemsService.listSubscriptionItems).not.toHaveBeenCalledWith('sub-canceled');
      done();
    });
  });

  describe('startServerEffect', () => {
    it('should dispatch startServerSuccess and refreshSubscriptionServerInfoSuccess on success', (done) => {
      subscriptionItemsService.startServer.mockReturnValue(of({ success: true }));
      subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
      actions$ = of(startServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      const results: unknown[] = [];

      startServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe({
        next: (r) => results.push(r),
        complete: () => {
          expect(results).toContainEqual(startServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }));
          expect(results).toContainEqual(
            refreshSubscriptionServerInfoSuccess({
              subscriptionId: 'sub-1',
              serverInfo: mockServerInfo,
              clearActionInProgress: true,
            }),
          );
          expect(subscriptionItemsService.startServer).toHaveBeenCalledWith('sub-1', 'item-1');
          expect(subscriptionItemsService.getServerInfo).toHaveBeenCalledWith('sub-1', 'item-1');
          done();
        },
      });
    });

    it('should dispatch startServerFailure on API error', (done) => {
      subscriptionItemsService.startServer.mockReturnValue(throwError(() => new Error('Start failed')));
      actions$ = of(startServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      startServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe((result) => {
        expect(result).toEqual(startServerFailure({ subscriptionId: 'sub-1', error: 'Start failed' }));
        done();
      });
    });

    it('should dispatch refresh with clearActionInProgress false when billing websocket URL is set', (done) => {
      subscriptionItemsService.startServer.mockReturnValue(of({ success: true }));
      subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
      actions$ = of(startServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      const results: unknown[] = [];

      startServerEffect(
        actions$,
        subscriptionItemsService,
        mockBillingEnvironment('wss://billing.example/ws'),
      ).subscribe({
        next: (r) => results.push(r),
        complete: () => {
          expect(results).toContainEqual(
            refreshSubscriptionServerInfoSuccess({
              subscriptionId: 'sub-1',
              serverInfo: mockServerInfo,
              clearActionInProgress: false,
            }),
          );
          done();
        },
      });
    });
  });

  describe('stopServerEffect', () => {
    it('should dispatch stopServerSuccess and refreshSubscriptionServerInfoSuccess on success', (done) => {
      subscriptionItemsService.stopServer.mockReturnValue(of({ success: true }));
      subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
      actions$ = of(stopServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      const results: unknown[] = [];

      stopServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe({
        next: (r) => results.push(r),
        complete: () => {
          expect(results).toContainEqual(stopServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }));
          expect(results).toContainEqual(
            refreshSubscriptionServerInfoSuccess({
              subscriptionId: 'sub-1',
              serverInfo: mockServerInfo,
              clearActionInProgress: true,
            }),
          );
          done();
        },
      });
    });

    it('should dispatch stopServerFailure on API error', (done) => {
      subscriptionItemsService.stopServer.mockReturnValue(throwError(() => new Error('Stop failed')));
      actions$ = of(stopServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      stopServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe((result) => {
        expect(result).toEqual(stopServerFailure({ subscriptionId: 'sub-1', error: 'Stop failed' }));
        done();
      });
    });
  });

  describe('restartServerEffect', () => {
    it('should dispatch restartServerSuccess and refreshSubscriptionServerInfoSuccess on success', (done) => {
      subscriptionItemsService.restartServer.mockReturnValue(of({ success: true }));
      subscriptionItemsService.getServerInfo.mockReturnValue(of(mockServerInfo));
      actions$ = of(restartServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      const results: unknown[] = [];

      restartServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe({
        next: (r) => results.push(r),
        complete: () => {
          expect(results).toContainEqual(restartServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }));
          expect(results).toContainEqual(
            refreshSubscriptionServerInfoSuccess({
              subscriptionId: 'sub-1',
              serverInfo: mockServerInfo,
              clearActionInProgress: true,
            }),
          );
          done();
        },
      });
    });

    it('should dispatch restartServerFailure on API error', (done) => {
      subscriptionItemsService.restartServer.mockReturnValue(throwError(() => new Error('Restart failed')));
      actions$ = of(restartServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));

      restartServerEffect(actions$, subscriptionItemsService, mockBillingEnvironment()).subscribe((result) => {
        expect(result).toEqual(restartServerFailure({ subscriptionId: 'sub-1', error: 'Restart failed' }));
        done();
      });
    });
  });
});
