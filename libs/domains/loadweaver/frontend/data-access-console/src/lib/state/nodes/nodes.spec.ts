import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { NodesService } from '../../services/nodes.service';
import type { ConsoleNode, CreatedJoinToken } from '../../types/nodes.types';
import {
  createJoinTokenSuccess,
  loadNode,
  loadNodes,
  loadNodesSuccess,
  nodeAction,
  nodeActionFailure,
  nodeActionSuccess,
  revokeJoinTokenSuccess,
} from './nodes.actions';
import { loadNodes$, nodeActions$ } from './nodes.effects';
import { consoleNodesReducer, initialConsoleNodesState } from './nodes.reducer';
import { selectNodesBySite } from './nodes.selectors';

function node(overrides: Partial<ConsoleNode> = {}): ConsoleNode {
  return {
    name: 'n1',
    site: 'fra1',
    lifecycle: 'active',
    labels: {},
    controlPlane: true,
    witness: false,
    agentVersion: '1.0.0',
    os: null,
    capabilities: null,
    capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3, diskBytes: 100 * 1024 ** 3 },
    usage: { cpuMillis: 1000, memoryBytes: 2 * 1024 ** 3, diskBytes: 10 * 1024 ** 3 },
    endpointHost: 'n1.example.com',
    overlayV4: '10.255.0.1',
    overlayV6: null,
    podSubnetV4: '10.20.1.0/24',
    podSubnetV6: null,
    appliedRevision: 4,
    applyStatus: 'applied',
    applyError: null,
    certificateNotAfter: null,
    lastSeenAt: '2026-10-01T10:00:00.000Z',
    connected: true,
    joinedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

const token: CreatedJoinToken = {
  id: 't1',
  tokenPrefix: 'lwj_abcd',
  description: null,
  site: 'fra1',
  labels: {},
  witness: false,
  expiresAt: '2026-10-01T11:00:00.000Z',
  usedAt: null,
  usedByNode: null,
  revokedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  token: 'lwj_secret',
};

describe('console nodes state', () => {
  it('groups nodes by site with nodes that left last', () => {
    const state = consoleNodesReducer(
      initialConsoleNodesState,
      loadNodesSuccess({
        nodes: [node({ name: 'n3', site: 'ams1' }), node({ name: 'n0', lifecycle: 'left' }), node()],
        cluster: null,
      }),
    );

    expect(selectNodesBySite({ consoleNodes: state }).map((s) => [s.site, s.nodes.map((n) => n.name)])).toEqual([
      ['ams1', ['n3']],
      ['fra1', ['n1', 'n0']],
    ]);
  });

  it('applies an action’s answer to list and detail and records failures', () => {
    const listed = consoleNodesReducer(initialConsoleNodesState, loadNodesSuccess({ nodes: [node()], cluster: null }));
    const opened = consoleNodesReducer(listed, loadNode({ name: 'n1' }));
    const acting = consoleNodesReducer(opened, nodeAction({ name: 'n1', action: 'cordon' }));
    const done = consoleNodesReducer(
      acting,
      nodeActionSuccess({ action: 'cordon', node: node({ lifecycle: 'cordoned' }) }),
    );

    expect(opened.selected?.name).toBe('n1');
    expect(acting.acting).toEqual({ name: 'n1', action: 'cordon' });
    expect(done.selected?.lifecycle).toBe('cordoned');
    expect(done.nodes[0].lifecycle).toBe('cordoned');
    expect(
      consoleNodesReducer(acting, nodeActionFailure({ name: 'n1', action: 'leave', error: 'drain first' })),
    ).toMatchObject({ acting: null, actionError: 'drain first' });
  });

  it('shows a created token once and keeps the plaintext out of the list', () => {
    const created = consoleNodesReducer(initialConsoleNodesState, createJoinTokenSuccess({ token }));

    expect(created.createdToken?.token).toBe('lwj_secret');
    expect(created.tokens[0]).not.toHaveProperty('token');
    expect(consoleNodesReducer(created, revokeJoinTokenSuccess({ id: 't1' })).tokens).toEqual([]);
  });

  it('loads nodes with the cluster summary, which may fail on its own', async () => {
    const service = {
      list: jest.fn().mockReturnValue(of([node()])),
      cluster: jest.fn().mockReturnValue(throwError(() => new Error('forbidden'))),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadNodes({})))] });

    expect(await firstValueFrom(loadNodes$(TestBed.inject(Actions), service as unknown as NodesService))).toEqual(
      loadNodesSuccess({ nodes: [node()], cluster: null }),
    );
  });

  it('runs node actions and reports conflicts', async () => {
    const service = {
      act: jest
        .fn()
        .mockReturnValueOnce(of(node({ lifecycle: 'draining' })))
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({ status: 409, error: { message: 'drain the node before it leaves' } }),
          ),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(nodeAction({ name: 'n1', action: 'drain' }), nodeAction({ name: 'n2', action: 'leave' })),
        ),
      ],
    });

    expect(
      await firstValueFrom(nodeActions$(TestBed.inject(Actions), service as unknown as NodesService).pipe(toArray())),
    ).toEqual([
      nodeActionSuccess({ action: 'drain', node: node({ lifecycle: 'draining' }) }),
      nodeActionFailure({ name: 'n2', action: 'leave', error: 'drain the node before it leaves' }),
    ]);
    expect(service.act).toHaveBeenCalledWith('n1', 'drain');
  });
});
