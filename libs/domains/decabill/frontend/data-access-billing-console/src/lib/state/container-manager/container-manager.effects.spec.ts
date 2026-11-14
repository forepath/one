import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import { ContainerManagerService } from '../../services/container-manager.service';
import type {
  ContainerManagerContainersResponse,
  ContainerManagerLogsResponse,
  ContainerManagerNetworksResponse,
  ContainerManagerStatsHistoryResponse,
} from '../../types/billing.types';

import {
  enterContainerManager,
  loadContainersFailure,
  loadContainersSuccess,
  loadLogs,
  loadLogsFailure,
  loadLogsSuccess,
  loadNetworksFailure,
  loadNetworksSuccess,
  loadStatsHistory,
  loadStatsHistoryFailure,
  loadStatsHistorySuccess,
  selectContainer,
} from './container-manager.actions';
import {
  loadContainerManagerContainers$,
  loadContainerManagerLogs$,
  loadContainerManagerNetworks$,
  loadContainerManagerStatsHistory$,
  loadLogsAfterContainers$,
  loadLogsOnSelect$,
  loadStatsHistoryAfterContainers$,
  loadStatsHistoryOnSelect$,
} from './container-manager.effects';
import { initialContainerManagerState } from './container-manager.reducer';

describe('containerManagerEffects', () => {
  let actions$: Actions;
  let containerManagerService: jest.Mocked<ContainerManagerService>;
  let store: { select: jest.Mock };
  const containersResponse: ContainerManagerContainersResponse = {
    containers: [
      {
        id: 'ctr-1',
        name: 'web',
        image: 'nginx',
        state: 'running',
        status: 'Up',
        createdAt: null,
        stats: null,
      },
    ],
    collectedAt: '2026-08-13T12:00:00.000Z',
  };
  const networksResponse: ContainerManagerNetworksResponse = {
    networks: [],
    topology: { nodes: [], edges: [] },
    hostInterfaces: [],
    hostRoutes: [],
    collectedAt: '2026-08-13T12:00:00.000Z',
  };
  const statsResponse: ContainerManagerStatsHistoryResponse = {
    containerId: 'ctr-1',
    points: [],
  };
  const logsResponse: ContainerManagerLogsResponse = {
    containerId: 'ctr-1',
    lines: ['hello'],
    collectedAt: '2026-08-13T12:00:00.000Z',
    truncated: false,
    tail: 200,
  };

  beforeEach(() => {
    containerManagerService = {
      listContainers: jest.fn(),
      listNetworks: jest.fn(),
      getStatsHistory: jest.fn(),
      getLogs: jest.fn(),
    } as never;
    store = {
      select: jest.fn(() =>
        of({
          ...initialContainerManagerState,
          subscriptionId: 'sub-1',
          itemId: 'item-1',
          adminMode: false,
        }),
      ),
    };

    // Prefer selector-driven values via state shape for withLatestFrom selectors.
    store.select = jest.fn((selector: (state: unknown) => unknown) =>
      of(
        selector({
          containerManager: {
            ...initialContainerManagerState,
            subscriptionId: 'sub-1',
            itemId: 'item-1',
            adminMode: false,
          },
        }),
      ),
    );

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: ContainerManagerService, useValue: containerManagerService },
        { provide: Store, useValue: store },
      ],
    });
  });

  it('loads containers on enter', (done) => {
    containerManagerService.listContainers.mockReturnValue(of(containersResponse));
    actions$ = of(enterContainerManager({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    TestBed.runInInjectionContext(() => loadContainerManagerContainers$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadContainersSuccess({ response: containersResponse }));
      expect(containerManagerService.listContainers).toHaveBeenCalledWith('sub-1', 'item-1', false);
      done();
    });
  });

  it('maps container load failures', (done) => {
    containerManagerService.listContainers.mockReturnValue(throwError(() => new Error('boom')));
    actions$ = of(enterContainerManager({ subscriptionId: 'sub-1', itemId: 'item-1', adminMode: true }));

    TestBed.runInInjectionContext(() => loadContainerManagerContainers$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadContainersFailure({ error: 'boom' }));
      expect(containerManagerService.listContainers).toHaveBeenCalledWith('sub-1', 'item-1', true);
      done();
    });
  });

  it('loads networks on enter', (done) => {
    containerManagerService.listNetworks.mockReturnValue(of(networksResponse));
    actions$ = of(enterContainerManager({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    TestBed.runInInjectionContext(() => loadContainerManagerNetworks$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadNetworksSuccess({ response: networksResponse }));
      done();
    });
  });

  it('maps network load failures', (done) => {
    containerManagerService.listNetworks.mockReturnValue(throwError(() => new Error('net')));
    actions$ = of(enterContainerManager({ subscriptionId: 'sub-1', itemId: 'item-1' }));

    TestBed.runInInjectionContext(() => loadContainerManagerNetworks$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadNetworksFailure({ error: 'net' }));
      done();
    });
  });

  it('loads stats history after containers succeed', (done) => {
    actions$ = of(loadContainersSuccess({ response: containersResponse }));

    TestBed.runInInjectionContext(() => loadStatsHistoryAfterContainers$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadStatsHistory({ containerId: 'ctr-1', adminMode: false }));
      done();
    });
  });

  it('loads stats history on container select', (done) => {
    actions$ = of(selectContainer({ containerId: 'ctr-1' }));

    TestBed.runInInjectionContext(() => loadStatsHistoryOnSelect$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadStatsHistory({ containerId: 'ctr-1', adminMode: false }));
      done();
    });
  });

  it('loads stats history from the API', (done) => {
    containerManagerService.getStatsHistory.mockReturnValue(of(statsResponse));
    actions$ = of(loadStatsHistory({ containerId: 'ctr-1' }));

    TestBed.runInInjectionContext(() => loadContainerManagerStatsHistory$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadStatsHistorySuccess({ response: statsResponse }));
      expect(containerManagerService.getStatsHistory).toHaveBeenCalledWith('sub-1', 'item-1', 'ctr-1', false);
      done();
    });
  });

  it('maps stats history failures', (done) => {
    containerManagerService.getStatsHistory.mockReturnValue(throwError(() => new Error('stats')));
    actions$ = of(loadStatsHistory({ containerId: 'ctr-1', adminMode: true }));

    TestBed.runInInjectionContext(() => loadContainerManagerStatsHistory$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadStatsHistoryFailure({ error: 'stats' }));
      done();
    });
  });

  it('loads logs after containers succeed', (done) => {
    actions$ = of(loadContainersSuccess({ response: containersResponse }));

    TestBed.runInInjectionContext(() => loadLogsAfterContainers$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadLogs({ containerId: 'ctr-1', adminMode: false }));
      done();
    });
  });

  it('loads logs on container select', (done) => {
    actions$ = of(selectContainer({ containerId: 'ctr-1' }));

    TestBed.runInInjectionContext(() => loadLogsOnSelect$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadLogs({ containerId: 'ctr-1', adminMode: false }));
      done();
    });
  });

  it('loads logs from the API', (done) => {
    containerManagerService.getLogs.mockReturnValue(of(logsResponse));
    actions$ = of(loadLogs({ containerId: 'ctr-1' }));

    TestBed.runInInjectionContext(() => loadContainerManagerLogs$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadLogsSuccess({ response: logsResponse }));
      expect(containerManagerService.getLogs).toHaveBeenCalledWith('sub-1', 'item-1', 'ctr-1', false);
      done();
    });
  });

  it('maps log load failures', (done) => {
    containerManagerService.getLogs.mockReturnValue(throwError(() => new Error('logs')));
    actions$ = of(loadLogs({ containerId: 'ctr-1', silent: true }));

    TestBed.runInInjectionContext(() => loadContainerManagerLogs$(actions$)).subscribe((action) => {
      expect(action).toEqual(loadLogsFailure({ error: 'logs', silent: true }));
      done();
    });
  });
});
