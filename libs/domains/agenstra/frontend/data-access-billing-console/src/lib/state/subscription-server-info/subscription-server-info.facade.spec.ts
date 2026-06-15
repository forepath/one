import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type { ServerInfoResponse, SubscriptionResponse } from '../../types/billing.types';

import { loadOverviewServerInfo, restartServer, startServer, stopServer } from './subscription-server-info.actions';
import { SubscriptionServerInfoFacade } from './subscription-server-info.facade';

describe('SubscriptionServerInfoFacade', () => {
  let facade: SubscriptionServerInfoFacade;
  let store: jest.Mocked<Store>;
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    number: 'SUB-001',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockServerInfo: ServerInfoResponse = {
    name: 'server-1',
    publicIp: '1.2.3.4',
    status: 'running',
  };
  const mockWithServerInfo = [
    { subscription: mockSubscription, serverInfo: mockServerInfo, itemId: 'item-1', service: 'controller' as const },
  ];

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [SubscriptionServerInfoFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(SubscriptionServerInfoFacade);
  });

  describe('State Observables', () => {
    it('should return subscriptions with server info observable', (done) => {
      store.select.mockReturnValue(of(mockWithServerInfo));
      facade.getSubscriptionsWithServerInfo$().subscribe((result) => {
        expect(result).toEqual(mockWithServerInfo);
        done();
      });
    });

    it('should return overview server info loading observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getOverviewServerInfoLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return overview server info error observable', (done) => {
      store.select.mockReturnValue(of('Load failed'));
      facade.getOverviewServerInfoError$().subscribe((result) => {
        expect(result).toBe('Load failed');
        done();
      });
    });

    it('should return server action in progress for subscription', (done) => {
      store.select.mockReturnValue(of('start'));
      facade.getServerActionInProgress$('sub-1').subscribe((result) => {
        expect(result).toBe('start');
        done();
      });
    });

    it('should return server action in progress map', (done) => {
      const map = { 'sub-1': 'restart' as const };

      store.select.mockReturnValue(of(map));
      facade.getServerActionInProgressMap$().subscribe((result) => {
        expect(result).toEqual(map);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadOverviewServerInfo', () => {
      facade.loadOverviewServerInfo();
      expect(store.dispatch).toHaveBeenCalledWith(loadOverviewServerInfo());
    });

    it('should dispatch startServer', () => {
      facade.startServer('sub-1', 'item-1');
      expect(store.dispatch).toHaveBeenCalledWith(startServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));
    });

    it('should dispatch stopServer', () => {
      facade.stopServer('sub-1', 'item-1');
      expect(store.dispatch).toHaveBeenCalledWith(stopServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));
    });

    it('should dispatch restartServer', () => {
      facade.restartServer('sub-1', 'item-1');
      expect(store.dispatch).toHaveBeenCalledWith(restartServer({ subscriptionId: 'sub-1', itemId: 'item-1' }));
    });
  });
});
