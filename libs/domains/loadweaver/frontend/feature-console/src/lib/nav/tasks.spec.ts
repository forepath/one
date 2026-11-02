import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  AlertsService,
  BackupsService,
  ConsoleAuditService,
  ConsoleEndpointService,
  FleetService,
  NodesService,
  PlansService,
  UpdatesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { LoadweaverShortcutHelpComponent } from './shortcut-help.component';
import { CONSOLE_SHORTCUT_GROUPS, consoleShortcut } from './shortcuts';
import { LoadweaverTaskControlsComponent } from './task-controls.component';
import { LoadweaverTaskDockComponent, taskTone } from './task-dock.component';
import { LoadweaverTasksPageComponent } from './tasks-page.component';
import { ConsoleTaskFeedService } from './task-feed.service';
import {
  alertEvents,
  auditEvents,
  fleetOperationTasks,
  matchesTask,
  mergeEvents,
  nodeTasks,
  planTasks,
  restoreTasks,
  rolloutTasks,
  sortTasks,
  taskTargetId,
  type TaskEntry,
} from './tasks';

const NOW = Date.parse('2026-10-27T12:00:00Z');

describe('task dock model (P4)', () => {
  it('normalizes running and recent work from plans, rollouts, restores and nodes', () => {
    const plans = planTasks(
      [
        { id: 'aaaaaaaa-1', status: 'applying', createdAt: '2026-10-27T11:00:00Z', appliedAt: null },
        { id: 'bbbbbbbb-2', status: 'applied', createdAt: '2026-10-27T10:00:00Z', appliedAt: '2026-10-27T10:05:00Z' },
        { id: 'cccccccc-3', status: 'applied', createdAt: '2026-10-20T10:00:00Z', appliedAt: '2026-10-20T10:05:00Z' },
        { id: 'dddddddd-4', status: 'pending', createdAt: '2026-10-27T11:30:00Z', appliedAt: null },
      ] as never,
      NOW,
    );

    expect(plans.map((t) => [t.id, t.running])).toEqual([
      ['plan:aaaaaaaa-1', true],
      ['plan:bbbbbbbb-2', false],
    ]);
    // Cancel-apply only while applying.
    expect(plans.map((t) => (t.controls ?? []).map((c) => c.action))).toEqual([['cancel'], []]);
    expect(taskTargetId(plans[0])).toBe('aaaaaaaa-1');

    const rollouts = rolloutTasks(
      [
        {
          id: 'r1',
          status: 'running',
          toVersion: '1.4.0',
          progress: { done: 1, total: 4 },
          startedAt: null,
          createdAt: '2026-10-27T11:00:00Z',
          finishedAt: null,
        },
      ] as never,
      NOW,
    );

    expect(rollouts[0]).toMatchObject({ progress: 25, running: true, link: ['/delivery/updates/rollouts', 'r1'] });
    expect(rollouts[0].controls?.map((c) => c.action)).toEqual(['pause', 'cancel']);
    expect(
      rolloutTasks(
        [
          {
            id: 'r2',
            status: 'paused',
            toVersion: '1',
            progress: { done: 0, total: 0 },
            createdAt: '2026-10-27T11:00:00Z',
          },
        ] as never,
        NOW,
      )[0].controls?.map((c) => c.action),
    ).toEqual(['resume', 'cancel']);

    const operations = fleetOperationTasks(
      [
        {
          id: 'o1',
          kind: 'clone',
          status: 'running',
          steps: [{ status: 'succeeded' }, { status: 'running' }],
          createdAt: '2026-10-27T11:00:00Z',
          updatedAt: '2026-10-27T11:00:00Z',
        },
        {
          id: 'o2',
          kind: 'clone',
          status: 'succeeded',
          steps: [],
          createdAt: '2026-10-01T11:00:00Z',
          updatedAt: '2026-10-01T11:00:00Z',
        },
      ] as never,
      NOW,
    );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ id: 'fleet-operation:o1', progress: 50, link: ['/fleet/operations'] });
    expect(operations[0].controls?.map((c) => c.action)).toEqual(['cancel']);
    expect(taskTargetId(operations[0])).toBe('o1');
    expect(
      restoreTasks(
        [
          {
            id: 'x',
            project: 'shop',
            name: 'r',
            status: 'failed',
            startedAt: '2026-10-27T11:00:00Z',
            finishedAt: '2026-10-27T11:10:00Z',
          },
        ] as never,
        NOW,
      )[0],
    ).toMatchObject({ failed: true, queryParams: { project: 'shop' } });
    expect(
      nodeTasks([
        { name: 'n1', lifecycle: 'draining' },
        { name: 'n2', lifecycle: 'active' },
      ] as never).map((t) => t.id),
    ).toEqual(['node:n1']);

    const sorted = sortTasks([...plans, ...rollouts]);

    expect(sorted.filter((t) => t.running)).toHaveLength(2);
    expect(sorted[sorted.length - 1].running).toBe(false);
    expect(taskTone({ running: true, failed: false })).toBe('info');
    expect(taskTone({ running: false, failed: true })).toBe('danger');
  });

  it('merges audit entries and alert fires / resolves, newest first, and filters', () => {
    const events = mergeEvents([
      ...auditEvents([
        {
          seq: '1',
          at: '2026-10-27T10:00:00Z',
          action: 'plan.apply',
          target: 'plan/p1',
          actorId: 'u',
          actorType: 'user',
        },
      ] as never),
      ...alertEvents([
        { id: 'a1', title: 'Disk full', state: 'firing', firedAt: '2026-10-27T11:00:00Z', resolvedAt: null },
        {
          id: 'a2',
          title: 'CPU',
          state: 'resolved',
          firedAt: '2026-10-27T09:00:00Z',
          resolvedAt: '2026-10-27T09:30:00Z',
        },
      ] as never),
    ]);

    expect(events.map((e) => e.id)).toEqual(['alert:a1', 'audit:1', 'alert:a2']);
    expect(events[0]).toMatchObject({ tone: 'danger', link: ['/observe/alerts', 'a1'] });
    expect(matchesTask(events[1], 'plan/p1')).toBe(true);
    expect(matchesTask(events[1], 'nope')).toBe(false);
  });

  it('adds the dock and tree shortcuts', () => {
    expect(consoleShortcut(null, '`')).toEqual({ kind: 'tasks' });
    expect(consoleShortcut(null, '[')).toEqual({ kind: 'tree' });
    expect(consoleShortcut(null, '?')).toEqual({ kind: 'help' });
  });

  it('lists every shortcut in the ? overlay', () => {
    TestBed.configureTestingModule({ imports: [LoadweaverShortcutHelpComponent] });

    const fixture = TestBed.createComponent(LoadweaverShortcutHelpComponent);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const text = (document.querySelector('[data-testid="shortcut-help"]') as HTMLElement).textContent ?? '';
    const keys = CONSOLE_SHORTCUT_GROUPS.flatMap((group) => group.entries.flatMap((entry) => entry.keys));

    for (const key of ['Ctrl', 'K', '/', '?', '[', '`', 'Esc', 'g', 'r', 'e', 'Del']) {
      expect(keys).toContain(key);
    }
    expect(text).toContain('Delete into the draft');
    expect(text).toContain('then');
    fixture.destroy();
  });
});

describe('LoadweaverTaskDockComponent', () => {
  it('lists the feed, counts running work and loads events when opened', () => {
    const task: TaskEntry = {
      id: 'plan:p1',
      kind: 'plan',
      title: 'Plan p1',
      status: 'applying',
      running: true,
      failed: false,
      progress: null,
      at: null,
      link: ['/activity/plans', 'p1'],
      controls: [{ action: 'cancel', label: 'Cancel', icon: 'bi-x-octagon', confirm: true }],
    };
    const tasks = signal([task]);
    const feed = {
      tasks,
      events: signal([]),
      loading: signal(false),
      running: signal(1),
      open: signal(false),
      refreshNow: jest.fn(),
      controlling: signal<string | null>(null),
      controlError: signal<string | null>(null),
      control: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverTaskDockComponent],
      providers: [provideRouter([]), { provide: ConsoleTaskFeedService, useValue: feed }],
    });

    const fixture = TestBed.createComponent(LoadweaverTaskDockComponent);

    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="task-dock-running"]')?.textContent,
    ).toContain('1');

    feed.open.set(true);
    fixture.detectChanges();
    expect(feed.refreshNow).toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="task-dock-tasks"]')?.textContent,
    ).toContain('Plan p1');

    // Cancel asks first, then runs through the feed.
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-control-cancel"] button',
      ) as HTMLButtonElement
    ).click();
    expect(feed.control).not.toHaveBeenCalled();
    const controls = fixture.debugElement.query(By.directive(LoadweaverTaskControlsComponent))
      .componentInstance as LoadweaverTaskControlsComponent;

    expect(controls.pending()?.action).toBe('cancel');
    controls.confirm();
    expect(feed.control).toHaveBeenCalledWith(task, task.controls?.[0]);

    fixture.componentInstance.query.set('nothing');
    expect(fixture.componentInstance.tasks()).toEqual([]);
  });

  it('shows filter + Tasks / Events triggers on the right of the header strip (no selection while collapsed)', () => {
    const events = Array.from({ length: 40 }, (_, i) => ({
      id: `audit:${i}`,
      kind: 'audit' as const,
      title: `Event ${i}`,
      detail: 'detail',
      tone: 'secondary' as const,
      at: new Date().toISOString(),
      link: null,
    }));
    const feed = {
      tasks: signal([]),
      events: signal(events),
      loading: signal(false),
      running: signal(0),
      open: signal(false),
      refreshNow: jest.fn(),
      controlling: signal<string | null>(null),
      controlError: signal<string | null>(null),
      control: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverTaskDockComponent],
      providers: [provideRouter([]), { provide: ConsoleTaskFeedService, useValue: feed }],
    });

    const fixture = TestBed.createComponent(LoadweaverTaskDockComponent);
    const element = fixture.nativeElement as HTMLElement;
    const header = (): Element => element.querySelector('.fpc-dock-panel__header') as Element;
    const trigger = (id: string): HTMLButtonElement =>
      header().querySelector(`[data-testid="task-dock-tab-${id}"] button`) as HTMLButtonElement;
    const click = (id: string): void => {
      trigger(id).click();
      fixture.detectChanges();
    };
    const pressed = (): string[] =>
      ['tasks', 'events'].filter((id) => trigger(id).getAttribute('aria-pressed') === 'true');

    localStorage.removeItem('lw.dock');
    fixture.detectChanges();
    const bodyId = element.querySelector('.fpc-dock-panel__body')?.id;

    // Collapsed: both triggers, neither selected, no filter / Open all; aria wired to the body.
    expect(pressed()).toEqual([]);
    expect(header().querySelector('fpc-search-field')).toBeNull();
    for (const id of ['tasks', 'events']) {
      expect(trigger(id).getAttribute('aria-expanded')).toBe('false');
      expect(trigger(id).getAttribute('aria-controls')).toBe(bodyId);
    }

    // A trigger opens the dock directly on its view.
    click('events');
    expect(feed.open()).toBe(true);
    expect(pressed()).toEqual(['events']);
    expect(trigger('tasks').getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('[data-testid="task-dock-events"] tr.fpc-data-table__row')).toHaveLength(25);
    // 3.38: segmented fpc-button-group triggers, no raw btn-group / badge; per-view search placeholder.
    expect(header().querySelector('.btn-group, .badge.rounded-pill:not(fpc-badge)')).toBeNull();
    expect(header().querySelector('fpc-search-field input')?.getAttribute('placeholder')).toBe('Search events');

    for (const id of ['tasks', 'events', 'tasks', 'events']) {
      click(id);
      expect(feed.open()).toBe(true);
      expect(pressed()).toEqual([id]);
      expect(header().querySelector('fpc-search-field')).not.toBeNull();
    }

    // Triggers on the right (actions slot), the filter just left of them (header slot); no "Open all" any more.
    expect(header().querySelector('.fpc-dock-panel__actions [data-testid="task-dock-tabs"]')).not.toBeNull();
    expect(header().querySelector('.fpc-dock-panel__header-content fpc-search-field')).not.toBeNull();
    expect(element.querySelector('[data-testid="task-dock-open-all"]')).toBeNull();

    // The selected trigger closes the dock again: no selection while collapsed.
    click('events');
    expect(feed.open()).toBe(false);
    expect(pressed()).toEqual([]);
    expect(trigger('events').getAttribute('aria-expanded')).toBe('false');

    // The panel's own collapse control also leaves no selection.
    click('tasks');
    expect(pressed()).toEqual(['tasks']);
    (element.querySelector('[data-testid="fpc-dock-panel-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(feed.open()).toBe(false);
    expect(pressed()).toEqual([]);
  });
});

describe('LoadweaverTasksPageComponent', () => {
  it('offers the same controls as the dock (pause runs at once, cancel asks first)', () => {
    const task: TaskEntry = {
      id: 'rollout:r1',
      kind: 'rollout',
      title: 'Rollout r1',
      status: 'running',
      running: true,
      failed: false,
      progress: 40,
      at: null,
      link: ['/delivery/updates/rollouts', 'r1'],
      controls: [
        { action: 'pause', label: 'Pause', icon: 'bi-pause-circle', confirm: false },
        { action: 'cancel', label: 'Cancel', icon: 'bi-x-octagon', confirm: true },
      ],
    };
    const feed = {
      tasks: signal([task]),
      loading: signal(false),
      refreshNow: jest.fn(),
      controlling: signal<string | null>(null),
      controlError: signal<string | null>('boom'),
      control: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverTasksPageComponent],
      providers: [provideRouter([]), { provide: ConsoleTaskFeedService, useValue: feed }],
    });

    const fixture = TestBed.createComponent(LoadweaverTasksPageComponent);
    const element = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    // 3.38: title "Tasks", "Search tasks", translated status as a tone badge.
    expect(element.querySelector('fpc-page-header h1')?.textContent?.trim()).toBe('Tasks');
    expect(
      element.querySelector('[data-testid="tasks-table"] fpc-search-field input')?.getAttribute('placeholder'),
    ).toBe('Search tasks');
    expect(
      element
        .querySelector('[data-testid="tasks-table"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Running');
    expect(element.querySelector('[data-testid="tasks-table"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      '/delivery/updates/rollouts/r1',
    );
    expect(element.querySelector('fpc-page-header')).not.toBeNull();
    expect(element.querySelector('[data-testid="tasks-control-error"]')).not.toBeNull();
    (element.querySelector('[data-testid="task-control-pause"] button') as HTMLButtonElement).click();
    expect(feed.control).toHaveBeenCalledWith(task, task.controls?.[0]);
    (element.querySelector('[data-testid="task-control-cancel"] button') as HTMLButtonElement).click();
    expect(feed.control).toHaveBeenCalledTimes(1);
  });
});

describe('ConsoleTaskFeedService.control', () => {
  it('cancels plans / fleet operations and pauses rollouts through their APIs, then refreshes', () => {
    const plans = { cancel: jest.fn(() => of({})), list: jest.fn(() => of([])) };
    const updates = { act: jest.fn(() => of({})), rollouts: jest.fn(() => of([])) };
    const fleet = {
      cancelOperation: jest.fn(() => throwError(() => new Error('nope'))),
      operations: jest.fn(() => of([])),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PlansService, useValue: plans },
        { provide: UpdatesService, useValue: updates },
        { provide: FleetService, useValue: fleet },
        { provide: BackupsService, useValue: { restores: () => of([]) } },
        { provide: NodesService, useValue: { list: () => of([]) } },
        { provide: ConsoleAuditService, useValue: { list: () => of(null) } },
        { provide: AlertsService, useValue: { list: () => of([]) } },
        { provide: ConsoleEndpointService, useValue: { fleetMode: true } },
      ],
    });

    const feed = TestBed.inject(ConsoleTaskFeedService);
    const cancel = { action: 'cancel' as const, label: 'Cancel', icon: 'bi-x', confirm: true };
    const base = { status: 'running', running: true, failed: false, progress: null, at: null, link: [] };

    feed.control({ ...base, id: 'plan:p1', kind: 'plan', title: 'p' }, cancel);
    expect(plans.cancel).toHaveBeenCalledWith('p1');

    feed.control(
      { ...base, id: 'rollout:r1', kind: 'rollout', title: 'r' },
      { ...cancel, action: 'pause', confirm: false },
    );
    expect(updates.act).toHaveBeenCalledWith('r1', 'pause');

    feed.control({ ...base, id: 'fleet-operation:o1', kind: 'fleet-operation', title: 'o' }, cancel);
    expect(fleet.cancelOperation).toHaveBeenCalledWith('o1');
    expect(feed.controlError()).toBeTruthy();
    expect(feed.controlling()).toBeNull();
  });
});
