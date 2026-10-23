import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of } from 'rxjs';

import { HealthService } from '../../services/health.service';
import type { HealthEntity } from '../../types/health.types';
import {
  loadHealthEntity,
  loadHealthEntitySuccess,
  loadHealthHistory,
  loadHealthHistorySuccess,
  loadHealthTree,
} from './health.actions';
import { loadHealthEntity$, loadHealthHistory$ } from './health.effects';
import { consoleHealthReducer, initialConsoleHealthState } from './health.reducer';
import { buildHealthTree, selectHealthDetailChildren, selectHealthDetailEntity } from './health.selectors';

function entity(key: string, parent: string | null, overrides: Partial<HealthEntity> = {}): HealthEntity {
  return {
    key,
    kind: 'node',
    name: key.split('/').pop() ?? key,
    parent,
    project: null,
    state: 'healthy',
    reasons: [],
    since: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('console health state', () => {
  it('builds trees from parent links, cluster first, orphans as roots', () => {
    const tree = buildHealthTree([
      entity('project/shop', null, { kind: 'project' }),
      entity('node/n2', 'site/fra1'),
      entity('site/fra1', 'cluster', { kind: 'site' }),
      entity('node/n1', 'site/fra1'),
      entity('cluster', null, { kind: 'cluster' }),
      entity('deployment/shop/web', 'project/hidden', { kind: 'deployment' }),
    ]);

    expect(tree.map((n) => n.entity.key)).toEqual(['cluster', 'deployment/shop/web', 'project/shop']);
    expect(tree[0].children[0].children.map((n) => n.entity.key)).toEqual(['node/n1', 'node/n2']);
  });

  it('drops the previous scope and keeps the detail entity apart from its descendants', () => {
    const loaded = consoleHealthReducer(
      consoleHealthReducer(initialConsoleHealthState, loadHealthEntity({ key: 'site/fra1' })),
      loadHealthEntitySuccess({
        key: 'site/fra1',
        entities: [entity('site/fra1', 'cluster', { kind: 'site' }), entity('node/n1', 'site/fra1')],
      }),
    );
    const otherScope = consoleHealthReducer(
      { ...loaded, entities: [entity('cluster', null)] },
      loadHealthTree({ project: 'shop' }),
    );

    expect(selectHealthDetailEntity({ consoleHealth: loaded })?.key).toBe('site/fra1');
    expect(selectHealthDetailChildren({ consoleHealth: loaded }).map((n) => n.entity.key)).toEqual(['node/n1']);
    expect(otherScope).toMatchObject({ entities: [], project: 'shop', loading: true });
  });

  it('loads an entity with its descendants and its history', async () => {
    const history = { key: 'site/fra1', changes: [], durations: { healthy: 1000 } };
    const service = {
      tree: jest.fn().mockReturnValue(of([entity('site/fra1', 'cluster')])),
      history: jest.fn().mockReturnValue(of(history)),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadHealthEntity({ key: 'site/fra1' })))],
    });
    expect(
      await firstValueFrom(loadHealthEntity$(TestBed.inject(Actions), service as unknown as HealthService)),
    ).toEqual(loadHealthEntitySuccess({ key: 'site/fra1', entities: [entity('site/fra1', 'cluster')] }));
    expect(service.tree).toHaveBeenCalledWith({ root: 'site/fra1' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadHealthHistory({ key: 'site/fra1' })))],
    });
    expect(
      await firstValueFrom(loadHealthHistory$(TestBed.inject(Actions), service as unknown as HealthService)),
    ).toEqual(loadHealthHistorySuccess({ history }));
  });
});
