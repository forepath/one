import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NodesService, type NodePlatformComponent } from '@forepath/loadweaver/frontend/data-access-console';
import { of, Subject, throwError } from 'rxjs';

import { workspaceModel } from '../workspace/workspace-model';
import { WS_GRAPH, WS_RESOURCES } from '../workspace/workspace-testing';
import {
  filterPlatformRows,
  platformComponentLabel,
  platformRoleLabel,
  platformStateBadge,
} from './node-platform-format';
import { ResourcesContextService } from './resources-context.service';
import { LoadweaverNodePlatformComponent } from './tabs/node-platform.component';
import { LoadweaverObjectContentsComponent } from './tabs/object-contents.component';

const ROWS: NodePlatformComponent[] = [
  { id: 'etcd', component: 'etcd', label: 'etcd', role: 'member', state: 'running', detail: '3 members' },
  { id: 'postgres', component: 'postgres', label: 'PostgreSQL (Patroni)', role: 'leader', state: 'running' },
  {
    id: 'registry',
    component: 'registry',
    label: 'Registry',
    state: 'failed',
    detail: 'mirror docker.io unreachable',
  },
];

describe('node platform format (2026-10-30)', () => {
  it('labels components, roles and states', () => {
    expect(platformComponentLabel(ROWS[1])).toBe('PostgreSQL (Patroni)');
    // A component this console doesn't know yet: the API's label.
    expect(platformComponentLabel({ component: 'future' as never, label: 'Future thing' })).toBe('Future thing');
    expect(platformRoleLabel('leader')).toBe('Leader');
    expect(platformRoleLabel('pending')).toBe('Pending');
    expect(platformRoleLabel(undefined)).toBe('—');
    expect(platformRoleLabel('other')).toBe('other');
    expect(platformStateBadge('running')).toMatchObject({ label: 'Running', tone: 'success' });
    expect(platformStateBadge('failed')).toMatchObject({ label: 'Failed', tone: 'danger' });
    expect(platformStateBadge('weird')).toMatchObject({ label: 'Unknown', tone: 'neutral' });
  });
});

describe('LoadweaverNodePlatformComponent', () => {
  function setup(platform: jest.Mock) {
    TestBed.configureTestingModule({
      imports: [LoadweaverNodePlatformComponent],
      providers: [{ provide: NodesService, useValue: { platform } }],
    });

    const fixture = TestBed.createComponent(LoadweaverNodePlatformComponent);
    const counts: number[] = [];

    fixture.componentRef.setInput('node', 'lw-devnode-1');
    fixture.componentInstance.loaded.subscribe((n) => counts.push(n));
    fixture.detectChanges();

    return { fixture, el: fixture.nativeElement as HTMLElement, counts };
  }

  it('lists the platform components read-only and reloads on refresh', () => {
    const platform = jest.fn().mockReturnValue(of(ROWS));
    const { fixture, el, counts } = setup(platform);

    expect(platform).toHaveBeenCalledWith('lw-devnode-1');
    expect(counts).toEqual([3]);
    // The lane carries the title; the table is labelled for assistive tech.
    expect(el.querySelector('[data-testid="node-platform"] [role="table"]')?.getAttribute('aria-label')).toBe(
      'Platform',
    );
    expect(el.textContent).toContain('PostgreSQL (Patroni)');
    expect(el.textContent).toContain('Leader');
    expect(el.textContent).toContain('mirror docker.io unreachable');
    // Read-only: no selection boxes, row menus or links.
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(el.querySelector('a[href]')).toBeNull();

    fixture.componentRef.setInput('reloadKey', 1);
    fixture.detectChanges();
    expect(platform).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state without components or on an older control plane (404); retries, then shows other errors', () => {
    const empty = 'No platform components on this node';
    const none = setup(jest.fn().mockReturnValue(of([])));

    expect(none.el.querySelector('[data-testid="node-platform"]')?.textContent).toContain(empty);
    expect(none.counts).toEqual([0]);

    TestBed.resetTestingModule();

    const old = setup(jest.fn().mockReturnValue(throwError(() => ({ status: 404 }))));

    expect(old.fixture.componentInstance.error()).toBeNull();
    expect(old.el.querySelector('[data-testid="node-platform"]')?.textContent).toContain(empty);

    TestBed.resetTestingModule();
    jest.useFakeTimers();

    try {
      const failingCall = jest.fn().mockReturnValue(throwError(() => ({ status: 502 })));
      const failing = setup(failingCall);

      // A control plane that is just restarting: two retries 1.5 s apart before the error shows.
      expect(failing.fixture.componentInstance.error()).toBeNull();
      jest.advanceTimersByTime(3000);
      expect(failing.fixture.componentInstance.error()).toBe(
        "The platform components couldn't be loaded. Reload to try again.",
      );
      expect(failing.el.querySelector('[data-testid="node-platform"]')).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LoadweaverObjectContentsComponent on a node’s Workloads tab', () => {
  function setup(preset: string, rows$ = new Subject<NodePlatformComponent[]>()) {
    const platform = jest.fn().mockReturnValue(rows$);
    const context = {
      model: signal(workspaceModel(WS_GRAPH, WS_RESOURCES)),
      loading: signal(false),
      changedIds: signal(new Set<string>()),
      draft: null,
      reload: jest.fn(),
      actionsOf: () => [],
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverObjectContentsComponent],
      providers: [
        provideRouter([]),
        { provide: ResourcesContextService, useValue: context },
        { provide: NodesService, useValue: { platform } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ q: 'nothing-matches-x' }) } },
        },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverObjectContentsComponent);

    fixture.componentRef.setInput('scope', { kind: 'node', name: 'n1' });
    fixture.componentRef.setInput('preset', preset);
    fixture.detectChanges();

    return { fixture, platform, context, rows$, el: fixture.nativeElement as HTMLElement };
  }

  it('lists the platform components next to the workloads (2 : 1 split) and words the empty state with it', () => {
    const { fixture, platform, context, rows$, el } = setup('-kind:Volume');
    const table = fixture.componentInstance;

    expect(platform).toHaveBeenCalledWith('n1');
    expect(table.emptyState().title).toBe('No workloads on this node');

    rows$.next(ROWS);
    fixture.detectChanges();
    expect(table.platformCount()).toBe(3);
    expect(table.emptyState().title).toBe('No user workloads on this node');

    const lanes = Array.from(el.querySelectorAll('[data-testid="node-workloads-lanes"] loadweaver-lane'));

    expect(lanes.map((lane) => lane.getAttribute('grow'))).toEqual(['2 1 0', '1 1 0']);
    expect(el.querySelector('[data-testid="node-platform-lane"] [data-testid="node-platform"]')).not.toBeNull();
    // Below md one lane at a time: the lane tabs switch.
    expect(table.lane()).toBe('workloads');
    table.lane.set('platform');
    fixture.detectChanges();
    expect(lanes[0].querySelector('.fpc-lane--off')).not.toBeNull();
    expect(lanes[1].querySelector('.fpc-lane--off')).toBeNull();

    table.refresh();
    fixture.detectChanges();
    expect(context.reload).toHaveBeenCalled();
    expect(platform).toHaveBeenCalledTimes(2);
  });

  it('has no platform group on the Volumes tab', () => {
    const { platform, el } = setup('kind:Volume');

    expect(platform).not.toHaveBeenCalled();
    expect(el.querySelector('loadweaver-node-platform')).toBeNull();
  });
});

describe('filterPlatformRows (searchable platform lane)', () => {
  const rows = [
    { id: 'etcd', component: 'etcd', label: 'etcd', role: 'member', state: 'running' },
    { id: 'pg', component: 'postgres', label: 'Postgres', role: 'leader', state: 'running' },
    { id: 'reg', component: 'registry', label: 'Registry', state: 'failed', detail: 'image pull failed' },
  ] as NodePlatformComponent[];

  it('matches component, role, state and detail; all words, case-insensitive', () => {
    expect(filterPlatformRows(rows, '').map((r) => r.id)).toEqual(['etcd', 'pg', 'reg']);
    expect(filterPlatformRows(rows, 'postgres').map((r) => r.id)).toEqual(['pg']);
    expect(filterPlatformRows(rows, 'PULL').map((r) => r.id)).toEqual(['reg']);
    expect(filterPlatformRows(rows, 'registry pull').map((r) => r.id)).toEqual(['reg']);
    expect(filterPlatformRows(rows, 'registry etcd')).toEqual([]);
  });
});
