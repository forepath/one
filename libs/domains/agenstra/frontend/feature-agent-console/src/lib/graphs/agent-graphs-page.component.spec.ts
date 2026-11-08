import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AgentGraphsFacade,
  AgentsFacade,
  ClientsFacade,
  type AgentGraphDocument,
  type AgentGraphReferencesResponse,
  type AgentGraphStatus,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';

import { AgentGraphCanvasComponent } from './agent-graph-canvas.component';
import { AgentGraphsPageComponent } from './agent-graphs-page.component';

/** jsdom has no 2D canvas: the viewer is replaced by a stub. */
@Component({ selector: 'framework-agent-graph-canvas', standalone: true, template: '' })
class AgentGraphCanvasStubComponent {
  readonly document = input<AgentGraphDocument | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly hiddenTypes = input<ReadonlySet<string>>(new Set());
  readonly highlightIds = input<readonly string[]>([]);
  readonly hops = input(1);
  readonly showLabels = input(true);
  readonly loading = input(false);
  readonly ariaLabel = input('');
  readonly nodeSelected = output<string | null>();
  readonly zoomToFit = jest.fn();
  readonly focusNode = jest.fn();
}

function callableStream(): unknown {
  const stream = new Subject<never>();
  const fn = jest.fn(() => new Subject<never>());

  return Object.assign(fn, {
    subscribe: stream.subscribe.bind(stream),
    pipe: stream.pipe.bind(stream),
    lift: stream.lift.bind(stream),
    [Symbol.observable ?? '@@observable']: () => stream,
  });
}

function autoMock(base: Record<string, unknown> = {}): unknown {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? callableStream() : jest.fn(() => NEVER);

      return target[prop];
    },
  });
}

function documentFixture(overrides: Partial<AgentGraphDocument> = {}): AgentGraphDocument {
  return {
    version: 1,
    scope: 'environment',
    layer: 'code',
    environmentId: 'agent-1',
    generatedAt: '2026-11-07T10:00:00.000Z',
    nodes: [
      { id: 'file:src/a.ts', type: 'file', label: 'a.ts', path: 'src/a.ts', attrs: { language: 'typescript' } },
      { id: 'file:src/b.ts', type: 'file', label: 'b.ts', path: 'src/b.ts' },
      { id: 'package:rxjs', type: 'package', label: 'rxjs' },
    ],
    edges: [
      { from: 'file:src/a.ts', to: 'file:src/b.ts', type: 'imports' },
      { from: 'file:src/a.ts', to: 'package:rxjs', type: 'depends_on' },
    ],
    truncated: false,
    totalNodes: 3,
    totalEdges: 2,
    ...overrides,
  };
}

function statusFixture(overrides: Partial<AgentGraphStatus> = {}): AgentGraphStatus {
  return {
    environmentId: 'agent-1',
    status: 'ready',
    builtAt: '2026-11-07T10:00:00.000Z',
    buildDurationMs: 1000,
    truncated: false,
    error: null,
    layers: {},
    languages: {},
    fileCount: 2,
    ...overrides,
  };
}

describe('AgentGraphsPageComponent', () => {
  let fixture: ComponentFixture<AgentGraphsPageComponent>;
  let graphsFacade: Record<string, jest.Mock> & {
    document$: BehaviorSubject<AgentGraphDocument | null>;
    status$: BehaviorSubject<AgentGraphStatus | null>;
  };

  async function create(
    queryParams: Record<string, string>,
    state: {
      document?: AgentGraphDocument | null;
      status?: AgentGraphStatus | null;
      references?: AgentGraphReferencesResponse | null;
    } = {},
    params: Record<string, string> = { clientId: 'client-1' },
    activeClientId: string | null = 'client-1',
  ): Promise<void> {
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams),
        paramMap: convertToParamMap(params),
      },
      paramMap: new BehaviorSubject(convertToParamMap(params)),
      queryParamMap: new BehaviorSubject(convertToParamMap(queryParams)),
      parent: null,
    };
    const document = state.document ?? null;

    graphsFacade = autoMock({
      document$: new BehaviorSubject(document),
      documentLoading$: new BehaviorSubject(false),
      documentLoadingMore$: new BehaviorSubject(false),
      documentError$: new BehaviorSubject<string | null>(null),
      documentNodeTypes$: new BehaviorSubject(
        document ? [...new Set(document.nodes.map((node) => node.type))].map((type) => ({ type, count: 1 })) : [],
      ),
      status$: new BehaviorSubject(state.status ?? null),
      refreshingKey$: new BehaviorSubject<string | null>(null),
      nodeDetail$: new BehaviorSubject(null),
      search$: new BehaviorSubject(null),
      references$: new BehaviorSubject(state.references ?? null),
      globalStatuses$: new BehaviorSubject([]),
      error$: new BehaviorSubject<string | null>(null),
      loadDocument: jest.fn(),
      loadStatus: jest.fn(),
      loadWorkspace: jest.fn(),
      loadGlobal: jest.fn(),
      loadGlobalStatus: jest.fn(),
      loadReferences: jest.fn(),
      loadNodeDetail: jest.fn(),
      clearNodeDetail: jest.fn(),
      clearSearch: jest.fn(),
      refresh: jest.fn(),
      expandNeighbors: jest.fn(),
      search: jest.fn(),
    }) as typeof graphsFacade;

    await TestBed.configureTestingModule({
      imports: [AgentGraphsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: AgentGraphsFacade, useValue: graphsFacade },
        {
          provide: ClientsFacade,
          useValue: autoMock({
            clients$: new BehaviorSubject([{ id: 'client-1', name: 'Workspace' }]),
            activeClientId$: new BehaviorSubject<string | null>(activeClientId),
          }),
        },
        {
          provide: AgentsFacade,
          useValue: autoMock({
            getClientAgents$: jest.fn(() =>
              of([
                { id: 'agent-1', name: 'Primary' },
                { id: 'agent-2', name: 'Secondary' },
              ]),
            ),
          }),
        },
      ],
    })
      .overrideComponent(AgentGraphsPageComponent, {
        remove: { imports: [AgentGraphCanvasComponent] },
        add: { imports: [AgentGraphCanvasStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AgentGraphsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);

  afterEach(() => TestBed.resetTestingModule());

  it('selects the first environment when none is given', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({});

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { agentId: 'agent-1' }, replaceUrl: true }),
    );
    navigate.mockRestore();
  });

  it('loads status and document of the selected environment', async () => {
    await create({ agentId: 'agent-2', layer: 'paths' });

    expect(graphsFacade.loadStatus).toHaveBeenCalledWith('client-1', 'agent-2');
    // Default node limit: all (loaded page by page).
    expect(graphsFacade.loadDocument).toHaveBeenCalledWith('client-1', 'agent-2', 'paths', { limit: undefined });
    expect(graphsFacade.loadReferences).not.toHaveBeenCalled();
  });

  it('defaults to the all layer and loads prompts with it', async () => {
    await create({ agentId: 'agent-1', limit: '1500' });

    expect(graphsFacade.loadDocument).toHaveBeenCalledWith('client-1', 'agent-1', 'all', { limit: 1500 });
    expect(graphsFacade.loadReferences).toHaveBeenCalledWith('client-1', 'agent-1');
    expect(fixture.componentInstance.layers().map((layer) => layer.id)).toEqual(['all', 'code', 'paths', 'references']);
  });

  it('loads prompt references on the references layer', async () => {
    await create(
      { agentId: 'agent-1', layer: 'references' },
      {
        references: {
          environmentId: 'agent-1',
          prompts: [
            {
              id: 'p1',
              environmentId: 'agent-1',
              chatSessionId: null,
              messageId: null,
              origin: 'chat',
              excerpt: 'Fix it',
              startedAt: '2026-11-07T10:00:00.000Z',
              finishedAt: null,
              counts: { attached: 0, available: 1, used: 2, modified: 0 },
            },
          ],
        },
      },
    );

    expect(graphsFacade.loadReferences).toHaveBeenCalledWith('client-1', 'agent-1');
    // The panel shows for the prompt list even without a selection.
    expect(query('[data-testid="agent-graphs-prompts"]')?.textContent).toContain('Fix it');
    // Subheader + list rows with count badges (no dot-separated meta text anywhere).
    expect(query('[data-testid="agent-graphs-prompts"] fpc-list-header')?.textContent).toContain('Prompts');
    expect(query('[data-testid="agent-graphs-prompts"] fpc-list-item fpc-badge')?.textContent).toContain('Available 1');
    expect(fixture.nativeElement.textContent).not.toContain('·');
  });

  it('offers to build a missing graph', async () => {
    await create({ agentId: 'agent-1' }, { status: statusFixture({ status: 'missing' }) });

    const build = query('[data-testid="agent-graphs-build"] button') as HTMLButtonElement | null;

    expect(build).not.toBeNull();
    build?.click();
    expect(graphsFacade.refresh).toHaveBeenCalledWith('client-1', 'agent-1', 'all', { limit: undefined });
  });

  it('shows the graph and the details of a selected node', async () => {
    await create({ agentId: 'agent-1', layer: 'code' }, { document: documentFixture(), status: statusFixture() });

    expect(query('framework-agent-graph-canvas')).not.toBeNull();

    const component = fixture.componentInstance;

    // Nothing selected, no search, no prompts: no side panel.
    expect(query('[data-testid="agent-graphs-panel"]')).toBeNull();

    component.onSelectNode('file:src/a.ts');
    fixture.detectChanges();
    expect(query('[data-testid="agent-graphs-panel"]')).not.toBeNull();

    expect(graphsFacade.loadNodeDetail).toHaveBeenCalledWith('client-1', 'agent-1', 'code', 'file:src/a.ts');
    expect(query('[data-testid="agent-graphs-node-header"]')?.textContent).toContain('a.ts');
    // Header style for the node (name + type), subheader style (with counts) for its relation lists.
    expect(query('[data-testid="agent-graphs-node-header"] h1')?.textContent).toContain('a.ts');
    expect(query('[data-testid="agent-graphs-node-header"] .fpc-object-header__meta')?.textContent).toContain('File');
    expect(query('[data-testid="agent-graphs-outgoing-header"]')?.textContent).toContain('Outgoing');
    expect(query('[data-testid="agent-graphs-outgoing-header"] [data-testid="fpc-list-header-count"]')).toBeNull();
    // Without a loaded detail the relations come from the document.
    expect(component.outgoingRelations().map((relation) => relation.targetId)).toEqual([
      'file:src/b.ts',
      'package:rxjs',
    ]);
    expect(component.selectedAttrs()).toEqual([{ id: 'language', key: 'Language', value: 'TypeScript' }]);
    expect(component.outgoingRelations().map((relation) => relation.edgeLabel)).toEqual(['Imports', 'Depends on']);
    // Relation tables are searchable.
    component.outgoingQuery.set('rxjs');
    expect(component.outgoingRelations().map((relation) => relation.targetId)).toEqual(['package:rxjs']);
    expect(query('[data-testid="agent-graphs-attributes"]')).not.toBeNull();

    expect(query('.graphs-panel__detail > .graphs-panel__section')).not.toBeNull();

    // A node without path, attributes or loading state has no details block (only its header and relations).
    component.onSelectNode('package:rxjs');
    fixture.detectChanges();
    expect(query('[data-testid="agent-graphs-node-header"]')?.textContent).toContain('rxjs');
    expect(query('.graphs-panel__detail > .graphs-panel__section')).toBeNull();
    component.onSelectNode('file:src/a.ts');

    component.onExpandNeighbors();
    expect(graphsFacade.expandNeighbors).toHaveBeenCalledWith('client-1', 'agent-1', 'code', 'file:src/a.ts', {
      depth: 1,
      limit: undefined,
    });
  });

  it('filters loaded nodes client-side and hides toggled types', async () => {
    await create({ agentId: 'agent-1' }, { document: documentFixture(), status: statusFixture() });

    const component = fixture.componentInstance;

    component.onFilterChange('b.ts');
    expect(component.filterMatches()).toEqual(['file:src/b.ts']);
    // The same field searches every node of the environment server-side (debounced).
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(graphsFacade.search).toHaveBeenCalledWith(
      'client-1',
      'agent-1',
      'b.ts',
      expect.objectContaining({ limit: 50 }),
    );

    // Neighborhood: a small select next to the node limit, 1 to 5 hops.
    expect(fixture.nativeElement.querySelectorAll('#agentGraphsHops option')).toHaveLength(5);
    component.onHopsChange('4');
    expect(component.hops()).toBe(4);
    component.onHopsChange('0');
    expect(component.hops()).toBe(1);
    component.onHopsChange('9');
    expect(component.hops()).toBe(5);

    component.onToggleType('package');
    expect(component.isTypeHidden('package')).toBe(true);
    component.onShowAllTypes();
    expect(component.isTypeHidden('package')).toBe(false);
  });

  it('loads the workspace graph and resolves scoped node ids for details', async () => {
    await create(
      { scope: 'workspace' },
      {
        document: documentFixture({
          scope: 'workspace',
          nodes: [{ id: 'agent-2::file:src/a.ts', type: 'file', label: 'a.ts' }],
          edges: [],
        }),
      },
    );

    expect(graphsFacade.loadWorkspace).toHaveBeenCalledWith('client-1', 'all', { limit: undefined });

    fixture.componentInstance.onSelectNode('agent-2::file:src/a.ts');
    expect(graphsFacade.loadNodeDetail).toHaveBeenCalledWith('client-1', 'agent-2', 'all', 'file:src/a.ts');
  });

  it('loads the knowledge layer of a workspace and the global graph per layer', async () => {
    await create({ scope: 'workspace', layer: 'knowledge' });
    expect(graphsFacade.loadWorkspace).toHaveBeenCalledWith('client-1', 'knowledge', { limit: undefined });
    expect(fixture.componentInstance.layers().map((layer) => layer.id)).toContain('knowledge');
    TestBed.resetTestingModule();

    await create({ scope: 'global', layer: 'paths', limit: '6000' });
    expect(graphsFacade.loadGlobal).toHaveBeenCalledWith('paths', { limit: 6000 });
    expect(query('#agentGraphsLayer')).not.toBeNull();
    expect(graphsFacade.loadGlobalStatus).toHaveBeenCalled();
    expect(query('[data-testid="agent-graphs-global-summary"]')).not.toBeNull();
  });

  it('opens the global graph when the path has no workspace id', async () => {
    await create({}, {}, {});
    expect(fixture.componentInstance.scope()).toBe('global');
    expect(graphsFacade.loadGlobal).toHaveBeenCalledWith('all', { limit: undefined });
    expect(graphsFacade.loadDocument).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    // An explicit scope still wins.
    await create({ scope: 'environment' }, {}, {});
    expect(fixture.componentInstance.scope()).toBe('environment');
  });

  it('leaving the global view without a workspace id focuses the chosen workspace', async () => {
    await create({}, {}, {});
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.onScopeChange('workspace');
    expect(navigate).toHaveBeenCalledWith(['/graphs', 'client-1'], {
      queryParams: { scope: 'workspace' },
      queryParamsHandling: 'merge',
    });
  });

  it('leaving the global view without any chosen workspace opens the workspace switch first', async () => {
    await create({}, {}, {}, null);
    const component = fixture.componentInstance;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.onScopeChange('workspace');
    expect(component.workspaceSwitchModalOpen()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    component.onSelectWorkspace({ id: 'client-1', name: 'Workspace' } as never);
    expect(component.workspaceSwitchModalOpen()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/graphs', 'client-1'], { queryParams: { scope: 'workspace' } });
  });

  it('ignores an agentId that could steer the API path and falls back to the first environment', async () => {
    await create({ agentId: '..' });
    expect(fixture.componentInstance.agentId()).toBeNull();
    expect(graphsFacade.loadDocument).not.toHaveBeenCalledWith('client-1', '..', expect.anything(), expect.anything());
  });

  it('clears the search when a search result is picked', async () => {
    await create({ agentId: 'agent-1' }, { document: documentFixture(), status: statusFixture() });
    const component = fixture.componentInstance;

    component.onFilterChange('positions');
    component.onSelectSearchHit('file:src/a.ts');
    expect(component.filterQuery()).toBe('');
    expect(component.showSearchResults()).toBe(false);
    expect(graphsFacade.clearSearch).toHaveBeenCalled();
  });
});
