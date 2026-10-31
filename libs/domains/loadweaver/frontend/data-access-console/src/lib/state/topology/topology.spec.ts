import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of, Subject, take, toArray } from 'rxjs';

import { TopologyService } from '../../services/topology.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { TopologyEdge, TopologyGraph } from '../../types/topology.types';
import {
  connectTopologyLive,
  disconnectTopologyLive,
  loadTopology,
  loadTopologySuccess,
  topologyFlowsReceived,
  topologyLiveConnected,
  topologyLiveError,
  topologyStructureChanged,
  traceTopology,
  traceTopologySuccess,
} from './topology.actions';
import { loadTopology$, reloadTopologyOnStructureChange$, topologyLive$, traceTopology$ } from './topology.effects';
import { consoleTopologyReducer, initialConsoleTopologyState } from './topology.reducer';
import { mergeLiveFlows, selectTopologyAt, selectTopologyGraph } from './topology.selectors';

// The real socket service pulls in the identity lib (Keycloak, ES modules only); the effect gets a stub.
jest.mock('../../sockets/console-socket', () => ({ ConsoleSocketService: class {} }));

function graph(overrides: Partial<TopologyGraph> = {}): TopologyGraph {
  return {
    elements: [
      { id: 'node:n1', kind: 'node', label: 'n1', data: {} },
      { id: 'replica:shop/web/api/0', kind: 'replica', label: 'api/0', parent: 'node:n1', project: 'shop', data: {} },
    ],
    edges: [
      {
        id: 'flow:a',
        kind: 'flow',
        source: 'node:n1',
        target: 'replica:shop/web/api/0',
        layer: 'policies',
        data: { decision: 'allowed' },
      },
      { id: 'tunnel:n1|n2', kind: 'tunnel', source: 'node:n1', target: 'node:n2', layer: 'tunnels', data: {} },
    ],
    at: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

const denied: TopologyEdge = {
  id: 'flow:external:203.0.113.9->replica:shop/web/api/0:tcp/22:denied',
  kind: 'flow',
  source: 'external:203.0.113.9',
  target: 'replica:shop/web/api/0',
  layer: 'policies',
  data: { decision: 'denied', bytesPerSecond: 12 },
};

describe('console topology state', () => {
  it('replaces the flow edges with the live ones and adds unknown endpoints as externals', () => {
    const merged = mergeLiveFlows(graph(), [denied]);

    expect(merged.edges.map((e) => e.id)).toEqual(['tunnel:n1|n2', denied.id]);
    expect(merged.elements.at(-1)).toEqual({
      id: 'external:203.0.113.9',
      kind: 'external',
      label: '203.0.113.9',
      data: {},
    });
    expect(mergeLiveFlows(graph(), null)).toEqual(graph());
  });

  it('keeps the map on a silent refresh, drops it for another view and ignores flows when not live', () => {
    const loaded = consoleTopologyReducer(
      consoleTopologyReducer(initialConsoleTopologyState, loadTopology({ query: { flows: true } })),
      loadTopologySuccess({ graph: graph() }),
    );

    expect(consoleTopologyReducer(loaded, loadTopology({ query: { flows: true }, silent: true })).graph).toEqual(
      graph(),
    );
    expect(consoleTopologyReducer(loaded, loadTopology({ query: { plan: 'p1' } }))).toMatchObject({
      graph: null,
      loading: true,
    });
    expect(
      consoleTopologyReducer(loaded, topologyFlowsReceived({ at: '2026-10-18T10:00:10.000Z', edges: [denied] })),
    ).toBe(loaded);

    const live = consoleTopologyReducer(
      consoleTopologyReducer(loaded, connectTopologyLive()),
      topologyFlowsReceived({ at: '2026-10-18T10:00:10.000Z', edges: [denied] }),
    );

    expect(selectTopologyAt({ consoleTopology: live })).toBe('2026-10-18T10:00:10.000Z');
    expect(selectTopologyGraph({ consoleTopology: live })?.edges.map((e) => e.id)).toContain(denied.id);
    expect(consoleTopologyReducer(live, disconnectTopologyLive())).toMatchObject({ live: false, liveFlows: null });
  });

  it('loads the map and traces a hostname', async () => {
    const service = {
      graph: jest.fn().mockReturnValue(of(graph())),
      trace: jest.fn().mockReturnValue(of({ steps: [{ kind: 'hostname', id: 'hostname:a.example', label: 'a' }] })),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadTopology({ query: { flows: true, at: '2026-10-18T09:00:00Z' } })))],
    });
    expect(await firstValueFrom(loadTopology$(TestBed.inject(Actions), service as unknown as TopologyService))).toEqual(
      loadTopologySuccess({ graph: graph() }),
    );
    expect(service.graph).toHaveBeenCalledWith({ flows: true, at: '2026-10-18T09:00:00Z' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(traceTopology({ host: 'a.example' })))],
    });
    expect(
      await firstValueFrom(traceTopology$(TestBed.inject(Actions), service as unknown as TopologyService)),
    ).toEqual(
      traceTopologySuccess({
        host: 'a.example',
        trace: { steps: [{ kind: 'hostname', id: 'hostname:a.example', label: 'a' }] },
      }),
    );
  });

  it('subscribes on connect, streams flows and unsubscribes when left', async () => {
    const handlers: Record<string, (payload?: unknown) => void> = {};
    const socket = {
      connected: true,
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => (handlers[event] = handler)),
      emit: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };
    const sockets = { open: jest.fn().mockResolvedValue(socket) };
    const actions$ = new Subject<ReturnType<typeof connectTopologyLive>>();

    TestBed.configureTestingModule({ providers: [provideMockActions(() => actions$)] });

    const result = firstValueFrom(
      topologyLive$(TestBed.inject(Actions), sockets as unknown as ConsoleSocketService).pipe(take(3), toArray()),
    );

    actions$.next(connectTopologyLive());
    await new Promise((resolve) => setTimeout(resolve));
    handlers['connect']();
    handlers['flows']({ at: '2026-10-18T10:00:10.000Z', edges: [denied] });
    handlers['error']({ message: 'live traffic needs a cluster role' });

    expect(await result).toEqual([
      topologyLiveConnected({ connected: true }),
      topologyFlowsReceived({ at: '2026-10-18T10:00:10.000Z', edges: [denied] }),
      topologyLiveError({ error: 'live traffic needs a cluster role' }),
    ]);
    expect(sockets.open).toHaveBeenCalledWith('topology');
    expect(socket.emit).toHaveBeenNthCalledWith(1, 'subscribe', { structure: true });
    expect(socket.emit).toHaveBeenLastCalledWith('unsubscribe');
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('reloads the current map quietly on a structure change (3.36 B3)', async () => {
    const handlers: Record<string, (payload?: unknown) => void> = {};
    const socket = {
      connected: true,
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => (handlers[event] = handler)),
      emit: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };
    const actions$ = new Subject<ReturnType<typeof connectTopologyLive>>();

    TestBed.configureTestingModule({ providers: [provideMockActions(() => actions$)] });

    const live = firstValueFrom(
      topologyLive$(TestBed.inject(Actions), { open: jest.fn().mockResolvedValue(socket) } as never).pipe(
        take(2),
        toArray(),
      ),
    );

    actions$.next(connectTopologyLive());
    await new Promise((resolve) => setTimeout(resolve));
    handlers['connect']();
    handlers['structureChanged']({ version: '8:12/x' });
    handlers['structureChanged']({});

    expect((await live)[1]).toEqual(topologyStructureChanged({ version: '8:12/x' }));
    expect(
      consoleTopologyReducer(initialConsoleTopologyState, topologyStructureChanged({ version: 'v2' })).structureVersion,
    ).toBe('v2');

    const reload = new Subject<ReturnType<typeof topologyStructureChanged>>();
    const store = { select: () => of({ flows: true }) } as unknown as Store;
    const next = firstValueFrom(reloadTopologyOnStructureChange$(reload as never, store));

    reload.next(topologyStructureChanged({ version: 'v3' }));
    expect(await next).toEqual(loadTopology({ query: { flows: true }, silent: true }));
  });
});
