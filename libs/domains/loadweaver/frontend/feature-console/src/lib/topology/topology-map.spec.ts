import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleNodesFacade,
  ConsolePlansFacade,
  ConsolePoliciesFacade,
  ConsoleResourcesFacade,
  ConsoleTopologyFacade,
  ConsoleVirtualMachinesFacade,
} from '@forepath/loadweaver/frontend/data-access-console';

import { FpcGraphCanvasComponent } from '@forepath/shared/frontend/ui-components';

import { ResourcesContextService } from '../objects/resources-context.service';
import { accessStub, facadeStub } from '../testing';
import type { WorkspaceAction } from '../workspace/workspace-actions';
import { workspaceModel, type WorkspaceItem } from '../workspace/workspace-model';
import { LW_SECTION_SCOPE } from '../section/section-scope';
import { WS_GRAPH, WS_RESOURCES } from '../workspace/workspace-testing';
import { LoadweaverTopologyMapComponent } from './topology-map.component';
import {
  parseTopologyUrl,
  TOPOLOGY_DEFAULT_STATE,
  topologyMatches,
  topologyScopeIds,
  topologyUrlParams,
} from './topology-view';

// eslint-disable-next-line @angular-eslint/component-selector
@Component({ selector: 'fpc-graph-canvas', template: '', standalone: true })
class GraphCanvasStubComponent {
  readonly elements = input<unknown[]>([]);
  readonly edges = input<unknown[]>([]);
  readonly positions = input<unknown>(null);
  readonly hiddenKinds = input<unknown>(null);
  readonly highlight = input<unknown>(null);
  readonly selectedId = input<string | null>(null);
  readonly performanceMode = input(false);
  readonly draggable = input(true);
  readonly layout = input('preset');
  readonly ariaLabel = input('');
  readonly fitHint = input('');
  readonly elementSelect = output<unknown>();
  readonly edgeSelect = output<unknown>();
  readonly elementHover = output<unknown>();
  readonly elementDrop = output<unknown>();
  readonly zoomChange = output<number>();
  readonly selectionClear = output<void>();
  readonly fit = jest.fn();
  readonly center = jest.fn();
  readonly relayout = jest.fn();
}

const PLAN = '0b7c6a52-3f7a-4f43-9d1e-2b9a4f0c1d2e';
const model = workspaceModel(WS_GRAPH, WS_RESOURCES);

describe('topology view model (3.37 P5)', () => {
  it('parses and writes the URL state; link filters fold into the search', () => {
    expect(parseTopologyUrl({})).toEqual(TOPOLOGY_DEFAULT_STATE);

    const state = parseTopologyUrl({ select: 'node:n1', kind: 'Node', q: 'n1', layers: 'tunnels,nope', plan: PLAN });

    expect(state).toEqual({
      select: 'node:n1',
      q: 'n1 kind:Node',
      layers: ['tunnels'],
      mode: 'plan',
      plan: PLAN,
      at: null,
    });
    expect(topologyUrlParams(state)).toEqual({
      select: 'node:n1',
      q: 'n1 kind:Node',
      kind: null,
      project: null,
      status: null,
      layers: 'tunnels',
      mode: 'plan',
      plan: PLAN,
      at: null,
    });
    expect(parseTopologyUrl({ at: '2026-10-27T10:00:00Z' }).mode).toBe('timeline');
    expect(parseTopologyUrl({ plan: 'not-a-uuid' }).plan).toBeNull();
  });

  it('scopes a site to its subtree and a project to its items with their containers', () => {
    expect(topologyScopeIds(model, null)).toBeNull();
    expect(topologyScopeIds(model, { kind: 'cluster' })).toBeNull();

    const site = topologyScopeIds(model, { kind: 'site', name: 'b' }) as ReadonlySet<string>;

    expect(site.has('site:b')).toBe(true);
    expect(site.has('node:n3')).toBe(true);
    expect(site.has('site:a')).toBe(false);

    const project = topologyScopeIds(model, { kind: 'project', name: 'shop' }) as ReadonlySet<string>;
    const shopItems = model.items.filter((i) => i.project === 'shop');

    expect(shopItems.length).toBeGreaterThan(0);
    expect(shopItems.every((i) => project.has(i.id))).toBe(true);
    // Containers of placed project items come along.
    expect(project.has('site:a')).toBe(true);
    expect(project.has('hostname:shop.example.com')).toBe(false);
  });

  it('matches the shared search syntax', () => {
    expect(topologyMatches(model, '  ')).toBeNull();
    expect([...(topologyMatches(model, 'kind:Node -n3') ?? [])].sort()).toEqual(['node:n1', 'node:n2']);
  });
});

describe('LoadweaverTopologyMapComponent', () => {
  function setup(
    query: Record<string, string> = {},
    scope: unknown = null,
    section: Record<string, string> | null = null,
  ) {
    const draft = {
      active: signal(null),
      preview: signal(null),
      upsert: jest.fn().mockResolvedValue(true),
      revert: jest.fn(),
    };
    const drain: WorkspaceAction = {
      id: 'node-drain',
      group: 'act',
      label: 'Drain',
      icon: 'bi-arrow-down-circle',
      confirm: { message: 'Drain?', danger: true },
      node: { name: 'n1', action: 'drain' },
    };
    const context = {
      model: signal(model),
      resources: signal(WS_RESOURCES),
      me: signal({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }),
      access: signal({ clusterRole: 'cluster-admin', projects: {}, fleetMode: false }),
      draft,
      pending: signal<WorkspaceAction | null>(null),
      start: jest.fn(),
      reload: jest.fn(),
      run: jest.fn(),
      confirmPending: jest.fn(),
      cancelPending: jest.fn(),
      actionsOf: (item: WorkspaceItem) => (item.kind === 'node' ? [drain] : []),
    };
    const topology = facadeStub(
      {
        graph$: WS_GRAPH,
        loading$: false,
        error$: null,
        at$: null,
        overlay$: null,
        liveConnected$: true,
        liveError$: null,
        traceHost$: null,
        traceSteps$: [],
        traceLoading$: false,
        traceError$: null,
        structureVersion$: null,
      },
      ['load', 'connectLive', 'disconnectLive', 'trace', 'clearTrace'],
    );
    const plans = facadeStub({ plans$: [], loading$: false }, ['load', 'connectLive', 'disconnectLive']);

    TestBed.configureTestingModule({
      imports: [LoadweaverTopologyMapComponent],
      providers: [
        provideRouter([]),
        { provide: ResourcesContextService, useValue: context },
        { provide: ConsoleTopologyFacade, useValue: topology },
        { provide: ConsolePlansFacade, useValue: plans },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'cluster-admin', projects: {} } as never),
        },
        { provide: ConsoleResourcesFacade, useValue: facadeStub({}, ['load', 'loadKinds']) },
        { provide: ConsoleNodesFacade, useValue: facadeStub({ actionError$: null }, ['load']) },
        { provide: ConsoleVirtualMachinesFacade, useValue: facadeStub({ actionError$: null }, ['open']) },
        { provide: ConsolePoliciesFacade, useValue: facadeStub({ members$: null }, ['load']) },
        { provide: ConsoleEndpointService, useValue: { fleetMode: false, activeClusterId: () => null } },
        ...(section ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(section) } }] : []),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });

    TestBed.overrideComponent(LoadweaverTopologyMapComponent, {
      remove: { imports: [FpcGraphCanvasComponent] },
      add: { imports: [GraphCanvasStubComponent] },
    });

    const router = TestBed.inject(Router);

    jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LoadweaverTopologyMapComponent);

    if (scope) fixture.componentRef.setInput('scope', scope);

    fixture.detectChanges();

    return {
      fixture,
      page: fixture.componentInstance,
      context,
      topology,
      router,
      draft,
      el: fixture.nativeElement as HTMLElement,
    };
  }

  it('restores the URL state, goes live and writes deep links (merged, `?draft=` stays)', () => {
    const { page, el, topology, router } = setup({ q: 'kind:Node', select: 'node:n1' });

    expect(page.mode()).toBe('live');
    expect(topology['load']).toHaveBeenCalledWith({ flows: true });
    expect(topology['connectLive']).toHaveBeenCalled();
    expect(page.matching()?.has('node:n1')).toBe(true);
    expect(el.querySelector('[data-testid="topology-modes"]')).not.toBeNull();
    // A page header (3.38 R1) with the view options; the strip carries search + chips inline.
    expect(el.querySelector('fpc-page-header [data-testid="topology-layers"]')).not.toBeNull();
    expect(el.querySelector('.fpc-list-toolbar [data-testid="topology-search"]')).not.toBeNull();
    expect(el.querySelector('.fpc-list-toolbar fpc-filter-chips')).not.toBeNull();
    expect(el.querySelector('[data-testid="topology-inspector"]')?.textContent).toContain('n1');
    expect(el.querySelector('[data-testid="topology-details"].fpc-key-value-list')).not.toBeNull();
    expect(el.querySelector('[data-testid="topology-open-object"]')).not.toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParamsHandling: 'merge',
        queryParams: expect.objectContaining({ select: 'node:n1' }),
      }),
    );
  });

  it('switches to the plan overlay and back', () => {
    const { page, topology } = setup();

    page.onPlanChange(PLAN);
    page.setMode('plan');
    expect(topology['load']).toHaveBeenLastCalledWith({ plan: PLAN });
    expect(page.mode()).toBe('plan');
  });

  it('runs inspector actions through the Resources context', () => {
    const { page, context, fixture, el } = setup();

    page.select('node:n1');
    fixture.detectChanges();
    (el.querySelector('[data-testid="topology-inspector-actions"] button') as HTMLButtonElement).click();
    expect(context.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-drain' }),
      expect.objectContaining({ id: 'node:n1' }),
    );
  });

  it('only drags while "Edit on map" is on; the map draws no policies (2026-10-29)', () => {
    const { page, draft, el, fixture } = setup();

    expect(page.mayEdit()).toBe(true);
    page.onDrop({ id: 'node:n1', position: { x: 0, y: 0 } });
    expect(draft.upsert).not.toHaveBeenCalled();

    page.setEditing(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="topology-draw-policy"]')).toBeNull();
    // Clicking map items only selects them, also while editing.
    page.onElementSelect({ id: 'group:shop/frontend' } as never);
    expect(page.selectedId()).toBe('group:shop/frontend');
    expect(draft.upsert).not.toHaveBeenCalled();
  });

  it('as a scoped tab: live only, part of the map, no URL writes, links to the full page', () => {
    const { page, el, router, context } = setup({}, { kind: 'site', name: 'b' });

    expect(context.start).toHaveBeenCalled();
    page.setMode('plan');
    expect(page.mode()).toBe('live');
    expect(page.allDrawn().has('site:a')).toBe(false);
    expect(page.allDrawn().has('node:n3')).toBe(true);
    expect(el.querySelector('[data-testid="topology-modes"]')).toBeNull();
    expect(el.querySelector('[data-testid="topology-open-full"]')).not.toBeNull();
    expect(el.querySelector('fpc-page-header')).toBeNull();
    expect(el.querySelector('.fpc-list-toolbar [data-testid="topology-layers"]')).not.toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('in a scoped section (deployment Network tab): selects the scope element, not the URL one', () => {
    const { page, router } = setup(
      { select: 'node:n1' },
      { kind: 'project', name: 'shop' },
      { project: 'shop', select: 'deployment:shop/site' },
    );

    expect(page.selectedId()).toBe('deployment:shop/site');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
