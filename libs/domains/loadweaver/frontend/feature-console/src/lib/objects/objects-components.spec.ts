import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';

import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleFleetFacade,
  ConsoleNodesFacade,
  ConsoleOverviewFacade,
} from '@forepath/loadweaver/frontend/data-access-console';

import { ConsoleNavService } from '../nav/console-nav.service';
import { accessStub, facadeStub } from '../testing';
import { ConsoleSettingsService } from '../nav/console-settings.service';
import type { WorkspaceAction } from '../workspace/workspace-actions';
import { workspaceModel, type WorkspaceItem } from '../workspace/workspace-model';
import { WS_GRAPH, WS_RESOURCES } from '../workspace/workspace-testing';
import { LoadweaverObjectPageComponent } from './object-page.component';
import { LoadweaverResourcesShellComponent } from './resources-shell.component';
import { LoadweaverObjectContentsComponent } from './tabs/object-contents.component';
import { ResourcesContextService, type ResourceObjectRef } from './resources-context.service';
import { ResourceModalService } from './resource-modal.service';

function contextStub(clusterRole: 'cluster-admin' | null = 'cluster-admin') {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
  const drain: WorkspaceAction = {
    id: 'node-drain',
    group: 'act',
    label: 'Drain',
    icon: 'bi-arrow-down-circle',
    confirm: { message: 'Drain?', danger: true },
    node: { name: 'n1', action: 'drain' },
  };
  const cordon: WorkspaceAction = {
    id: 'node-cordon',
    group: 'act',
    label: 'Cordon',
    icon: 'bi-pause-circle',
    node: { name: 'n1', action: 'cordon' },
  };
  const edit: WorkspaceAction = { id: 'edit', group: 'draft', label: 'Edit in draft', icon: 'bi-pencil' };

  return {
    model: signal(model),
    loading: signal(false),
    resources: signal(WS_RESOURCES),
    changedIds: signal(new Set<string>(['node:n1'])),
    infrastructure: signal(!!clusterRole),
    builtinMember: signal(null),
    me: signal({ userId: 'u', clusterRole, projects: { shop: 'admin' } }),
    endpoints: { fleetMode: false },
    clusterName: signal<string | null>('local'),
    clusterId: signal<string | null>('7680708a-a67e-418c-b501-d6cbf9a2aed6'),
    access: signal({ clusterRole, projects: { shop: 'admin' as const }, fleetMode: false }),
    draft: null,
    pending: signal<WorkspaceAction | null>(null),
    start: jest.fn(),
    reload: jest.fn(),
    run: jest.fn(),
    runNow: jest.fn(),
    confirmPending: jest.fn(),
    cancelPending: jest.fn(),
    resourceKind: (kind: string) => WS_RESOURCES.find((r) => r.kind.toLowerCase() === kind)?.kind ?? kind,
    itemFor: (ref: ResourceObjectRef): WorkspaceItem | null =>
      ref.kind === 'node' ? (model.byId.get(`node:${ref.name}`) ?? null) : null,
    actionsOf: (item: WorkspaceItem) => (item.kind === 'node' ? [cordon, drain, edit] : []),
  };
}

describe('LoadweaverObjectPageComponent', () => {
  async function setup(
    data: Record<string, unknown>,
    params: Record<string, string>,
    query: Record<string, string>,
    tokens: unknown[] = [],
  ) {
    const context = contextStub();

    TestBed.configureTestingModule({
      imports: [LoadweaverObjectPageComponent],
      providers: [
        provideRouter([]),
        { provide: ResourcesContextService, useValue: context },
        {
          provide: ConsoleOverviewFacade,
          useValue: { overview$: of(null), loading$: of(false), error$: of(null), load: jest.fn() },
        },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
        { provide: ConsoleEndpointService, useValue: { fleetMode: false, nativeConsoleUrl: (p: string) => p } },
        {
          provide: ConsoleNodesFacade,
          useValue: facadeStub(
            {
              tokens$: tokens,
              tokensError$: null,
              selected$: null,
              selectedLoading$: false,
              selectedError$: null,
              actionError$: null,
              creatingToken$: false,
              createdToken$: null,
              revokingToken$: null,
              tokenError$: null,
            },
            [
              'loadJoinTokens',
              'installScriptUrl',
              'createJoinToken',
              'revokeJoinToken',
              'clearCreatedToken',
              'open',
              'clearActionError',
            ],
          ),
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap(params)),
            queryParamMap: new BehaviorSubject(convertToParamMap(query)),
            data: of(data),
            snapshot: { data, paramMap: convertToParamMap(params), queryParamMap: convertToParamMap(query) },
          },
        },
      ],
    });

    const router = TestBed.inject(Router);

    jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LoadweaverObjectPageComponent);

    fixture.detectChanges();

    return { fixture, context, router, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the node header, its tab set and the node Summary', async () => {
    const { fixture, el, context } = await setup({ objectKind: 'node' }, { name: 'n1' }, { tab: 'summary' });
    const page = fixture.componentInstance;

    expect(page.title()).toBe('n1');
    expect(page.tabs().map((t) => t.id)).toEqual([
      'summary',
      'workloads',
      'volumes',
      'health',
      'metrics',
      'logs',
      'shell',
      'updates',
      'history',
    ]);
    expect(page.tab()).toBe('summary');
    expect(page.crumbs().map((c) => c.label)).toEqual(['Cluster', 'a', 'n1']);
    expect(page.changed()).toBe(true);
    expect(el.querySelector('loadweaver-node-detail-page')).not.toBeNull();
    // Immediate actions are quiet header buttons; destructive ones (drain) and draft actions go to "More" (LW-06).
    expect(el.querySelector('[data-testid="object-action-node-drain"]')).toBeNull();
    // Header actions are icon-only, named through aria-label + title (like Agenstra).
    const cordon = el.querySelector('[data-testid="object-action-node-cordon"] button') as HTMLButtonElement;
    expect(cordon.getAttribute('aria-label')).toBeTruthy();
    expect(cordon.getAttribute('title')).toBeTruthy();
    expect(cordon.textContent?.trim()).toBe('');
    expect(cordon.classList).not.toContain('btn-danger');
    expect(page.moreItems().map((m) => m.id)).toEqual(['node-drain', 'edit']);
    expect(page.moreItems()[0].danger).toBe(true);

    page.onMore({ id: 'edit', label: 'Edit in draft' });
    expect(context.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'edit' }), expect.anything());

    // `e` opens the edit modal (2026-10-29: editing is a modal, the Spec tab is read-only).
    const modal = TestBed.inject(ResourceModalService);

    page.onKey(new KeyboardEvent('keydown', { key: 'e' }));
    expect(modal.request()).toEqual({ mode: 'edit', key: { kind: 'Node', name: 'n1', project: null } });
  });

  it('switches tabs through ?tab= and falls back to Summary', async () => {
    const { fixture, router } = await setup({ objectKind: 'cluster' }, {}, { tab: 'nope' });
    const page = fixture.componentInstance;

    expect(page.tab()).toBe('summary');
    // The cluster's human name as title and last crumb, its id only through Copy ID (D11, LW-02).
    expect(page.title()).toBe('local');
    expect(page.crumbs().map((c) => c.label)).toEqual(['Cluster', 'local']);
    expect(page.moreItems().map((m) => m.id)).toEqual(['copy-id']);
    expect(page.tabs().map((t) => t.id)).toContain('permissions');
    page.selectTab('contents');
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'contents' } }));
    // The top-bar "+" is the only create entry (2026-10-29): no header Create on object pages.
    expect(fixture.nativeElement.querySelector('[data-testid="object-create"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('loadweaver-scope-summary')).not.toBeNull();
  });

  it('gives a site Summary the summary bar like the other object pages (LW-23)', async () => {
    const { fixture, el } = await setup({ objectKind: 'site' }, { name: 'a' }, {});

    expect(fixture.componentInstance.siteSummary()).toEqual(expect.objectContaining({ nodes: expect.any(Number) }));
    expect(el.querySelector('[data-testid="site-summary-bar"]')).not.toBeNull();
  });

  it('shows the Join tokens tab of a site: its tokens only, one dialog host', async () => {
    const mk = (id: string, site: string) => ({
      id,
      tokenPrefix: `lwj_${id}`,
      description: null,
      site,
      labels: {},
      witness: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      usedAt: null,
      usedByNode: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
    const { fixture, el } = await setup({ objectKind: 'site' }, { name: 'a' }, { tab: 'tokens' }, [
      mk('t1', 'a'),
      mk('t2', 'b'),
    ]);

    expect(fixture.componentInstance.tab()).toBe('tokens');
    expect(el.querySelectorAll('loadweaver-workspace-join-tokens')).toHaveLength(1);
    expect(el.querySelector('[data-testid="workspace-join-tokens"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="workspace-join-tokens"] tr.fpc-data-table__row')).toHaveLength(1);
    expect(el.querySelector('[data-testid="workspace-join-tokens"]')?.textContent).toContain('lwj_t1');
    expect(el.querySelector('[data-testid="workspace-join-tokens"]')?.textContent).not.toContain('lwj_t2');
  });
});

describe('Join tokens tab', () => {
  const token = (id: string, site: string, extra: Record<string, unknown> = {}) => ({
    id,
    tokenPrefix: `lwj_${id}`,
    description: null,
    site,
    labels: {},
    witness: false,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    usedAt: null,
    usedByNode: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    ...extra,
  });

  it('lists the tokens of the site with revoke for active ones', async () => {
    const { joinTokenStatus, filterJoinTokens } = await import('../workspace/workspace-join-tokens.component');
    const tokens = [token('t1', 'a'), token('t2', 'b'), token('t3', 'a', { usedAt: '2026-01-01T00:00:00Z' })];

    expect(filterJoinTokens(tokens, 'a', '').map((t) => t.id)).toEqual(['t1', 't3']);
    expect(filterJoinTokens(tokens, null, 'T2').map((t) => t.id)).toEqual(['t2']);
    expect(joinTokenStatus(tokens[2])).toBe('used');
    expect(joinTokenStatus(token('t4', 'a', { expiresAt: '2000-01-01T00:00:00Z' }))).toBe('expired');
    expect(joinTokenStatus(token('t5', 'a', { revokedAt: '2026-01-01T00:00:00Z' }))).toBe('revoked');
  });
});

describe('LoadweaverResourcesShellComponent', () => {
  it('builds the tree by role, persists the view and pins favourites', async () => {
    const context = contextStub();
    const state = signal<Record<string, unknown>>({});
    const settings = {
      state,
      patch: jest.fn((values: Record<string, unknown>) => state.set({ ...state(), ...values })),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverResourcesShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: ConsoleNavService,
          useValue: {
            url: computed(() => '/resources/node/n1'),
            treeCollapsed: signal(false),
            fleetMode: false,
            activeClusterId: signal(null),
          },
        },
        { provide: ConsoleSettingsService, useValue: settings },
        {
          provide: ConsoleFleetFacade,
          useValue: { clusters$: of([]), loadClusters: jest.fn(), openCluster: jest.fn() },
        },
      ],
    }).overrideComponent(LoadweaverResourcesShellComponent, {
      set: { providers: [{ provide: ResourcesContextService, useValue: context }] },
    });

    const fixture = TestBed.createComponent(LoadweaverResourcesShellComponent);

    fixture.detectChanges();

    const shell = fixture.componentInstance;

    expect(context.start).toHaveBeenCalled();
    expect(shell.view()).toBe('placement');
    // 3.38: the head is the shared list toolbar strip; the view switch is an icon menu, no raw select / btn.
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('fpc-list-toolbar [data-testid="resources-tree-search"]')).not.toBeNull();
    expect(host.querySelector('select, button.btn-link, button.btn-primary:not(.fpc-button__btn)')).toBeNull();
    expect(host.querySelector('[data-testid="resources-tree-view"] fpc-button')).not.toBeNull();
    expect(shell.nodes()[0].id).toBe('cluster');
    // The open object is selected and its ancestors expanded.
    expect(shell.selectedNodeId()).toBe('node:n1');
    expect(shell.expanded()).toEqual(expect.arrayContaining(['cluster', 'site:a']));

    shell.setView('projects');
    expect(settings.patch).toHaveBeenCalledWith({ treeView: 'projects' });
    expect(shell.view()).toBe('projects');

    shell.toggleFavourite('node:n1');
    expect(shell.favourites()).toEqual(['node:n1']);
    expect(shell.nodes()[0].id).toBe('group:favourites');

    shell.query.set('kind:Node n3');
    expect(JSON.stringify(shell.visibleNodes())).toContain('node:n3');
    expect(JSON.stringify(shell.visibleNodes())).not.toContain('"node:n2"');
  });
});

describe('LoadweaverObjectContentsComponent', () => {
  it('lists the scope, runs a shared immediate action once confirmed and labels / deletes into the draft', async () => {
    const context = contextStub();
    const draft = { active: signal(null), upsert: jest.fn().mockResolvedValue(true), remove: jest.fn() };

    (context as unknown as { draft: unknown }).draft = draft;
    TestBed.configureTestingModule({
      imports: [LoadweaverObjectContentsComponent],
      providers: [
        provideRouter([]),
        { provide: ResourcesContextService, useValue: context },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ kind: 'Node' }) } } },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverObjectContentsComponent);

    fixture.detectChanges();

    const table = fixture.componentInstance;

    expect(table.query()).toBe('kind:Node');
    expect(table.rows().map((r) => r.id)).toEqual(expect.arrayContaining(['node:n1', 'node:n2', 'node:n3']));
    expect(table.rows().every((r) => r.kind === 'node')).toBe(true);

    table.selected.set(['node:n1', 'node:n2']);
    expect(table.batchActs().map((a) => a.id)).toEqual(['node-cordon', 'node-drain']);
    table.pendingBatch.set(table.batchActs()[1]);
    table.runBatch();
    expect(context.runNow).toHaveBeenCalledTimes(2);

    table.selected.set(['node:n1']);
    table.labelInput.set('tier=edge');
    await table.labelSelected();
    expect(draft.upsert).toHaveBeenCalledWith(expect.stringContaining('tier: edge'));
  });
});
