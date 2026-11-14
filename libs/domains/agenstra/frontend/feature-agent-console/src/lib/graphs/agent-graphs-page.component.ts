import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentGraphsFacade,
  AgentsFacade,
  ClientsFacade,
  type AgentResponseDto,
  type ClientResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  AGENT_GRAPH_VIEW_LAYERS,
  isAgentGraphViewLayer,
  parseScopedAgentGraphNodeId,
  scopeAgentGraphNodeId,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentGraphQueryLayer,
  type AgentGraphViewLayer,
  type AgentGraphPromptReference,
  type AgentGraphReferenceKind,
  type AgentGraphScope,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListHeaderComponent,
  FpcListItemComponent,
  FpcListToolbarComponent,
  FpcModalComponent,
  FpcObjectHeaderComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  fpcCopyText,
  type FpcTableColumn,
  fpcFormatDateTime,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, debounceTime, distinctUntilChanged, filter, map, of, skip, switchMap } from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

import { AgentGraphCanvasComponent } from './agent-graph-canvas.component';
import {
  AGENT_GRAPH_REFERENCE_KINDS,
  AGENT_GRAPH_HIDDEN_ATTRIBUTES,
  agentGraphAttributeLabel,
  agentGraphAttributeValue,
  agentGraphLayerLabel,
  agentGraphNodeColorCss,
  agentGraphNodeDisplayLabel,
  agentGraphNodeIcon,
  agentGraphNodeTypeLabel,
  agentGraphReferenceKindLabel,
  agentGraphRelationLabel,
  agentGraphStatusLabel,
  agentGraphStatusTone,
  agentGraphToolLabel,
} from './graph-labels';
import { matchNodes } from './graph-layout';

/** Node limits offered for documents; `all` (default) loads every node page by page. */
export const AGENT_GRAPH_NODE_LIMIT_OPTIONS = ['all', 1500, 3000, 6000] as const;
export type AgentGraphNodeLimit = (typeof AGENT_GRAPH_NODE_LIMIT_OPTIONS)[number];
/** Layers per scope (`knowledge` is the controller's metadata layer: workspace / global only). */
/** Neighborhood around the selection that stays emphasized: 1 to {@link MAX_NEIGHBORHOOD_HOPS} hops. */
const MAX_NEIGHBORHOOD_HOPS = 5;
/** Environment ids (UUIDs): plain id characters only, so `?agentId=` can never steer an API path (`..`, `/`). */
const ENVIRONMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ENVIRONMENT_LAYERS: readonly AgentGraphViewLayer[] = ['all', 'code', 'paths', 'references'];
const SERVER_SEARCH_LIMIT = 50;
/** Search matches highlighted on the canvas. */
const MAX_HIGHLIGHTS = 300;

export interface AgentGraphRelationView {
  direction: 'outgoing' | 'incoming';
  edgeType: string;
  /** Id in the loaded document (scoped in workspace graphs). */
  targetId: string;
  label: string;
  type: string;
  path?: string;
  inDocument: boolean;
}

/** One relation row of the side panel tables. */
interface AgentGraphRelationRow extends AgentGraphRelationView {
  id: string;
  typeLabel: string;
  edgeLabel: string;
}

interface AgentGraphAttrRow {
  id: string;
  key: string;
  value: string;
}

/**
 * Environment graphs of a workspace (`/graphs/:clientId`): environment graph layers (code, paths, prompt references),
 * the composed workspace graph / metadata snapshot and the global graph over every accessible workspace. Same
 * workspace selection flow as tasks and plans.
 */
@Component({
  selector: 'framework-agent-graphs-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    AgentGraphCanvasComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListHeaderComponent,
    FpcListItemComponent,
    FpcListToolbarComponent,
    FpcModalComponent,
    FpcObjectHeaderComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    WorkspaceSwitchTableComponent,
  ],
  templateUrl: './agent-graphs-page.component.html',
  styleUrls: ['./agent-graphs-page.component.scss'],
})
export class AgentGraphsPageComponent {
  readonly pageTitle = $localize`:@@featureAgentGraphs-title:Graphs`;
  readonly scopeLabel = $localize`:@@featureAgentGraphs-scopeLabel:Graph scope`;
  readonly environmentLabel = $localize`:@@featureAgentGraphs-environmentLabel:Environment`;
  readonly layerLabel = $localize`:@@featureAgentGraphs-layerLabel:Layer`;
  readonly limitLabel = $localize`:@@featureAgentGraphs-limitLabel:Nodes`;
  readonly refreshTitle = $localize`:@@featureAgentGraphs-refreshTitle:Rebuild graph`;
  readonly refreshSnapshotTitle = $localize`:@@featureAgentGraphs-refreshSnapshotTitle:Refresh snapshot`;
  readonly reloadTitle = $localize`:@@featureAgentGraphs-reloadTitle:Reload`;
  readonly limitAllLabel = $localize`:@@featureAgentGraphs-limitAll:All`;
  readonly missingHint = $localize`:@@featureAgentGraphs-missingHint:Prompts referenced this path, but it is no longer in the environment.`;
  readonly outgoingLabel = $localize`:@@featureAgentGraphs-outgoing:Outgoing`;
  readonly incomingLabel = $localize`:@@featureAgentGraphs-incoming:Incoming`;
  readonly attributesLabel = $localize`:@@featureAgentGraphs-attributes:Attributes`;
  readonly relationSearchPlaceholder = $localize`:@@featureAgentGraphs-relationSearch:Filter relations`;
  readonly relationColumns: FpcTableColumn<AgentGraphRelationRow>[] = [
    {
      id: 'node',
      label: $localize`:@@featureAgentGraphs-columnNode:Node`,
      value: (row) => row.label,
      required: true,
    },
    {
      id: 'relation',
      label: $localize`:@@featureAgentGraphs-columnRelation:Relation`,
      value: (row) => row.edgeLabel,
      width: '35%',
      // Also on the stacked cards the narrow side panel shows.
      priority: 1,
    },
  ];
  readonly attrColumns: FpcTableColumn<AgentGraphAttrRow>[] = [
    {
      id: 'key',
      label: $localize`:@@featureAgentGraphs-columnAttribute:Attribute`,
      value: (row) => row.key,
      width: '40%',
    },
    {
      id: 'value',
      label: $localize`:@@featureAgentGraphs-columnValue:Value`,
      value: (row) => row.value,
      required: true,
      priority: 1,
    },
  ];
  readonly filterLabel = $localize`:@@featureAgentGraphs-filterLabel:Find in graph`;
  readonly filterPlaceholder = $localize`:@@featureAgentGraphs-filterPlaceholder:Search nodes (Enter to focus)`;
  readonly hopsLabel = $localize`:@@featureAgentGraphs-hopsLabel:Neighborhood`;
  readonly labelsLabel = $localize`:@@featureAgentGraphs-labelsLabel:Labels`;
  readonly zoomToFitTitle = $localize`:@@featureAgentGraphs-zoomToFit:Zoom to fit`;
  readonly typeFilterLabel = $localize`:@@featureAgentGraphs-typeFilterLabel:Node types`;
  readonly canvasLabel = $localize`:@@featureAgentGraphs-canvasAriaLabel:Graph of the selected scope. Select nodes to see their details.`;
  readonly copyPathTitle = $localize`:@@featureAgentGraphs-copyPath:Copy absolute path`;
  readonly expandNeighborsTitle = $localize`:@@featureAgentGraphs-expandNeighbors:Expand neighbors`;
  readonly clearSelectionTitle = $localize`:@@featureAgentGraphs-clearSelection:Clear selection`;
  readonly promptsLabel = $localize`:@@featureAgentGraphs-promptsLabel:Prompts`;
  readonly searchResultsLabel = $localize`:@@featureAgentGraphs-searchResults:Search results`;
  readonly timesLabel = $localize`:@@featureAgentGraphs-times:Times`;
  readonly promptSearchPlaceholder = $localize`:@@featureAgentGraphs-promptSearch:Filter prompts`;
  readonly referenceSearchPlaceholder = $localize`:@@featureAgentGraphs-referenceSearch:Filter references`;
  readonly scopes: { id: AgentGraphScope; label: string }[] = [
    { id: 'environment', label: $localize`:@@featureAgentGraphs-scopeEnvironment:Environment` },
    { id: 'workspace', label: $localize`:@@featureAgentGraphs-scopeWorkspace:Workspace` },
    { id: 'global', label: $localize`:@@featureAgentGraphs-scopeGlobal:Global` },
  ];
  readonly layers = computed(() =>
    (this.scope() === 'environment' ? ENVIRONMENT_LAYERS : AGENT_GRAPH_VIEW_LAYERS).map((layer) => ({
      id: layer,
      label: agentGraphLayerLabel(layer),
    })),
  );
  readonly limitOptions = AGENT_GRAPH_NODE_LIMIT_OPTIONS;
  readonly hopsOptions = Array.from({ length: MAX_NEIGHBORHOOD_HOPS }, (_, index) => index + 1);
  readonly referenceKinds = AGENT_GRAPH_REFERENCE_KINDS;

  readonly typeLabel = agentGraphNodeTypeLabel;
  readonly toolLabel = agentGraphToolLabel;
  readonly nodeLabel = agentGraphNodeDisplayLabel;
  readonly typeIcon = agentGraphNodeIcon;
  readonly typeColor = agentGraphNodeColorCss;
  readonly statusLabel = agentGraphStatusLabel;
  readonly statusTone = agentGraphStatusTone;
  readonly kindLabel = agentGraphReferenceKindLabel;

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly graphsFacade = inject(AgentGraphsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly canvas = viewChild(AgentGraphCanvasComponent);
  /** Pinned node header of the side panel; sticky subheaders are offset by its height. */
  private readonly nodeHeader = viewChild('nodeHeader', { read: ElementRef });

  readonly activeClientId = toSignal(this.clientsFacade.activeClientId$, { initialValue: null });
  /** Workspace for this page: URL `:clientId` wins so deep links load before the store catches up. */
  readonly effectiveClientId$ = combineLatest([this.route.paramMap, this.clientsFacade.activeClientId$]).pipe(
    map(([params, active]) => (params.get('clientId')?.trim() || active || null) as string | null),
    distinctUntilChanged(),
  );
  readonly effectiveClientId = toSignal(this.effectiveClientId$, { initialValue: null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });
  readonly agents = toSignal(
    this.effectiveClientId$.pipe(
      switchMap((clientId) => (clientId ? this.agentsFacade.getClientAgents$(clientId) : of([]))),
    ),
    { initialValue: [] as AgentResponseDto[] },
  );
  // View (query parameters: `scope`, `agentId`, `layer`, `limit`).
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: null });
  private readonly routeParams = toSignal(this.route.paramMap, { initialValue: null });
  /** `/graphs` without a workspace id opens the global graph; `/graphs/:clientId` the environment graph. */
  readonly defaultScope = computed<AgentGraphScope>(() =>
    this.routeParams()?.get('clientId')?.trim() ? 'environment' : 'global',
  );
  readonly scope = computed<AgentGraphScope>(() => {
    const value = this.queryParams()?.get('scope');

    return value === 'environment' || value === 'workspace' || value === 'global' ? value : this.defaultScope();
  });
  /** `?agentId=` when it looks like an environment id (anything else falls back to the first environment). */
  readonly agentId = computed(() => {
    const value = this.queryParams()?.get('agentId')?.trim() ?? '';

    return ENVIRONMENT_ID_PATTERN.test(value) ? value : null;
  });
  readonly layer = computed<AgentGraphViewLayer>(() => {
    const value = this.queryParams()?.get('layer');

    if (!isAgentGraphViewLayer(value)) {
      return 'all';
    }

    // The environment scope has no knowledge layer (that one lives in the controller).
    return this.scope() === 'environment' && value === 'knowledge' ? 'all' : value;
  });
  /** Layer for the agent-manager endpoints (environment scope, node details of composed graphs). */
  readonly queryLayer = computed<AgentGraphQueryLayer>(() => {
    const layer = this.layer();

    return layer === 'knowledge' ? 'all' : layer;
  });
  /** Node limit; `undefined` = all nodes (loaded page by page). */
  readonly limit = computed<number | undefined>(() => {
    const value = Number(this.queryParams()?.get('limit'));

    return (AGENT_GRAPH_NODE_LIMIT_OPTIONS as readonly unknown[]).includes(value) ? value : undefined;
  });
  readonly limitValue = computed(() => String(this.limit() ?? 'all'));
  readonly selectedAgent = computed(() => this.agents().find((agent) => agent.id === this.agentId()) ?? null);
  /** Identity of the loaded view; selection, filters and search reset when it changes. */
  readonly viewKey = computed(() =>
    [this.effectiveClientId(), this.scope(), this.agentId(), this.layer(), this.limitValue()].join('|'),
  );

  // Store
  private readonly rawDocument = toSignal(this.graphsFacade.document$, { initialValue: null });
  /** The loaded document with readable labels (languages, tools) for the canvas, header, search and filter. */
  readonly document = computed(() => {
    const document = this.rawDocument();
    const relabel = (type: string) => type === 'language' || type === 'tool' || type === 'instance';
    // Environments referenced by prompts carry only their id (`environment:<id>`): show the environment's name.
    const environmentLabel = (node: AgentGraphNode) =>
      node.type === 'environment' && node.id !== 'environment' ? this.environmentName(node.id) : undefined;

    if (!document || !document.nodes.some((node) => relabel(node.type) || environmentLabel(node))) {
      return document;
    }

    return {
      ...document,
      nodes: document.nodes.map((node) => {
        const label = environmentLabel(node) ?? (relabel(node.type) ? agentGraphNodeDisplayLabel(node) : undefined);

        return label ? { ...node, label } : node;
      }),
    };
  });
  readonly documentLoading = toSignal(this.graphsFacade.documentLoading$, { initialValue: false });
  readonly documentLoadingMore = toSignal(this.graphsFacade.documentLoadingMore$, { initialValue: false });
  readonly documentError = toSignal(this.graphsFacade.documentError$, { initialValue: null });
  readonly documentNodeTypes = toSignal(this.graphsFacade.documentNodeTypes$, { initialValue: [] });
  readonly neighborsLoading = toSignal(this.graphsFacade.neighborsLoading$, { initialValue: false });
  readonly status = toSignal(this.graphsFacade.status$, { initialValue: null });
  readonly statusLoading = toSignal(this.graphsFacade.statusLoading$, { initialValue: false });
  readonly refreshingKey = toSignal(this.graphsFacade.refreshingKey$, { initialValue: null });
  readonly nodeDetail = toSignal(this.graphsFacade.nodeDetail$, { initialValue: null });
  readonly nodeDetailLoading = toSignal(this.graphsFacade.nodeDetailLoading$, { initialValue: false });
  readonly nodeDetailError = toSignal(this.graphsFacade.nodeDetailError$, { initialValue: null });
  readonly searchResult = toSignal(this.graphsFacade.search$, { initialValue: null });
  readonly searchLoading = toSignal(this.graphsFacade.searchLoading$, { initialValue: false });
  readonly references = toSignal(this.graphsFacade.references$, { initialValue: null });
  readonly referencesLoading = toSignal(this.graphsFacade.referencesLoading$, { initialValue: false });
  readonly snapshotStatus = toSignal(this.graphsFacade.snapshotStatus$, { initialValue: null });
  readonly snapshotRefreshing = toSignal(this.graphsFacade.snapshotRefreshing$, { initialValue: false });
  readonly globalStatuses = toSignal(this.graphsFacade.globalStatuses$, { initialValue: [] });
  readonly error = toSignal(this.graphsFacade.error$, { initialValue: null });

  // Local UI state
  readonly selectedId = signal<string | null>(null);
  readonly hiddenTypes = signal<ReadonlySet<string>>(new Set<string>());
  readonly filterQuery = signal('');
  readonly hops = signal(1);
  /** Node labels on the canvas (hiding them calms large graphs; names stay in the hover card). */
  readonly showLabels = signal(true);
  readonly serverQuery = signal('');
  readonly outgoingQuery = signal('');
  readonly promptQuery = signal('');
  readonly referenceQueries = signal<Partial<Record<AgentGraphReferenceKind, string>>>({});
  readonly incomingQuery = signal('');
  readonly selectedPromptId = signal<string | null>(null);

  readonly refreshing = computed(() => {
    const clientId = this.effectiveClientId();
    const agentId = this.agentId();

    return !!clientId && !!agentId && this.refreshingKey() === `${clientId}:${agentId}`;
  });
  /** Status of the selected environment (ignores a status of another environment still in the store). */
  readonly environmentStatus = computed(() => {
    const status = this.status();

    return status && status.environmentId === this.agentId() ? status : null;
  });
  readonly buildMissing = computed(
    () => this.scope() === 'environment' && this.environmentStatus()?.status === 'missing' && !this.refreshing(),
  );
  readonly filterMatches = computed(() => matchNodes(this.document()?.nodes ?? [], this.filterQuery(), MAX_HIGHLIGHTS));
  readonly nodesById = computed(() => new Map((this.document()?.nodes ?? []).map((node) => [node.id, node] as const)));
  /** Selected node, from the document or (for nodes outside a truncated document) from the loaded detail. */
  readonly selectedNode = computed<AgentGraphNode | null>(() => {
    const id = this.selectedId();

    if (!id) {
      return null;
    }

    return this.nodesById().get(id) ?? this.matchingDetail()?.node ?? null;
  });
  /** Loaded node detail when it belongs to the current selection. */
  readonly matchingDetail = computed(() => {
    const entry = this.nodeDetail();
    const target = this.detailTarget(this.selectedId());

    return entry && target && entry.environmentId === target.agentId && entry.nodeId === target.nodeId
      ? entry.detail
      : null;
  });
  readonly relations = computed<AgentGraphRelationView[]>(() => {
    const id = this.selectedId();

    if (!id) {
      return [];
    }

    const detail = this.matchingDetail();
    const target = this.detailTarget(id);
    const nodes = this.nodesById();

    if (detail && target) {
      const toDocumentId = (nodeId: string) =>
        this.scope() === 'workspace' ? scopeAgentGraphNodeId(target.agentId, nodeId) : nodeId;
      const view = (direction: 'outgoing' | 'incoming', edge: AgentGraphEdge, node: AgentGraphNode) => {
        const targetId = toDocumentId(node.id);

        return {
          direction,
          edgeType: edge.type,
          targetId,
          label: node.label,
          type: node.type,
          ...(node.path ? { path: node.path } : {}),
          inDocument: nodes.has(targetId),
        };
      };

      return [
        ...detail.outgoing.map(({ edge, node }) => view('outgoing', edge, node)),
        ...detail.incoming.map(({ edge, node }) => view('incoming', edge, node)),
      ];
    }

    // Local relations from the loaded document (global / snapshot graphs, environment nodes of workspace graphs).
    const result: AgentGraphRelationView[] = [];

    for (const edge of this.document()?.edges ?? []) {
      if (edge.from !== id && edge.to !== id) {
        continue;
      }

      const direction = edge.from === id ? 'outgoing' : 'incoming';
      const otherId = direction === 'outgoing' ? edge.to : edge.from;
      const other = nodes.get(otherId);

      result.push({
        direction,
        edgeType: edge.type,
        targetId: otherId,
        label: other?.label ?? otherId,
        type: other?.type ?? '',
        ...(other?.path ? { path: other.path } : {}),
        inDocument: !!other,
      });
    }

    return result;
  });
  readonly outgoingRelations = computed(() => this.relationRows('outgoing', this.outgoingQuery()));
  readonly incomingRelations = computed(() => this.relationRows('incoming', this.incomingQuery()));
  readonly outgoingTotal = computed(() => this.relations().filter((r) => r.direction === 'outgoing').length);
  readonly incomingTotal = computed(() => this.relations().filter((r) => r.direction === 'incoming').length);
  /** Attributes for people: readable names and values, internal ids left out. */
  readonly selectedAttrs = computed<AgentGraphAttrRow[]>(() =>
    Object.entries(this.selectedNode()?.attrs ?? {})
      .filter(([key]) => !AGENT_GRAPH_HIDDEN_ATTRIBUTES.has(key))
      .map(([key, value]) => ({
        id: key,
        key: agentGraphAttributeLabel(key),
        value: agentGraphAttributeValue(key, value, this.locale, (date) => this.formatDate(date)),
      })),
  );
  /** The details block under the node header only renders when it has something to show. */
  readonly hasDetailContent = computed(
    () =>
      !!this.selectedNode()?.path ||
      !!this.matchingDetail()?.absolutePath ||
      this.selectedAttrs().length > 0 ||
      this.nodeDetailLoading() ||
      !!this.nodeDetailError(),
  );
  readonly relationRowId = (row: AgentGraphRelationRow) => row.id;
  readonly attrRowId = (row: AgentGraphAttrRow) => row.id;
  readonly canExpandNeighbors = computed(
    () => this.scope() === 'environment' && !!this.selectedId() && !!this.agentId(),
  );
  /** Server hits of the canvas search (environment scope; the loaded graph is filtered client-side as well). */
  readonly showSearchResults = computed(
    () => this.scope() === 'environment' && !!this.agentId() && !!this.filterQuery().trim() && !!this.searchResult(),
  );
  readonly showReferences = computed(
    () => this.scope() === 'environment' && (this.layer() === 'references' || this.layer() === 'all'),
  );
  /** The side panel only shows when it has content: a selected node, search hits or the prompt list. */
  readonly panelVisible = computed(
    () => !!this.selectedId() || this.showSearchResults() || (this.showReferences() && this.prompts().length > 0),
  );
  /** The workspace / global knowledge metadata is part of the view (its snapshot can be refreshed). */
  readonly showsKnowledge = computed(
    () => this.scope() === 'workspace' && (this.layer() === 'knowledge' || this.layer() === 'all'),
  );
  readonly prompts = computed(() => {
    const references = this.references();

    return references && references.environmentId === this.agentId() ? references.prompts : [];
  });
  readonly selectedPrompt = computed(() => {
    const prompt = this.references()?.prompt;

    return prompt && prompt.id === this.selectedPromptId() ? prompt : null;
  });
  /** Prompts narrowed by the Prompts search (excerpt, date, origin). */
  readonly filteredPrompts = computed(() => {
    const needle = this.promptQuery().trim().toLowerCase();
    const prompts = this.prompts();

    return needle
      ? prompts.filter((prompt) =>
          [prompt.excerpt ?? '', this.formatDate(prompt.startedAt), prompt.origin].some((value) =>
            value.toLowerCase().includes(needle),
          ),
        )
      : prompts;
  });
  /** Reference groups of the selected prompt; each group has its own search (name, path, type, tool). */
  readonly promptReferenceGroups = computed(() => {
    const prompt = this.selectedPrompt();
    const queries = this.referenceQueries();

    if (!prompt) {
      return [];
    }

    return this.referenceKinds
      .map((kind) => {
        const all = prompt.references.filter((reference) => reference.kind === kind);
        const needle = (queries[kind] ?? '').trim().toLowerCase();
        const items = needle
          ? all.filter((reference) =>
              [
                this.referenceLabel(reference),
                reference.path ?? '',
                agentGraphNodeTypeLabel(reference.type),
                reference.tool ? agentGraphToolLabel(reference.tool) : '',
              ].some((value) => value.toLowerCase().includes(needle)),
            )
          : all;

        return { kind, items, total: all.length, query: queries[kind] ?? '' };
      })
      .filter((group) => group.total > 0);
  });
  readonly globalSummary = computed(() => {
    const statuses = this.globalStatuses();

    return {
      workspaces: statuses.length,
      ready: statuses.filter((status) => status.status === 'ready').length,
      nodes: statuses.reduce((sum, status) => sum + status.nodes, 0),
    };
  });

  // Workspace switcher (same flow as tasks / plans)
  readonly workspaceSwitchModalOpen = signal(false);
  /** Scope requested from the global view before a workspace was chosen (applied by {@link onSelectWorkspace}). */
  private pendingScope: AgentGraphScope | null = null;
  readonly workspaceSwitchSearch = signal('');
  readonly workspaceSwitchHasMore = toSignal(this.clientsFacade.hasMore$, { initialValue: false });
  readonly workspaceSwitchAppendLoading = toSignal(this.clientsFacade.appendLoading$, { initialValue: false });
  readonly workspaceSwitchAppendError = toSignal(this.clientsFacade.appendError$, {
    initialValue: null as string | null,
  });

  constructor() {
    this.clientsFacade.loadClients();

    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));

    // "Search all nodes" searches live (debounced) like the other list searches; Enter searches right away.
    toObservable(this.serverQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onServerSearch());

    this.effectiveClientId$
      .pipe(
        filter((clientId): clientId is string => !!clientId),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((clientId) => this.agentsFacade.loadClientAgents(clientId));

    // Environment scope: without `?agentId=` (or with an environment of another workspace) the first one is used.
    effect(() => {
      const agents = this.agents();
      const agentId = this.agentId();

      if (this.scope() === 'environment' && agents.length > 0 && !agents.some((agent) => agent.id === agentId)) {
        untracked(() => this.navigateView({ agentId: agents[0].id }, true));
      }
    });

    // Sticky relation subheaders sit below the pinned node header: publish its height on the panel.
    effect((onCleanup) => {
      const header = this.nodeHeader()?.nativeElement as HTMLElement | undefined;
      const panel = header?.closest('.graphs-panel') as HTMLElement | null | undefined;

      if (!header || !panel || typeof ResizeObserver === 'undefined') {
        return;
      }

      const update = () => panel.style.setProperty('--graphs-panel-header-height', `${header.offsetHeight}px`);
      const observer = new ResizeObserver(update);

      update();
      observer.observe(header);
      onCleanup(() => observer.disconnect());
    });

    // Load whatever the view shows; selection, filters and search start fresh per view.
    effect(() => {
      this.viewKey();
      untracked(() => this.loadView());
    });
  }

  workspaceDisplayName(name: string | null | undefined): string {
    return resolveNamedDisplayLabel(name);
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  // View switches

  onScopeChange(scope: AgentGraphScope): void {
    const onWorkspacePath = !!this.routeParams()?.get('clientId')?.trim();

    // Leaving the global view on `/graphs`: focus the workspace chosen before, else let the user choose one (the
    // requested scope applies once a workspace is picked; closing the modal stays on the global view).
    if (scope !== 'global' && !onWorkspacePath) {
      const clientId = this.effectiveClientId();

      if (!clientId) {
        this.openWorkspaceSwitchModal(scope);

        return;
      }

      void this.router.navigate(['/graphs', clientId], {
        queryParams: { scope: scope === 'environment' ? null : scope },
        queryParamsHandling: 'merge',
      });

      return;
    }

    this.navigateView({ scope: scope === this.defaultScope() ? null : scope });
  }

  onAgentChange(agentId: string): void {
    this.navigateView({ agentId: agentId || null });
  }

  onLayerChange(layer: string): void {
    this.navigateView({ layer: isAgentGraphViewLayer(layer) && layer !== 'all' ? layer : null });
  }

  onLimitChange(limit: string | number): void {
    const value = Number(limit);

    this.navigateView({
      limit: (AGENT_GRAPH_NODE_LIMIT_OPTIONS as readonly unknown[]).includes(value) ? value : null,
    });
  }

  limitOptionLabel(option: AgentGraphNodeLimit): string {
    return option === 'all' ? this.limitAllLabel : String(option);
  }

  onReload(): void {
    this.loadView(false);
  }

  onRefresh(): void {
    const clientId = this.effectiveClientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.graphsFacade.refresh(clientId, agentId, this.queryLayer(), { limit: this.limit() });
    }
  }

  onRefreshSnapshot(): void {
    const clientId = this.effectiveClientId();

    if (clientId) {
      this.graphsFacade.refreshSnapshot(clientId, this.layer(), { limit: this.limit() });
    }
  }

  // Canvas controls

  onToggleType(type: string): void {
    const next = new Set(this.hiddenTypes());

    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }

    this.hiddenTypes.set(next);
  }

  onShowAllTypes(): void {
    this.hiddenTypes.set(new Set());
  }

  isTypeHidden(type: string): boolean {
    return this.hiddenTypes().has(type);
  }

  onHopsChange(value: string | number): void {
    this.hops.set(Math.min(MAX_NEIGHBORHOOD_HOPS, Math.max(1, Math.round(Number(value) || 1))));
  }

  /** The canvas search highlights loaded nodes and, in the environment scope, also searches every node server-side. */
  onFilterChange(query: string): void {
    this.filterQuery.set(query);

    if (this.scope() === 'environment') {
      this.serverQuery.set(query);
    }
  }

  onFilterEnter(event: Event): void {
    event.preventDefault();

    const first = this.filterMatches()[0];

    if (first) {
      this.onSelectNode(first);
      this.canvas()?.focusNode(first);
    }
  }

  onZoomToFit(): void {
    this.canvas()?.zoomToFit();
  }

  // Selection

  onSelectNode(id: string | null): void {
    this.selectedId.set(id);

    const target = this.detailTarget(id);
    const clientId = this.effectiveClientId();

    if (!id || !target || !clientId) {
      this.graphsFacade.clearNodeDetail();

      return;
    }

    this.graphsFacade.loadNodeDetail(clientId, target.agentId, this.queryLayer(), target.nodeId);
  }

  onSelectRelation(relation: AgentGraphRelationView): void {
    this.outgoingQuery.set('');
    this.incomingQuery.set('');
    this.onSelectNode(relation.targetId);

    if (relation.inDocument) {
      this.canvas()?.focusNode(relation.targetId);
    }
  }

  onExpandNeighbors(): void {
    const clientId = this.effectiveClientId();
    const agentId = this.agentId();
    const id = this.selectedId();

    if (clientId && agentId && id && this.scope() === 'environment') {
      this.graphsFacade.expandNeighbors(clientId, agentId, this.queryLayer(), id, { depth: 1, limit: this.limit() });
    }
  }

  onCopyPath(path: string): void {
    fpcCopyText(path);
  }

  // Server search (environment scope)

  onServerSearch(event?: Event): void {
    event?.preventDefault();

    const clientId = this.effectiveClientId();
    const agentId = this.agentId();
    const query = this.serverQuery().trim();

    if (!clientId || !agentId) {
      return;
    }

    if (!query) {
      this.graphsFacade.clearSearch();

      return;
    }

    this.graphsFacade.search(clientId, agentId, query, { layer: this.queryLayer(), limit: SERVER_SEARCH_LIMIT });
  }

  /** Picking a result ends the search: the query clears, so the result list gives way to the node details. */
  onSelectSearchHit(nodeId: string): void {
    this.onFilterChange('');
    this.graphsFacade.clearSearch();
    this.onSelectNode(nodeId);

    if (this.nodesById().has(nodeId)) {
      this.canvas()?.focusNode(nodeId);
    }
  }

  // Prompt references (references layer)

  onSelectPrompt(promptId: string): void {
    const clientId = this.effectiveClientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    this.selectedPromptId.set(promptId);
    this.referenceQueries.set({});
    this.graphsFacade.loadReferences(clientId, agentId, { promptId });

    const promptNodeId = this.findNodeId(`prompt:${promptId}`);

    if (promptNodeId) {
      this.onSelectNode(promptNodeId);
      this.canvas()?.focusNode(promptNodeId);
    }
  }

  onSelectReference(reference: AgentGraphPromptReference): void {
    const nodeId = this.findNodeId(reference.ref);

    if (nodeId) {
      this.onSelectNode(nodeId);
      this.canvas()?.focusNode(nodeId);
    }
  }

  onReferenceQueryChange(kind: AgentGraphReferenceKind, query: string): void {
    this.referenceQueries.update((queries) => ({ ...queries, [kind]: query }));
  }

  /** Reference name for people (tools by their readable name, environments by their name). */
  referenceLabel(reference: AgentGraphPromptReference): string {
    if (reference.type === 'tool') {
      return agentGraphToolLabel(reference.label);
    }

    return this.environmentName(reference.ref) ?? reference.label;
  }

  referenceInDocument(reference: AgentGraphPromptReference): boolean {
    return this.findNodeId(reference.ref) !== null;
  }

  referenceCount(kind: AgentGraphReferenceKind, counts: Record<AgentGraphReferenceKind, number>): number {
    return counts[kind] ?? 0;
  }

  // Workspace switcher

  /** @param pendingScope Scope to open once a workspace is picked (every opening resets it). */
  openWorkspaceSwitchModal(pendingScope: AgentGraphScope | null = null): void {
    this.pendingScope = pendingScope;
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    this.workspaceSwitchModalOpen.set(true);
  }

  goToSpaces(event?: Event): void {
    event?.preventDefault();
    this.workspaceSwitchModalOpen.set(false);
    void this.router.navigate(['/clients']);
  }

  onLoadMoreWorkspaces(): void {
    this.clientsFacade.loadMoreClients();
  }

  onSelectWorkspace(client: ClientResponseDto): void {
    const scope = this.pendingScope ?? this.scope();

    this.pendingScope = null;
    this.workspaceSwitchModalOpen.set(false);
    this.clientsFacade.setActiveClient(client.id);
    void this.router.navigate(['/graphs', client.id], {
      queryParams: { scope: scope === 'environment' ? null : scope },
    });
  }

  onDismissError(): void {
    this.graphsFacade.clearError();
  }

  /** Environment + node id the detail endpoint needs for a document node (scoped ids in workspace graphs). */
  private detailTarget(id: string | null): { agentId: string; nodeId: string } | null {
    if (!id) {
      return null;
    }

    if (this.scope() === 'environment') {
      const agentId = this.agentId();

      return agentId ? { agentId, nodeId: id } : null;
    }

    if (this.scope() === 'workspace' && this.layer() !== 'knowledge') {
      const parsed = parseScopedAgentGraphNodeId(id);

      return parsed ? { agentId: parsed.environmentId, nodeId: parsed.nodeId } : null;
    }

    return null;
  }

  /** Document id of an environment node id (scoped in workspace graphs); `null` when it is not loaded. */
  private findNodeId(nodeId: string): string | null {
    const nodes = this.nodesById();
    const agentId = this.agentId();

    if (nodes.has(nodeId)) {
      return nodeId;
    }

    const scoped = agentId ? scopeAgentGraphNodeId(agentId, nodeId) : null;

    return scoped && nodes.has(scoped) ? scoped : null;
  }

  private loadView(resetSelection = true): void {
    const clientId = this.effectiveClientId();
    const scope = this.scope();
    const layer = this.layer();
    const limit = this.limit();

    if (resetSelection) {
      this.selectedId.set(null);
      this.hiddenTypes.set(new Set());
      this.filterQuery.set('');
      this.serverQuery.set('');
      this.selectedPromptId.set(null);
      this.outgoingQuery.set('');
      this.incomingQuery.set('');
      this.promptQuery.set('');
      this.referenceQueries.set({});
      this.graphsFacade.clearNodeDetail();
      this.graphsFacade.clearSearch();
    }

    if (scope === 'global') {
      this.graphsFacade.loadGlobal(layer, { limit });
      this.graphsFacade.loadGlobalStatus();

      return;
    }

    if (!clientId) {
      return;
    }

    if (scope === 'workspace') {
      this.graphsFacade.loadWorkspace(clientId, layer, { limit });

      return;
    }

    const agentId = this.agentId();

    if (!agentId) {
      return;
    }

    this.graphsFacade.loadStatus(clientId, agentId);
    this.graphsFacade.loadDocument(clientId, agentId, this.queryLayer(), { limit });

    if (this.showReferences()) {
      this.graphsFacade.loadReferences(clientId, agentId);
    }
  }

  private navigateView(queryParams: Record<string, string | number | null>, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      ...(replaceUrl ? { replaceUrl: true } : {}),
    });
  }

  /** Name of an `environment:<id>` node from the workspace's environments (prompt references carry only the id). */
  private environmentName(nodeId: string): string | undefined {
    const parsed = parseScopedAgentGraphNodeId(nodeId);
    const id = (parsed?.nodeId ?? nodeId).startsWith('environment:') ? (parsed?.nodeId ?? nodeId).slice(12) : null;
    const agent = id ? this.agents().find((candidate) => candidate.id === id) : undefined;

    return agent ? resolveNamedDisplayLabel(agent.name) : undefined;
  }

  /** Relation rows of one direction, narrowed by the table's search (label, type, relation or path). */
  private relationRows(direction: 'outgoing' | 'incoming', query: string): AgentGraphRelationRow[] {
    const needle = query.trim().toLowerCase();

    return this.relations()
      .filter((relation) => relation.direction === direction)
      .map((relation) => ({
        ...relation,
        id: `${relation.direction}|${relation.edgeType}|${relation.targetId}`,
        typeLabel: relation.type ? agentGraphNodeTypeLabel(relation.type as AgentGraphNode['type']) : '',
        label:
          this.environmentName(relation.targetId) ??
          agentGraphNodeDisplayLabel({ type: relation.type, label: relation.label }),
        edgeLabel: agentGraphRelationLabel(relation.edgeType, relation.direction),
      }))
      .filter(
        (row) =>
          !needle ||
          [row.label, row.typeLabel, row.edgeLabel, row.path ?? '', row.targetId].some((value) =>
            value.toLowerCase().includes(needle),
          ),
      );
  }
}
