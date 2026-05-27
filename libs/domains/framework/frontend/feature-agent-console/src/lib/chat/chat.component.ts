import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AgentsFacade,
  AuthenticationFacade,
  ClientAgentAutonomyFacade,
  ClientsFacade,
  ContainerType,
  DeploymentsService,
  EnvFacade,
  FilesFacade,
  filterTicketsForTicketContextSuggestions,
  findPermittedTicketByExactSha,
  KnowledgeFacade,
  NotificationsFacade,
  SocketsFacade,
  StatsFacade,
  TicketAutomationFacade,
  TicketsFacade,
  WorkspaceConfigFacade,
  type AddClientUserDto,
  type AgentModelsMap,
  type AgentResponseDto,
  type AgentResponseObject,
  type ChatMessageData,
  type ClientAgentAutonomyResponseDto,
  type ClientAuthenticationType,
  type ClientResponseDto,
  type ClientUserResponseDto,
  type ClientUserRole,
  type ConfigResponseDto,
  type CreateAgentDto,
  type CreateClientDto,
  type CreateEnvironmentVariableDto,
  type CreateFileDto,
  type DeploymentRun,
  type EnvironmentVariableResponseDto,
  type FileManagerContext,
  type ForwardedEventPayload,
  type KnowledgeNodeDto,
  type ProvisionServerDto,
  type TicketAutomationRunChatEventPayload,
  type TicketResponseDto,
  type UpdateAgentDto,
  type UpdateClientDto,
  type UpdateEnvironmentVariableDto,
  type UpsertClientAgentAutonomyDto,
  type WorkspaceConfigurationSettingKey,
  type WorkspaceConfigurationSettingResponseDto,
  type WriteFileDto,
} from '@forepath/framework/frontend/data-access-agent-console';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import {
  catchError,
  combineLatest,
  combineLatestWith,
  delay,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  of,
  pairwise,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs';

import { DeploymentManagerComponent } from '../deployment-manager/deployment-manager.component';
import { ContainerStatsStatusBarComponent } from '../file-editor/container-stats-status-bar/container-stats-status-bar.component';
import { FileEditorComponent } from '../file-editor/file-editor.component';
import {
  getGitRepositoryDisplayLabel,
  isLocalGitRepository as isLocalGitRepositoryMode,
  parseGitRepository as parseGitRepositoryLabel,
  resolveGitRepositorySetupMode,
} from '../git-repository-display';
import { readAndClearAgentConsoleChatDraft } from '../tickets/chat-draft-storage';
import {
  ticketAutomationRunPhaseLabel as ticketAutomationRunPhaseLabelFn,
  ticketAutomationRunStatusLabel as ticketAutomationRunStatusLabelFn,
} from '../tickets/ticket-automation-run-labels';
import { ticketLaneStatusLabel } from '../tickets/ticket-lane-status-label';

import { mapForwardedChatEventsToDisplayRows } from './agent-chat-event-display';
import { AgentChatEventRowComponent } from './agent-chat-event-row.component';
import { formatAgentResponseForChatMarkdown, formatUnknownAsMarkdown } from './agent-chat-response-markdown';
import { accumulateStreamingTurnFromEvents } from './agent-chat-streaming-aggregate';
import { mergeTicketAutomationChatCardPayload } from './chat-automation-card-merge';
import { buildMergedChatDisplayThread, type ChatDisplayThreadItem } from './chat-thread-display';

// Type declaration for marked library
interface Marked {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

/** Labels for context chips next to the chat “Select context” control. */
interface ContextToolbarChip {
  readonly trackKey: string;
  readonly label: string;
  readonly title: string;
}

// Type for messages with filter results attached
type ChatMessageWithFilter = {
  event: string;
  payload: ForwardedEventPayload;
  timestamp: number;
  filterResult: {
    direction: 'incoming' | 'outgoing';
    status: 'allowed' | 'filtered' | 'dropped';
    matchedFilter?: {
      type: string;
      displayName: string;
      matched: boolean;
      reason?: string;
    };
  } | null;
};

@Component({
  selector: 'framework-agent-console-chat',
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    FileEditorComponent,
    DeploymentManagerComponent,
    ContainerStatsStatusBarComponent,
    AgentChatEventRowComponent,
  ],
  styleUrls: ['./chat.component.scss'],
  templateUrl: './chat.component.html',
  standalone: true,
})
export class AgentConsoleChatComponent implements OnInit, AfterViewChecked, OnDestroy {
  /** Board-parity labels for automation snapshot cards (same i18n as tickets board). */
  readonly ticketWorkflowLaneLabel = ticketLaneStatusLabel;
  readonly automationRunStatusLabel = ticketAutomationRunStatusLabelFn;
  readonly automationRunPhaseLabel = ticketAutomationRunPhaseLabelFn;

  readonly openTicketFromChatButtonLabel = $localize`:@@featureChat-openTicketFromAutomationCard:Open ticket`;

  readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly socketsFacade = inject(SocketsFacade);
  protected readonly notificationsFacade = inject(NotificationsFacade);
  private readonly statsFacade = inject(StatsFacade);
  private readonly ticketsFacade = inject(TicketsFacade);
  private readonly ticketAutomationFacade = inject(TicketAutomationFacade);
  private readonly filesFacade = inject(FilesFacade);
  private readonly envFacade = inject(EnvFacade);
  private readonly workspaceConfigFacade = inject(WorkspaceConfigFacade);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly autonomyFacade = inject(ClientAgentAutonomyFacade);
  private readonly deploymentsService = inject(DeploymentsService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);

  @ViewChild('chatMessagesContainer', { static: false })
  private chatMessagesContainer!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteClientModal', { static: false })
  private deleteClientModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteAgentModal', { static: false })
  private deleteAgentModal!: ElementRef<HTMLDivElement>;

  @ViewChild('addClientModal', { static: false })
  private addClientModal!: ElementRef<HTMLDivElement>;

  @ViewChild('addAgentModal', { static: false })
  private addAgentModal!: ElementRef<HTMLDivElement>;

  @ViewChild('updateClientModal', { static: false })
  private updateClientModal!: ElementRef<HTMLDivElement>;

  @ViewChild('updateAgentModal', { static: false })
  private updateAgentModal!: ElementRef<HTMLDivElement>;

  @ViewChild('environmentVariablesModal', { static: false })
  private environmentVariablesModal!: ElementRef<HTMLDivElement>;
  @ViewChild('workspaceConfigurationModal', { static: false })
  private workspaceConfigurationModal!: ElementRef<HTMLDivElement>;

  @ViewChild('ticketAutonomyModal', { static: false })
  private ticketAutonomyModal!: ElementRef<HTMLDivElement>;
  @ViewChild('contextSelectionModal', { static: false })
  private contextSelectionModal!: ElementRef<HTMLDivElement>;

  @ViewChild('clientUsersModal', { static: false })
  private clientUsersModal!: ElementRef<HTMLDivElement>;

  @ViewChild('fileEditor', { static: false })
  fileEditor!: FileEditorComponent;

  @ViewChild('deploymentManager', { static: false })
  deploymentManager!: DeploymentManagerComponent;

  @ViewChild('shareFileLinkButton', { static: false })
  shareFileLinkButton!: ElementRef<HTMLButtonElement>;

  private shareButtonTooltip: any = null;

  // Cache for marked instance to avoid repeated async imports
  private markedInstance: Marked | null = null;
  private markedLoadPromise: Promise<Marked> | null = null;

  /** Stable SafeHtml per markdown source so change detection does not rewrite innerHTML every tick. */
  private readonly markdownHtmlCache = new Map<string, SafeHtml>();
  private readonly commandBadgeHtmlCache = new Map<string, SafeHtml>();
  private static readonly MAX_HTML_CACHE_ENTRIES = 200;

  private trimHtmlCache(cache: Map<string, SafeHtml>): void {
    if (cache.size <= AgentConsoleChatComponent.MAX_HTML_CACHE_ENTRIES) {
      return;
    }

    const overflow = cache.size - AgentConsoleChatComponent.MAX_HTML_CACHE_ENTRIES;
    const keys = [...cache.keys()].slice(0, overflow);

    for (const key of keys) {
      cache.delete(key);
    }
  }

  // Cache for deployment status observables (key: `${clientId}:${agentId}`)
  private readonly deploymentStatusCache = new Map<
    string,
    Observable<{ status: string; icon: string; color: string } | null>
  >();

  // Search state
  readonly searchClientQuery = signal<string>('');
  readonly searchAgentQuery = signal<string>('');

  // Client list observables
  readonly searchClientQuery$ = toObservable(this.searchClientQuery);
  readonly clients$: Observable<ClientResponseDto[]> = this.clientsFacade.clients$.pipe(
    combineLatestWith(this.searchClientQuery$),
    map(([clients, searchQuery]) => {
      if (!searchQuery) {
        return clients;
      }

      return clients.filter((client) => JSON.stringify(client).toLowerCase().includes(searchQuery.toLowerCase()));
    }),
  );
  readonly activeClientId$: Observable<string | null> = this.clientsFacade.activeClientId$;
  readonly activeClient$: Observable<ClientResponseDto | null> = this.clientsFacade.activeClient$;
  readonly clientsLoading$: Observable<boolean> = combineLatest([
    this.clientsFacade.loading$,
    this.clientsFacade.clients$,
  ]).pipe(map(([loading, clients]) => loading && clients.length === 0));
  readonly clientsError$: Observable<string | null> = this.clientsFacade.error$;
  readonly clientsDeleting$: Observable<boolean> = this.clientsFacade.deleting$;
  readonly clientsCreating$: Observable<boolean> = this.clientsFacade.creating$;
  readonly clientsUpdating$: Observable<boolean> = this.clientsFacade.updating$;

  // Agent list observables (computed based on active client)
  readonly searchAgentQuery$ = toObservable(this.searchAgentQuery);
  readonly agents$: Observable<AgentResponseDto[]> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of([]);
      }

      return this.agentsFacade.getClientAgents$(clientId).pipe(
        combineLatestWith(this.searchAgentQuery$),
        map(([agents, searchQuery]) => {
          if (!searchQuery) {
            return agents;
          }

          return agents.filter((agent) => JSON.stringify(agent).toLowerCase().includes(searchQuery.toLowerCase()));
        }),
      );
    }),
  );
  readonly agentsLoading$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return combineLatest([
        this.agentsFacade.getClientAgentsLoading$(clientId),
        this.agentsFacade.getClientAgents$(clientId),
      ]).pipe(map(([loading, agents]) => loading && agents.length === 0));
    }),
  );
  readonly agentsDeleting$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.agentsFacade.getClientAgentsDeleting$(clientId);
    }),
  );
  readonly agentsCreating$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.agentsFacade.getClientAgentsCreating$(clientId);
    }),
  );
  readonly agentsUpdating$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.agentsFacade.getClientAgentsUpdating$(clientId);
    }),
  );
  readonly agentsStarting$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) return of(false);

      return this.agentsFacade.getClientAgentsStarting$(clientId);
    }),
  );
  readonly agentsStopping$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) return of(false);

      return this.agentsFacade.getClientAgentsStopping$(clientId);
    }),
  );
  readonly agentsRestarting$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) return of(false);

      return this.agentsFacade.getClientAgentsRestarting$(clientId);
    }),
  );
  readonly selectedAgent$: Observable<AgentResponseDto | null> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(null);
      }

      return this.agentsFacade.getSelectedClientAgent$(clientId);
    }),
  );

  // Commands observables (computed based on active client and selected agent)
  readonly commands$: Observable<string[]> = combineLatest([this.activeClientId$, this.selectedAgent$]).pipe(
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of([]);
      }

      return this.agentsFacade.getClientAgentCommands$(clientId, agent.id, agent.agentType);
    }),
  );
  readonly commandsLoading$: Observable<boolean> = combineLatest([this.activeClientId$, this.selectedAgent$]).pipe(
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of(false);
      }

      return this.agentsFacade.getClientAgentLoadingCommands$(clientId, agent.id);
    }),
  );

  /** Model dropdown: API list when loaded, otherwise static env fallback for the agent type. */
  readonly chatModelSelectOptions$: Observable<{ value: string; label: string }[]> = combineLatest([
    this.activeClientId$,
    this.selectedAgent$,
  ]).pipe(
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of([]);
      }

      return this.agentsFacade
        .getClientAgentModels$(clientId, agent.id)
        .pipe(map((models) => this.resolveChatModelOptions(agent.agentType, models)));
    }),
  );

  /**
   * Disable the model dropdown until the models request finishes (store has a map or an error).
   * New inner subscriptions start disabled until the first store emission (startWith).
   */
  readonly chatModelSelectDisabled$ = combineLatest([this.activeClientId$, this.selectedAgent$]).pipe(
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of(false);
      }

      return combineLatest([
        this.agentsFacade.getClientAgentModelsLoading$(clientId, agent.id),
        this.agentsFacade.getClientAgentModels$(clientId, agent.id),
        this.agentsFacade.getClientAgentModelsError$(clientId, agent.id),
      ]).pipe(
        map(([loading, models, err]) => loading || (models === null && err === null)),
        startWith(true),
      );
    }),
  );

  // Socket observables
  readonly socketConnected$: Observable<boolean> = this.socketsFacade.connected$;
  readonly socketConnecting$: Observable<boolean> = this.socketsFacade.connecting$;
  readonly socketDisconnecting$: Observable<boolean> = this.socketsFacade.disconnecting$;
  readonly socketReconnecting$: Observable<boolean> = this.socketsFacade.reconnecting$;
  readonly socketReconnectAttempts$: Observable<number> = this.socketsFacade.reconnectAttempts$;
  readonly selectedClientId$: Observable<string | null> = this.socketsFacade.selectedClientId$;
  readonly chatMessages$ = this.socketsFacade.getForwardedEventsByEvent$('chatMessage');
  readonly chatEvents$ = this.socketsFacade.getForwardedEventsByEvent$('chatEvent');
  readonly messageFilterResults$ = this.socketsFacade.messageFilterResults$;

  readonly recentChatEventRows$ = this.chatEvents$.pipe(
    map((events) => mapForwardedChatEventsToDisplayRows(events.slice(-50))),
  );

  // Combine chat messages with filter results for efficient template access
  readonly chatMessagesWithFilters$: Observable<ChatMessageWithFilter[]> = combineLatest([
    this.chatMessages$,
    this.messageFilterResults$.pipe(
      distinctUntilChanged((prev, curr) => {
        if (prev.length !== curr.length) {
          return false;
        }

        return prev.every(
          (row, i) =>
            row.timestamp === curr[i]?.timestamp &&
            row.receivedAt === curr[i]?.receivedAt &&
            row.status === curr[i]?.status &&
            row.direction === curr[i]?.direction &&
            row.message === curr[i]?.message,
        );
      }),
    ),
  ]).pipe(
    map(([messages, filterResults]) =>
      messages.map((msg) => {
        const messageData = this.getChatMessageData(msg.payload);
        // Extract timestamp from message data (ISO string) and convert to number for matching
        // Use the original message timestamp, not the received timestamp
        const messageTimestamp = messageData?.timestamp ? new Date(messageData.timestamp).getTime() : msg.timestamp; // Fallback to received timestamp if not available

        return {
          ...msg,
          filterResult: messageData
            ? this.getFilterResultForMessage(messageData, messageTimestamp, filterResults)
            : null,
        } as ChatMessageWithFilter;
      }),
    ),
    distinctUntilChanged((prev, curr) => this.chatMessagesWithFilterViewEqual(prev, curr)),
  );

  /** User rows, agent turns, and ticket automation run cards merged by semantic timeline order. */
  readonly displayChatThread$ = combineLatest([
    this.socketsFacade.chatTimelineOrdered$,
    this.chatMessagesWithFilters$,
    this.ticketsFacade.tickets$,
    this.ticketAutomationFacade.runCacheByRunId$,
  ]).pipe(
    map(([ordered, filtered, tickets, runCache]) => {
      const thread = buildMergedChatDisplayThread(ordered, filtered);
      const ticketsById = new Map(tickets.map((t) => [t.id, t]));

      return thread.map((item) => {
        if (item.kind !== 'ticketAutomationRun') {
          return item;
        }

        const liveTicket = ticketsById.get(item.payload.ticket.id);
        const cachedRun = runCache[item.payload.run.id];
        const payload = mergeTicketAutomationChatCardPayload(item.payload, liveTicket, cachedRun);

        return payload === item.payload ? item : { ...item, payload };
      });
    }),
  );

  readonly forwarding$: Observable<boolean> = this.socketsFacade.chatForwarding$;
  readonly chatResponseMode$ = this.socketsFacade.chatResponseMode$;
  readonly chatEnhancementPending$: Observable<boolean> = this.socketsFacade.chatEnhancementPending$;
  readonly socketError$: Observable<string | null> = this.socketsFacade.error$;

  // Remote connection reconnection state (per clientId)
  readonly remoteReconnecting$: Observable<boolean> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.socketsFacade.isRemoteReconnecting$(clientId);
    }),
  );
  readonly remoteConnectionError$: Observable<string | null> = this.activeClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(null);
      }

      return this.socketsFacade.getRemoteConnectionError$(clientId);
    }),
  );

  // Local state
  chatMessage = signal<string>('');
  /** Shown when prompt enhancement fails (success clears it). */
  readonly enhanceErrorMessage = signal<string | null>(null);
  selectedChatModel = signal<string | null>('auto');
  selectedCommand = signal<string | null>(null);
  selectedAgentId = signal<string | null>(null);
  includeWorkspaceContext = signal<boolean>(true);
  autoEnrichmentEnabled = signal<boolean>(true);
  selectedEnvironmentContextIds = signal<string[]>([]);
  selectedTicketContextShas = signal<string[]>([]);
  selectedKnowledgeContextShas = signal<string[]>([]);
  ticketContextInput = signal<string>('');
  ticketContextInputError = signal<string | null>(null);
  knowledgeContextInput = signal<string>('');
  knowledgeContextInputError = signal<string | null>(null);
  /** Keeps suggestion menu open while interacting (blur closes with delay for mousedown). */
  ticketContextSuggestionsOpen = signal<boolean>(false);
  knowledgeContextSuggestionsOpen = signal<boolean>(false);
  editorOpen = signal<boolean>(false);
  /** Active file editor API root from the current route (`/editor` vs `/config`). */
  fileManagerContext = signal<FileManagerContext>('app');
  deploymentManagerOpen = signal<boolean>(false);
  chatVisible = signal<boolean>(false);
  gatewayVisible = signal<boolean>(false);
  private previousAgentId: string | null = null;
  readonly fileOnlyMode = signal<boolean>(false);
  readonly standaloneMode = signal<boolean>(false);
  private standaloneFileLoaded = false;
  readonly showSSHCommand = signal<boolean>(false);

  // Local signals to mirror fileEditor's visibility states
  // These prevent ExpressionChangedAfterItHasBeenCheckedError by avoiding direct access
  readonly fileTreeVisible = signal<boolean>(false);
  readonly terminalVisible = signal<boolean>(false);
  readonly gitManagerVisible = signal<boolean>(false);
  readonly selectedFilePathForShare = signal<string | null>(null);

  // Convert signals to observables (must be in field initializer for injection context)
  private readonly standaloneMode$ = toObservable(this.standaloneMode);
  private readonly fileManagerContext$ = toObservable(this.fileManagerContext);
  private readonly ticketsSnapshot = toSignal(this.ticketsFacade.tickets$, {
    initialValue: [] as TicketResponseDto[],
  });
  private readonly knowledgeTreeSnapshot = toSignal(this.knowledgeFacade.tree$, {
    initialValue: [] as KnowledgeNodeDto[],
  });

  private readonly activeClientIdSignal = toSignal(this.clientsFacade.activeClientId$, {
    initialValue: null as string | null,
  });

  private readonly activeClientSignal = toSignal(this.activeClient$, {
    initialValue: null as ClientResponseDto | null,
  });

  /** Tickets the user may use as chat context: current board only, with SHA materialized. */
  readonly ticketContextPermittedTickets = computed(() => {
    const clientId = this.activeClientIdSignal();

    if (!clientId) {
      return [] as TicketResponseDto[];
    }

    return (this.ticketsSnapshot() ?? []).filter((row) => row.clientId === clientId && !!row.shas?.long);
  });

  readonly ticketContextSuggestions = computed(() =>
    filterTicketsForTicketContextSuggestions(this.ticketContextPermittedTickets(), this.ticketContextInput(), {
      limit: 20,
    }),
  );

  private flattenKnowledgeTree(nodes: KnowledgeNodeDto[]): KnowledgeNodeDto[] {
    const out: KnowledgeNodeDto[] = [];
    const walk = (items: KnowledgeNodeDto[]) => {
      for (const node of items) {
        out.push(node);

        if (node.children?.length) {
          walk(node.children);
        }
      }
    };

    walk(nodes);

    return out;
  }

  readonly knowledgeContextPermittedNodes = computed(() => {
    const clientId = this.activeClientIdSignal();

    if (!clientId) {
      return [] as KnowledgeNodeDto[];
    }

    return this.flattenKnowledgeTree(this.knowledgeTreeSnapshot() ?? []).filter(
      (row) => row.clientId === clientId && !!row.shas?.long,
    );
  });

  readonly knowledgeContextSuggestions = computed(() => {
    const q = this.knowledgeContextInput().trim().toLowerCase();
    const rows = this.knowledgeContextPermittedNodes();

    if (!q) {
      return rows.slice(0, 20);
    }

    return rows
      .filter((row) => {
        const title = row.title?.toLowerCase() ?? '';
        const shortSha = row.shas?.short?.toLowerCase() ?? '';
        const longSha = row.shas?.long?.toLowerCase() ?? '';

        return title.includes(q) || shortSha.startsWith(q) || longSha.startsWith(q);
      })
      .slice(0, 20);
  });

  private readonly agentsSnapshot = toSignal(this.agents$, {
    initialValue: [] as AgentResponseDto[],
  });

  readonly contextSelectionToolbarChips = computed((): ContextToolbarChip[] => {
    const chips: ContextToolbarChip[] = [];

    if (this.includeWorkspaceContext()) {
      chips.push({
        trackKey: 'workspace',
        label: $localize`:@@featureChat-contextToolbarWorkspace:Workspace`,
        title: $localize`:@@featureChat-contextToolbarWorkspaceTitle:Include workspace files and metadata`,
      });
    }

    const agents = this.agentsSnapshot() ?? [];
    const byId = new Map(agents.map((a) => [a.id, a]));

    for (const rawId of this.selectedEnvironmentContextIds()) {
      const id = rawId.trim();

      if (!id) {
        continue;
      }

      const agent = byId.get(id);
      const name = agent?.name?.trim() ? agent.name.trim() : id;

      chips.push({
        trackKey: `env:${id}`,
        label: name,
        title: agent
          ? $localize`:@@featureChat-contextToolbarEnvTitle:Environment context: ${agent.name}:agentName:`
          : $localize`:@@featureChat-contextToolbarEnvUnknownTitle:Environment: ${id}:agentId:`,
      });
    }

    for (const rawSha of this.selectedTicketContextShas()) {
      const longSha = rawSha.trim();

      if (!longSha) {
        continue;
      }

      const display = this.ticketContextChipDisplay(longSha);

      chips.push({
        trackKey: `ticket:${longSha}`,
        label: display,
        title: display,
      });
    }

    for (const rawSha of this.selectedKnowledgeContextShas()) {
      const longSha = rawSha.trim();

      if (!longSha) {
        continue;
      }

      const display = this.knowledgeContextChipDisplay(longSha);

      chips.push({
        trackKey: `knowledge:${longSha}`,
        label: display,
        title: display,
      });
    }

    return chips;
  });

  // Expose ContainerType enum for template use
  readonly ContainerType = ContainerType;

  // Computed observable to determine if chat should be visible
  readonly shouldShowChat$ = combineLatest([
    this.selectedAgent$,
    toObservable(this.editorOpen),
    toObservable(this.deploymentManagerOpen),
    toObservable(this.chatVisible),
  ]).pipe(
    map(([selectedAgent, editorOpen, deploymentManagerOpen, chatVisible]) => {
      if (!selectedAgent || selectedAgent.agentType === 'openclaw') {
        return false;
      }

      const sidePanelOpen = deploymentManagerOpen;

      return (!editorOpen && !sidePanelOpen) || chatVisible;
    }),
  );

  // Computed observable to determine if chat should be visible
  readonly shouldShowGateway$ = combineLatest([
    this.selectedAgent$,
    toObservable(this.editorOpen),
    toObservable(this.deploymentManagerOpen),
    toObservable(this.gatewayVisible),
  ]).pipe(
    map(([selectedAgent, editorOpen, deploymentManagerOpen, gatewayVisible]) => {
      if (!selectedAgent) {
        return false;
      }

      const sidePanelOpen = deploymentManagerOpen;

      return ((!editorOpen && !sidePanelOpen) || gatewayVisible) && selectedAgent.agentType === 'openclaw';
    }),
  );

  readonly getClientAttentionBadge$ = (clientId: string) => this.notificationsFacade.getClientAttentionBadge$(clientId);

  readonly getEnvironmentAttentionBadge$ = (clientId: string, agentId: string) =>
    this.notificationsFacade.getEnvironmentAttentionBadge$(clientId, agentId);

  readonly selectedEnvironmentGitDirty$ = combineLatest([this.activeClientId$, this.selectedAgent$]).pipe(
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent?.id) {
        return of(false);
      }

      return this.notificationsFacade.getEnvironmentGitDirty$(clientId, agent.id);
    }),
  );

  /** Path for OpenClaw config file in the container (relative to agent base path). */
  private static readonly OPENCLAW_CONFIG_PATH = '.openclaw/openclaw.json';

  /** Path for OpenClaw config directory. */
  private static readonly OPENCLAW_CONFIG_DIR = '.openclaw';

  /**
   * True when .openclaw/openclaw.json exists in the selected openclaw agent's container.
   * Triggers a directory list when the gateway is shown for an openclaw agent.
   */
  readonly openclawConfigExists$: Observable<boolean> = combineLatest([this.activeClientId$, this.selectedAgent$]).pipe(
    filter(([clientId, agent]) => !!clientId && !!agent && agent.agentType === 'openclaw'),
    tap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return;
      }

      this.filesFacade.listDirectory(clientId, agent.id, { path: AgentConsoleChatComponent.OPENCLAW_CONFIG_DIR });
    }),
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of([]);
      }

      return this.filesFacade.getDirectoryListing$(clientId, agent.id, AgentConsoleChatComponent.OPENCLAW_CONFIG_DIR);
    }),
    map((nodes) => nodes?.some((n) => n.name === 'openclaw.json' && n.type === 'file') ?? false),
    startWith(false),
    shareReplay(1),
  );

  /** True while the OpenClaw config file is being written. */
  readonly isWritingOpenClawConfig$: Observable<boolean> = combineLatest([
    this.activeClientId$,
    this.selectedAgent$,
  ]).pipe(
    filter(([clientId, agent]) => !!clientId && !!agent && agent.agentType === 'openclaw'),
    switchMap(([clientId, agent]) => {
      if (!clientId || !agent) {
        return of(false);
      }

      return this.filesFacade.isWritingFile$(clientId, agent.id, AgentConsoleChatComponent.OPENCLAW_CONFIG_PATH);
    }),
    startWith(false),
    shareReplay(1),
  );

  /**
   * Set on send until the echoed user `chatMessage` exists in the store; drives waiting/streaming UI.
   */
  private lastUserMessageTimestamp = signal<number | null>(null);
  private readonly lastUserMessageTimestamp$ = toObservable(this.lastUserMessageTimestamp);

  // Computed signal to determine if we're waiting for an agent response
  // Works across windows by checking chat messages rather than just forwarding state
  readonly waitingForResponse$ = combineLatest([
    this.chatMessages$,
    this.socketError$,
    this.lastUserMessageTimestamp$,
  ]).pipe(
    map(([messages, error, sentFallbackTs]) => {
      if (error) {
        this.lastUserMessageTimestamp.set(null);

        return false;
      }

      const { lastUserTs, hasAgentMessageAfter } = this.deriveLastUserAndAgentComplete(messages, sentFallbackTs);

      if (!lastUserTs) {
        return false;
      }

      if (hasAgentMessageAfter) {
        this.lastUserMessageTimestamp.set(null);

        return false;
      }

      return true;
    }),
  );

  /** Live fold of `chatEvent` frames for the in-flight turn (hidden once final agent `chatMessage` arrives). */
  readonly streamingAssistantState$ = combineLatest([
    this.chatMessages$,
    this.chatEvents$,
    this.lastUserMessageTimestamp$,
  ]).pipe(
    map(([messages, events, sentFallbackTs]) => {
      const { lastUserTs, hasAgentMessageAfter } = this.deriveLastUserAndAgentComplete(messages, sentFallbackTs);

      if (!lastUserTs || hasAgentMessageAfter) {
        return null;
      }

      const streamBaseline = this.deriveStreamingChatEventBaselineMs(messages, sentFallbackTs);

      if (streamBaseline == null) {
        return null;
      }

      return accumulateStreamingTurnFromEvents(events, streamBaseline);
    }),
  );

  /** Bottom-of-thread: in-flight agent bubble (empty or streamed content) until final `chatMessage`. */
  readonly chatPendingUi$ = combineLatest([this.waitingForResponse$, this.streamingAssistantState$]).pipe(
    map(([waiting, stream]) => ({
      isPendingAgentResponse: waiting,
      stream: waiting ? stream : null,
    })),
  );

  private activeClientId: string | null = null;
  private shouldScrollToBottom = false;
  private previousMessageCount = 0;
  /** Tracks merged chat thread rows (messages + automation cards); grows when hydration adds cards without new `chatMessage` events. */
  private previousDisplayThreadLength = 0;
  private readonly destroyRef = inject(DestroyRef);
  private syncAnimationFrameId: number | null = null;
  private syncTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastAgentMessageTimestamp = 0;

  // Delete state
  readonly clientToDeleteId = signal<string | null>(null);
  readonly clientToDeleteName = signal<string>('');
  readonly clientToDeleteHasProvisioning = signal<boolean>(false);
  readonly agentToDeleteId = signal<string | null>(null);
  readonly agentToDeleteName = signal<string>('');

  // Add state
  readonly newClient = signal<Partial<CreateClientDto>>({
    name: '',
    description: '',
    endpoint: '',
    authenticationType: undefined,
    apiKey: undefined,
    keycloakClientId: undefined,
    keycloakClientSecret: undefined,
    keycloakRealm: undefined,
    agentWsPort: undefined,
  });

  // Provisioning state
  readonly useProvisioning = signal<boolean>(false);
  readonly selectedProvider = signal<string>('');
  readonly selectedServerType = signal<string>('');
  readonly selectedLocation = signal<string>('');
  readonly provisioningProviders$ = this.clientsFacade.provisioningProviders$;
  readonly loadingProviders$ = this.clientsFacade.loadingProviders$;
  readonly provisioning$ = this.clientsFacade.provisioning$;

  // Computed observables for server types based on selected provider
  readonly serverTypes$ = toObservable(this.selectedProvider).pipe(
    switchMap((providerType) => {
      if (!providerType) {
        return of([]);
      }

      return this.clientsFacade.getServerTypes$(providerType);
    }),
  );

  readonly loadingServerTypes$ = toObservable(this.selectedProvider).pipe(
    switchMap((providerType) => {
      if (!providerType) {
        return of(false);
      }

      return this.clientsFacade.getLoadingServerTypes$(providerType);
    }),
  );
  readonly newAgent = signal<Partial<CreateAgentDto>>({
    name: '',
    description: '',
    agentType: undefined,
    containerType: undefined,
    gitRepositorySetupMode: 'clone',
    gitRepositoryUrl: undefined,
    createVirtualWorkspace: false,
    createSshConnection: false,
  });

  // Edit state
  readonly editingClientId = signal<string | null>(null);
  readonly editingClient = signal<Partial<UpdateClientDto & { authenticationType?: ClientAuthenticationType | '' }>>({
    name: '',
    description: '',
    endpoint: '',
    authenticationType: undefined,
    apiKey: undefined,
    keycloakClientId: undefined,
    keycloakClientSecret: undefined,
    keycloakRealm: undefined,
    agentWsPort: undefined,
  });
  readonly editingAgentId = signal<string | null>(null);
  readonly editingAgent = signal<Partial<UpdateAgentDto>>({
    name: '',
    description: '',
    containerType: undefined,
  });

  // Environment variables state
  readonly editingEnvVarId = signal<string | null>(null);
  readonly editingEnvVarValue = signal<string>('');
  readonly managingEnvVarsAgentId = signal<string | null>(null);
  readonly newEnvVar = signal<CreateEnvironmentVariableDto>({
    variable: '',
    content: '',
  });

  /** Agent whose prototype autonomy modal is open (null when closed). */
  readonly managingTicketAutonomyAgentId = signal<string | null>(null);
  readonly ticketAutonomyDraftEnabled = signal(false);
  readonly ticketAutonomyDraftPreImprove = signal(false);
  readonly ticketAutonomyDraftMaxRuntimeMs = signal(3_600_000);
  readonly ticketAutonomyDraftMaxIterations = signal(25);
  /** Empty string means null token budget. */
  readonly ticketAutonomyDraftTokenBudgetText = signal('');
  readonly autonomyRow = toSignal(this.autonomyFacade.autonomy$, { initialValue: null });
  readonly autonomyLoading = toSignal(this.autonomyFacade.loading$, { initialValue: false });
  readonly autonomySaving = toSignal(this.autonomyFacade.saving$, { initialValue: false });
  readonly autonomyError = toSignal(this.autonomyFacade.error$, { initialValue: null });

  // Environment variables observables (computed based on active client and managing agent)
  readonly managingEnvVarsAgentId$ = toObservable(this.managingEnvVarsAgentId);
  readonly environmentVariables$: Observable<EnvironmentVariableResponseDto[]> = combineLatest([
    this.activeClientId$,
    this.managingEnvVarsAgentId$,
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of([]);
      }

      return this.envFacade.getEnvironmentVariables$(clientId, agentId).pipe(map((envVars) => envVars || []));
    }),
  );
  readonly environmentVariablesLoading$: Observable<boolean> = combineLatest([
    this.activeClientId$,
    this.managingEnvVarsAgentId$,
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of(false);
      }

      return this.envFacade.isLoadingEnvironmentVariables$(clientId, agentId);
    }),
  );
  readonly environmentVariablesCreating$: Observable<boolean> = combineLatest([
    this.activeClientId$,
    this.managingEnvVarsAgentId$,
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of(false);
      }

      return this.envFacade.isCreatingEnvironmentVariable$(clientId, agentId);
    }),
  );
  readonly environmentVariablesError$: Observable<string | null> = combineLatest([
    this.activeClientId$,
    this.managingEnvVarsAgentId$,
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of(null);
      }

      return this.envFacade.getEnvError$(clientId, agentId);
    }),
  );

  readonly managingWorkspaceConfigurationClientId = signal<string | null>(null);
  readonly managingWorkspaceConfigurationClient = signal<ClientResponseDto | null>(null);
  readonly editingWorkspaceConfigurationValues = signal<Partial<Record<WorkspaceConfigurationSettingKey, string>>>({});
  /** Workspace configuration overrides for the active client (used for git display). */
  readonly activeWorkspaceSettings = signal<WorkspaceConfigurationSettingResponseDto[]>([]);
  readonly managingWorkspaceConfigurationClientId$ = toObservable(this.managingWorkspaceConfigurationClientId);
  readonly workspaceConfigurationSettings$: Observable<WorkspaceConfigurationSettingResponseDto[]> =
    this.managingWorkspaceConfigurationClientId$.pipe(
      switchMap((clientId) => {
        if (!clientId) {
          return of([]);
        }

        return this.workspaceConfigFacade.getSettings$(clientId);
      }),
    );
  readonly workspaceConfigurationLoading$: Observable<boolean> = this.managingWorkspaceConfigurationClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.workspaceConfigFacade.getLoading$(clientId);
    }),
  );
  readonly workspaceConfigurationError$: Observable<string | null> = this.managingWorkspaceConfigurationClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(null);
      }

      return this.workspaceConfigFacade.getError$(clientId);
    }),
  );
  readonly workspaceConfigurationMutating$: Observable<boolean> = this.managingWorkspaceConfigurationClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.workspaceConfigFacade.isMutationInProgress$(clientId);
    }),
  );

  // Client users modal state (for managing workspace users)
  readonly managingClientUsersClientId = signal<string | null>(null);
  readonly newClientUser = signal<AddClientUserDto>({
    email: '',
    role: 'user' as ClientUserRole,
  });

  readonly managingClientUsersClientId$ = toObservable(this.managingClientUsersClientId);
  readonly clientUsers$: Observable<ClientUserResponseDto[]> = this.managingClientUsersClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of([]);
      }

      return this.clientsFacade.getClientUsers$(clientId).pipe(map((users) => users ?? []));
    }),
  );
  readonly clientUsersLoading$: Observable<boolean> = this.managingClientUsersClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.clientsFacade.getLoadingClientUsers$(clientId);
    }),
  );
  readonly clientUsersAdding$: Observable<boolean> = this.managingClientUsersClientId$.pipe(
    switchMap((clientId) => {
      if (!clientId) {
        return of(false);
      }

      return this.clientsFacade.getAddingClientUser$(clientId);
    }),
  );
  readonly clientUsersError$: Observable<string | null> = this.clientsFacade.error$;

  /**
   * Permissions for the client users modal, inferred from the loaded users list.
   * - User not in list (or no auth user): super admin → can add any role, remove anyone
   * - User in list with role 'admin': client admin → can add only 'user' role, remove only users
   * - User in list with role 'user': client user → cannot add or remove
   */
  readonly clientUsersModalPermissions$: Observable<{
    canAddUser: boolean;
    canAddAdminRole: boolean;
    canRemoveUser: (user: ClientUserResponseDto) => boolean;
  }> = combineLatest([this.clientUsers$, this.clientUsersLoading$, this.authFacade.user$]).pipe(
    map(([users, loading, currentUser]) => {
      if (loading) {
        return { canAddUser: false, canAddAdminRole: false, canRemoveUser: () => false };
      }

      const currentUserInList =
        currentUser &&
        users.find(
          (u) =>
            u.userId === currentUser.id ||
            (u.userEmail && currentUser.email && u.userEmail.toLowerCase() === currentUser.email.toLowerCase()),
        );

      if (!currentUserInList || !currentUser) {
        return {
          canAddUser: true,
          canAddAdminRole: true,
          canRemoveUser: () => true,
        };
      }

      if (currentUserInList.role === 'admin') {
        return {
          canAddUser: true,
          canAddAdminRole: false,
          canRemoveUser: (user: ClientUserResponseDto) => user.role === 'user',
        };
      }

      return {
        canAddUser: false,
        canAddAdminRole: false,
        canRemoveUser: () => false,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private initialRouting: Record<string, boolean> = {
    client: false,
    agent: false,
    editor: false,
    deployments: false,
  };
  private fileOpenedFromQuery = false;

  /**
   * Check if the current viewport is mobile (width <= 767.98px)
   */
  private isMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 767.98;
  }

  constructor() {
    effect(() => {
      const agentId = this.managingTicketAutonomyAgentId();
      const clientId = this.activeClientId;

      if (clientId && agentId) {
        this.autonomyFacade.load(clientId, agentId);
      }
    });
    effect(() => {
      if (!this.managingTicketAutonomyAgentId()) {
        return;
      }

      const row = this.autonomyRow();

      if (row) {
        this.applyTicketAutonomyDraftFromRow(row);
      }
    });
  }

  ngOnInit(): void {
    this.fileManagerContext.set(this.router.url.includes('/config') ? 'config' : 'app');

    // Default chat model to auto mode on load
    this.socketsFacade.setChatModel(null);

    this.socketsFacade.chatEnhancementLastResult$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((r) => r !== null),
      )
      .subscribe((r) => {
        if (!r) {
          return;
        }

        if (r.success && r.enhancedText !== undefined) {
          this.chatMessage.set(r.enhancedText);
          this.enhanceErrorMessage.set(null);
        } else {
          this.enhanceErrorMessage.set(r.errorMessage ?? 'Enhancement failed');
        }
      });

    // Load clients on init only when not already cached (avoids spinner on route reuse)
    this.clientsFacade.hasClients$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((hasClients) => {
      if (!hasClients) {
        this.clientsFacade.loadClients();
      }
    });

    // Sync local active client from store when component is recreated
    this.activeClientId$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((clientId) => {
      if (clientId) {
        this.activeClientId = clientId;
      }
    });

    this.activeClientId$
      .pipe(
        switchMap((clientId) => {
          this.activeWorkspaceSettings.set([]);

          if (!clientId) {
            return of([] as WorkspaceConfigurationSettingResponseDto[]);
          }

          this.workspaceConfigFacade.loadSettings(clientId);

          return this.workspaceConfigFacade.getSettings$(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((settings) => this.activeWorkspaceSettings.set(settings));

    // Load provider model catalog when client + selected agent are set (includes deep-link and reducer-driven selection).
    combineLatest([this.activeClientId$, this.selectedAgent$])
      .pipe(
        filter(([clientId, agent]) => !!clientId && !!agent),
        distinctUntilChanged((prev, curr) => prev[0] === curr[0] && prev[1]?.id === curr[1]?.id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([clientId, agent]) => {
        if (!clientId || !agent) {
          return;
        }

        this.agentsFacade.loadClientAgentModels(clientId, agent.id);
      });

    // If the API model list does not include the current selection, fall back to Auto.
    combineLatest([this.activeClientId$, this.selectedAgent$])
      .pipe(
        switchMap(([clientId, agent]) => {
          if (!clientId || !agent) {
            return of(null);
          }

          return this.agentsFacade.getClientAgentModels$(clientId, agent.id);
        }),
        filter((models): models is AgentModelsMap => models !== null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((models) => {
        const current = this.selectedChatModel();

        if (current && current !== 'auto' && !(current in models)) {
          this.onChatModelChange('auto');
        }
      });

    // Load provisioning providers on init (needed for displaying provider names)
    this.clientsFacade.loadProvisioningProviders();

    // Preload serverInfo for all clients to show provisioning provider names
    this.clients$
      .pipe(
        filter((clients) => clients.length > 0),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((clients) => {
        // Load serverInfo for each client (will fail silently if no provisioning exists)
        clients.forEach((client) => {
          this.clientsFacade.loadServerInfo(client.id);
        });
      });

    // Preload deployment status for all agents when agents list loads successfully
    combineLatest([this.activeClientId$, this.agents$])
      .pipe(
        filter(([clientId, agents]) => !!clientId && agents.length > 0),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([clientId, agents]) => {
        // Trigger status loading for each agent (will be loaded on-demand via getAgentDeploymentStatus$)
        // The observable will handle caching and will only load once per agent
        if (clientId) {
          agents.forEach((agent) => {
            // Just subscribe to trigger the load, but don't keep the subscription
            // The template will handle the actual display
            this.getAgentDeploymentStatus$(clientId, agent.id).pipe(take(1)).subscribe();
          });
        }
      });

    this.route.params
      .pipe(
        combineLatestWith(this.clients$, this.agents$),
        withLatestFrom(this.route.queryParams),
        takeUntilDestroyed(this.destroyRef),
        delay(0),
      )
      .subscribe(([[params, clients, agents], queryParams]) => {
        // Select client from route params (only on initial load)
        if (!this.initialRouting['client'] && clients.length > 0) {
          const clientId = params['clientId'];

          if (clientId) {
            // Only select if not already selected to avoid race conditions
            if (this.activeClientId !== clientId) {
              this.onClientSelect(clientId, false);
            }

            this.initialRouting['client'] = true;
          }
        }

        // Select agent from route params (only on initial load)
        if (!this.initialRouting['agent'] && agents.length > 0) {
          const agentId = params['agentId'];

          if (agentId) {
            // Only select if not already selected to avoid race conditions
            const currentAgentId = this.selectedAgentId();

            if (currentAgentId !== agentId) {
              this.onAgentSelect(agentId, false);
            }

            this.initialRouting['agent'] = true;
          }
        }

        // Select editor from route params (workspace editor or provider config editor)
        if (
          !this.initialRouting['editor'] &&
          agents.length > 0 &&
          (this.router.url.includes('/editor') || this.router.url.includes('/config')) &&
          !this.editorOpen()
        ) {
          // Check if file query parameter is set
          const filePath = queryParams['file'];
          const isFileOnlyMode = !!filePath;

          this.fileOnlyMode.set(isFileOnlyMode);

          // Check if standalone query parameter is set
          const isStandaloneMode = !!queryParams['standalone'];

          this.standaloneMode.set(isStandaloneMode);

          if (isStandaloneMode && isFileOnlyMode) {
            // Loading spinner is shown by container component
            this.standaloneFileLoaded = false;
          }

          // Open editor if route has /editor but editor is closed
          this.editorOpen.set(true);

          if (isFileOnlyMode) {
            // Hide file tree and chat by default in file-only mode
            this.chatVisible.set(false);

            if (this.fileEditor) {
              this.fileEditor.fileTreeVisible.set(false);
              this.fileEditor.terminalVisible.set(false);
              this.fileEditor.autosaveEnabled.set(false);
            }
          } else {
            // Normal editor mode
            // Only show chat and file tree on desktop, hide on mobile by default
            if (!this.isMobile()) {
              this.chatVisible.set(true);

              if (this.fileEditor) {
                this.fileEditor.fileTreeVisible.set(true);
              }
            }

            if (this.fileEditor) {
              this.fileEditor.terminalVisible.set(false);
              this.fileEditor.autosaveEnabled.set(false);
            }
          }

          // Sync visibility signals after editor opens
          setTimeout(() => this.syncFileEditorVisibility(), 0);

          this.initialRouting['editor'] = true;

          // Open file if file query parameter is set
          if (isFileOnlyMode && filePath) {
            // Decode the file path (in case it's URL encoded)
            // Use try-catch to handle cases where path is already decoded
            let decodedFilePath: string;

            try {
              decodedFilePath = decodeURIComponent(filePath);
            } catch {
              decodedFilePath = filePath;
            }

            this.openFileWhenReady(decodedFilePath);
          }
        }

        // Select deployment manager from route params
        if (
          !this.initialRouting['deployments'] &&
          agents.length > 0 &&
          this.router.url.includes('/deployments') &&
          !this.deploymentManagerOpen()
        ) {
          // Check if standalone query parameter is set
          const isStandaloneMode = !!queryParams['standalone'];

          this.standaloneMode.set(isStandaloneMode);

          // Note: run query parameter is handled by the deployment manager component itself

          // Close editor if opening deployment manager (unless in standalone mode)
          if (!isStandaloneMode && this.editorOpen()) {
            this.editorOpen.set(false);
          }

          // Open deployment manager if route has /deployments but manager is closed
          this.deploymentManagerOpen.set(true);

          // Clear standalone loading when deployment manager is opened via route
          this.standaloneLoadingService.setLoading(false);

          // In standalone mode, hide chat and other panels
          if (isStandaloneMode) {
            this.chatVisible.set(false);
          }

          // Hide chat on mobile when deployment manager is open
          if (this.isMobile()) {
            this.chatVisible.set(false);
          }

          this.initialRouting['deployments'] = true;
        }
      });

    // Subscribe to query parameter changes to handle file-only mode (only for updates after initial load)
    // Use skip(1) to skip the first emission which is handled in initial routing
    this.route.queryParams
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        skip(1), // Skip first emission (handled in initial routing)
      )
      .subscribe((queryParams) => {
        const filePath = queryParams['file'];
        const isFileOnlyMode = !!filePath;

        this.fileOnlyMode.set(isFileOnlyMode);

        // Check if standalone query parameter is set
        const isStandaloneMode = !!queryParams['standalone'];

        this.standaloneMode.set(isStandaloneMode);

        // If file query parameter is set and editor is open, open the file
        if (isFileOnlyMode && filePath && this.editorOpen()) {
          // Decode the file path (in case it's URL encoded)
          let decodedFilePath: string;

          try {
            decodedFilePath = decodeURIComponent(filePath);
          } catch {
            decodedFilePath = filePath;
          }

          // Only open if it's a different file and we haven't already opened it
          if (this.fileEditor) {
            const currentPath = this.fileEditor.selectedFilePath();

            if (currentPath !== decodedFilePath && !this.fileOpenedFromQuery) {
              this.fileOpenedFromQuery = false; // Reset flag for new file
              this.openFileWhenReady(decodedFilePath);
            }
          }
        } else if (!isFileOnlyMode) {
          // Reset flag when file query parameter is removed
          this.fileOpenedFromQuery = false;
        }
      });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.fileManagerContext.set(this.router.url.includes('/config') ? 'config' : 'app');
      });

    // Reset editor view when selected agent changes and load commands
    this.selectedAgent$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((agent) => {
      const currentAgentId = agent?.id || null;
      const localSelectedAgentId = this.selectedAgentId();

      // If agent was automatically selected (not via manual click), trigger cleanup
      // This happens when a new agent is created and automatically selected by the reducer
      if (currentAgentId && currentAgentId !== localSelectedAgentId && this.activeClientId) {
        // Update local selected agent ID
        this.selectedAgentId.set(currentAgentId);
        // Navigate to the agent route
        this.router.navigate(['/clients', this.activeClientId, 'agents', currentAgentId]);
        // Reset message count when switching agents
        this.previousMessageCount = 0;
        this.previousDisplayThreadLength = 0;
        this.lastUserMessageTimestamp.set(null);
        // Disconnect current socket, then connect and auto-login agent
        this.disconnectAndReconnectForAgent(this.activeClientId, currentAgentId);
      }

      if (currentAgentId && currentAgentId !== this.previousAgentId && this.editorOpen()) {
        // Reset visibility when agent changes and editor is open (unless in file-only mode)
        if (!this.fileOnlyMode()) {
          // Only show chat and file tree on desktop, hide on mobile by default
          if (!this.isMobile()) {
            this.chatVisible.set(true);

            if (this.fileEditor) {
              this.fileEditor.fileTreeVisible.set(true);
            }
          }

          if (this.fileEditor) {
            this.fileEditor.terminalVisible.set(false);
          }

          setTimeout(() => this.syncFileEditorVisibility(), 0);
        } else {
          // Reset file opened flag when agent changes in file-only mode
          // This allows the file to be opened again for the new agent
          this.fileOpenedFromQuery = false;
          // Reset standalone loading state when switching agents
          this.standaloneFileLoaded = false;

          if (this.standaloneMode() && this.route.snapshot.queryParams['file']) {
            this.standaloneLoadingService.setLoading(true);
          }

          // Check if we still have a file query parameter and open it
          const filePath = this.route.snapshot.queryParams['file'];

          if (filePath) {
            // Decode the file path (in case it's URL encoded)
            let decodedFilePath: string;

            try {
              decodedFilePath = decodeURIComponent(filePath);
            } catch {
              decodedFilePath = filePath;
            }

            this.openFileWhenReady(decodedFilePath);
          }
        }
      }

      // Load commands when agent is selected
      if (currentAgentId && this.activeClientId) {
        if (agent?.agentType === 'cursor') {
          this.filesFacade.listDirectory(this.activeClientId, currentAgentId, { path: '.cursor/commands' });
        } else if (agent?.agentType === 'opencode') {
          this.filesFacade.listDirectory(this.activeClientId, currentAgentId, { path: '.opencode/command' });
        }
      }

      this.previousAgentId = currentAgentId;
    });

    // Load agents when active client changes
    this.activeClientId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((clientId) => {
      if (clientId && clientId !== this.activeClientId) {
        // Switching to a different client - clear agent selection from previous client
        const previousClientId = this.activeClientId;

        if (previousClientId) {
          // Clear agent selection in facade for the previous client
          this.agentsFacade.clearSelectedClientAgent(previousClientId);
        }

        // Clear local agent selection
        this.selectedAgentId.set(null);
        // Update active client
        this.activeClientId = clientId;
        this.loadClientAgentsIfNeeded(clientId);

        // Clear search agent query
        if (this.searchAgentQuery()) {
          this.searchAgentQuery.set('');
        }

        // Ensure socket is connected before setting client
        this.ensureSocketConnectedAndSetClient(clientId);
      } else if (!clientId && this.activeClientId) {
        // Client was cleared, reset local state
        const previousClientId = this.activeClientId;

        this.activeClientId = null;

        // Clear agent selection for the previous client
        if (previousClientId) {
          this.agentsFacade.clearSelectedClientAgent(previousClientId);
        }

        // Also clear local selected agent if any
        const currentAgentId = this.selectedAgentId();

        if (currentAgentId) {
          this.selectedAgentId.set(null);
        }

        // Clear search agent query
        if (this.searchAgentQuery()) {
          this.searchAgentQuery.set('');
        }
      }
    });

    // Subscribe to chat messages and trigger scroll when new messages arrive
    this.chatMessages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((messages) => {
      const currentMessageCount = messages.length;

      // Initialize lastAgentMessageTimestamp on first load to prevent treating existing messages as new
      if (this.previousMessageCount === 0 && currentMessageCount > 0 && this.lastAgentMessageTimestamp === 0) {
        const agentMessages = messages.filter((msg) => this.isAgentMessage(msg.payload));

        if (agentMessages.length > 0) {
          this.lastAgentMessageTimestamp = Math.max(...agentMessages.map((msg) => msg.timestamp));
        }
      }

      if (currentMessageCount > this.previousMessageCount) {
        this.shouldScrollToBottom = true;
        this.previousMessageCount = currentMessageCount;
        // Trigger change detection to ensure DOM is updated
        this.cdr.detectChanges();

        // Check for new agent messages and refresh editor if open
        const newAgentMessages = messages.filter(
          (msg) => this.isAgentMessage(msg.payload) && msg.timestamp > this.lastAgentMessageTimestamp,
        );

        if (newAgentMessages.length > 0) {
          // Update last agent message timestamp
          this.lastAgentMessageTimestamp = Math.max(
            ...newAgentMessages.map((msg) => msg.timestamp),
            this.lastAgentMessageTimestamp,
          );

          // Refresh file editor if it's open
          if (this.editorOpen() && this.fileEditor) {
            this.fileEditor.refresh();
          }
        }
      } else if (currentMessageCount < this.previousMessageCount) {
        // Messages were cleared (e.g., switching clients/agents)
        this.previousMessageCount = currentMessageCount;
        this.previousDisplayThreadLength = 0;
        this.lastUserMessageTimestamp.set(null);
        this.lastAgentMessageTimestamp = 0;
      }
    });

    // Merged thread can grow when automation cards hydrate or appear without new `chatMessage` rows — still scroll.
    this.displayChatThread$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((thread) => {
      const len = thread.length;

      if (len > this.previousDisplayThreadLength) {
        this.shouldScrollToBottom = true;
        this.previousDisplayThreadLength = len;
        this.cdr.detectChanges();
      } else if (len < this.previousDisplayThreadLength) {
        this.previousDisplayThreadLength = len;
      }
    });

    this.chatPendingUi$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged((a, b) => {
          if (a.isPendingAgentResponse !== b.isPendingAgentResponse) {
            return false;
          }

          const sa = a.stream?.segments;
          const sb = b.stream?.segments;

          if (sa === sb) {
            return true;
          }

          if (!sa || !sb || sa.length !== sb.length) {
            return false;
          }

          for (let i = 0; i < sa.length; i++) {
            const xa = sa[i];
            const xb = sb[i];

            if (xa.kind !== xb.kind) {
              return false;
            }

            if (xa.kind === 'row' && xb.kind === 'row') {
              if (xa.row.trackId !== xb.row.trackId) {
                return false;
              }
            } else if (xa.kind === 'markdown' && xb.kind === 'markdown') {
              if (xa.trackId !== xb.trackId || xa.markdown !== xb.markdown) {
                return false;
              }
            } else {
              return false;
            }
          }

          return true;
        }),
      )
      .subscribe((pending) => {
        if (pending.isPendingAgentResponse) {
          this.shouldScrollToBottom = true;
          this.cdr.detectChanges();
        }
      });

    // Preload marked library in the background
    this.loadMarked().catch(() => {
      // Silently fail - will use plain text fallback
    });

    // Watch for file content loading in standalone mode (must use same file API context as the editor route)
    combineLatest([
      this.standaloneMode$,
      this.selectedAgent$,
      this.activeClientId$,
      this.route.queryParams,
      this.fileManagerContext$,
    ])
      .pipe(
        filter(([standalone, agent, clientId]) => {
          // Show loading if standalone mode is active and we have agent/client
          // If no file is specified, we'll hide loading immediately
          return standalone && !!agent && !!clientId && !this.standaloneFileLoaded;
        }),
        switchMap(([, agent, clientId, queryParams, fileContext]) => {
          // TypeScript guard: agent and clientId are checked in filter, but we need to assert here
          if (!agent || !clientId) {
            return of({
              error: false,
              filePath: undefined,
              clientId: undefined,
              agentId: undefined,
              fileContext: undefined as FileManagerContext | undefined,
            });
          }

          // At this point, TypeScript knows agent and clientId are non-null
          const nonNullAgent = agent;
          const nonNullClientId = clientId;
          const filePathParam = queryParams?.['file'];

          // If no file is specified, hide loading immediately
          if (!filePathParam || typeof filePathParam !== 'string') {
            return of({
              error: false,
              filePath: undefined,
              clientId: nonNullClientId,
              agentId: nonNullAgent.id,
              fileContext,
            }); // No file to wait for
          }

          const filePath: string = filePathParam;
          // Decode the file path
          const decodedFilePath: string = (() => {
            try {
              return decodeURIComponent(filePath);
            } catch {
              return filePath;
            }
          })();

          // Watch for file content to be loaded or error to occur
          return combineLatest([
            this.filesFacade.isReadingFile$(nonNullClientId, nonNullAgent.id, decodedFilePath, fileContext),
            this.filesFacade.getFileContent$(nonNullClientId, nonNullAgent.id, decodedFilePath, fileContext),
            this.filesFacade.getFileError$(nonNullClientId, nonNullAgent.id, decodedFilePath, fileContext),
          ]).pipe(
            // Wait until file is not loading AND (content is available OR error occurred)
            filter(([isLoading, content, error]) => !isLoading && (content !== null || error !== null)),
            take(1),
            map(([, , error]) => ({
              error: error !== null,
              filePath: decodedFilePath,
              clientId: nonNullClientId,
              agentId: nonNullAgent.id,
              fileContext,
            })),
            catchError(() => {
              // Handle any unexpected errors
              return of({
                error: true,
                filePath: decodedFilePath,
                clientId: nonNullClientId,
                agentId: nonNullAgent.id,
                fileContext,
              });
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        // File content is loaded (or no file to load), hide the loading spinner (only on initial load)
        if (!this.standaloneFileLoaded) {
          // If file was not found (error occurred), unselect the file and close the tab
          if (result?.error && result.filePath && result.clientId && result.agentId) {
            // Close the tab
            this.filesFacade.closeFileTab(result.clientId, result.agentId, result.filePath, result.fileContext);

            // Open chat if it's not open
            if (!this.chatVisible()) {
              this.chatVisible.set(true);
            }

            // Unselect the file if it's currently selected
            if (this.fileEditor) {
              const currentPath = this.fileEditor.selectedFilePath();

              if (currentPath === result.filePath) {
                this.fileEditor.selectedFilePath.set(null);
              }
            }

            this.fileOpenedFromQuery = false;
          }

          this.standaloneLoadingService.setLoading(false);
          this.standaloneFileLoaded = true;
        }
      });
  }

  ngOnDestroy(): void {
    // Cancel any pending sync to prevent callbacks holding component reference
    if (this.syncAnimationFrameId !== null) {
      cancelAnimationFrame(this.syncAnimationFrameId);
      this.syncAnimationFrameId = null;
    }

    if (this.syncTimeoutId !== null) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }

    // Dispose tooltip if it exists
    if (this.shareButtonTooltip) {
      this.shareButtonTooltip.dispose();
      this.shareButtonTooltip = null;
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom && this.chatMessagesContainer) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }

    // Sync fileEditor visibility signals - coalesced to at most once per frame to avoid memory churn
    this.scheduleSyncFileEditorVisibility();
  }

  /**
   * Schedules a sync of fileEditor visibility signals. Coalesces multiple calls to at most one per
   * animation frame to avoid excessive setTimeout/requestAnimationFrame callbacks during change detection.
   */
  private scheduleSyncFileEditorVisibility(): void {
    if (this.syncAnimationFrameId !== null) {
      return;
    }

    this.syncAnimationFrameId = requestAnimationFrame(() => {
      this.syncAnimationFrameId = null;
      this.syncFileEditorVisibility();
    });
  }

  /**
   * Syncs local visibility signals with fileEditor's signals.
   * This prevents ExpressionChangedAfterItHasBeenCheckedError by avoiding direct template access.
   */
  private syncFileEditorVisibility(): void {
    if (this.syncTimeoutId !== null) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }

    if (this.editorOpen() && this.fileEditor) {
      // Use setTimeout to ensure this runs after the current change detection cycle
      this.syncTimeoutId = setTimeout(() => {
        this.syncTimeoutId = null;

        if (this.fileEditor) {
          this.fileTreeVisible.set(this.fileEditor.fileTreeVisible());
          this.terminalVisible.set(this.fileEditor.terminalVisible());
          this.gitManagerVisible.set(this.fileEditor.gitManagerVisible());
          this.selectedFilePathForShare.set(this.fileEditor.selectedFilePath());
        }

        this.cdr.markForCheck();
      }, 0);
    } else {
      // Reset when editor is closed - use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
      this.syncTimeoutId = setTimeout(() => {
        this.syncTimeoutId = null;
        this.fileTreeVisible.set(false);
        this.terminalVisible.set(false);
        this.gitManagerVisible.set(false);
        this.selectedFilePathForShare.set(null);
        this.cdr.markForCheck();
      }, 0);
    }
  }

  /**
   * Wrapper for fileEditor's onToggleFileTree that syncs visibility after toggle
   */
  onToggleFileTree(): void {
    if (this.fileEditor) {
      this.fileEditor.onToggleFileTree();
      this.syncFileEditorVisibility();
    }
  }

  /**
   * Wrapper for fileEditor's onToggleTerminal that syncs visibility after toggle
   */
  onToggleTerminal(): void {
    if (this.fileEditor) {
      this.fileEditor.onToggleTerminal();
      this.syncFileEditorVisibility();
    }
  }

  /**
   * Wrapper for fileEditor's onToggleGitManager that syncs visibility after toggle
   */
  onToggleGitManager(): void {
    if (this.fileManagerContext() === 'config') {
      return;
    }

    if (this.fileEditor) {
      this.fileEditor.onToggleGitManager();
      this.syncFileEditorVisibility();
    }
  }

  private loadClientAgentsIfNeeded(clientId: string): void {
    this.agentsFacade
      .hasClientAgents$(clientId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((hasAgents) => {
        if (!hasAgents) {
          this.agentsFacade.loadClientAgents(clientId);
        }
      });
  }

  onClientSelect(clientId: string, navigate = true): void {
    // Use local state for immediate check to avoid race conditions
    const currentActiveClientId = this.activeClientId;

    if (currentActiveClientId === clientId) {
      // Client is already selected, unselect it
      // First, unselect any selected agent (without navigation)
      const currentAgentId = this.selectedAgentId();

      if (currentAgentId && this.activeClientId) {
        this.onAgentUnselect(false);
      }

      // Clear active client
      this.clientsFacade.clearActiveClient();
      // Disconnect socket if connected
      this.socketConnected$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((connected) => {
        if (connected) {
          this.socketsFacade.disconnect();
        }
      });

      // Navigate to base route
      if (navigate) {
        this.router.navigate(['/']);
      }

      // Reset message count
      this.previousMessageCount = 0;
      this.previousDisplayThreadLength = 0;
      this.lastUserMessageTimestamp.set(null);
      this.notificationsFacade.setActiveEnvironment(null, null);

      // Close editor if open
      if (this.editorOpen()) {
        this.editorOpen.set(false);
        setTimeout(() => this.syncFileEditorVisibility(), 0);
      }
    } else {
      // Select the client
      // Clear agent selection from previous client if switching
      const previousClientId = this.activeClientId;

      if (previousClientId && previousClientId !== clientId) {
        // Clear agent selection in facade for the previous client
        this.agentsFacade.clearSelectedClientAgent(previousClientId);
        // Clear local agent selection
        this.selectedAgentId.set(null);
      }

      if (navigate) {
        this.router.navigate(['/clients', clientId]);
      }

      this.clientsFacade.setActiveClient(clientId);

      // Update local state and load agents immediately to avoid race conditions
      // This ensures agents are loaded even if the subscription doesn't fire due to timing
      if (this.activeClientId !== clientId) {
        this.activeClientId = clientId;
        this.loadClientAgentsIfNeeded(clientId);
        // Ensure socket is connected before setting client
        this.ensureSocketConnectedAndSetClient(clientId);
      }

      // Reset message count when switching clients
      this.previousMessageCount = 0;
      this.previousDisplayThreadLength = 0;
      this.lastUserMessageTimestamp.set(null);
      // Reset file opened flag when switching clients
      this.fileOpenedFromQuery = false;
      // Reset standalone loading state when switching clients
      this.standaloneFileLoaded = false;

      if (this.standaloneMode() && this.route.snapshot.queryParams['file']) {
        this.standaloneLoadingService.setLoading(true);
      }

      this.notificationsFacade.setActiveEnvironment(clientId, null);
    }
  }

  onAgentSelect(agentId: string, navigate = true): void {
    // Check if this agent is already selected
    const currentAgentId = this.selectedAgentId();

    if (currentAgentId === agentId) {
      // Agent is already selected, unselect it
      this.onAgentUnselect();
    } else {
      // Select the agent
      if (navigate) {
        this.router.navigate(['/clients', this.activeClientId, 'agents', agentId]);
      }

      this.selectedAgentId.set(agentId);
      const clientId = this.activeClientId;

      if (clientId) {
        this.agentsFacade.loadClientAgent(clientId, agentId);
        // Load commands for the selected agent
        this.filesFacade.listDirectory(clientId, agentId, { path: '.cursor/commands' });
        // Reset message count when switching agents
        this.previousMessageCount = 0;
        this.previousDisplayThreadLength = 0;
        this.lastUserMessageTimestamp.set(null);
        // Disconnect current socket, then connect and auto-login agent
        this.disconnectAndReconnectForAgent(clientId, agentId);
        const draft = readAndClearAgentConsoleChatDraft();

        if (draft) {
          this.chatMessage.set(draft.message);

          if (draft.contextInjection) {
            this.includeWorkspaceContext.set(draft.contextInjection.includeWorkspaceContext === true);
            this.autoEnrichmentEnabled.set(draft.contextInjection.autoEnrichmentEnabled !== false);
            this.selectedEnvironmentContextIds.set(draft.contextInjection.selectedEnvironmentContextIds);
            this.selectedTicketContextShas.set(draft.contextInjection.selectedTicketContextShas ?? []);
            this.selectedKnowledgeContextShas.set(draft.contextInjection.selectedKnowledgeContextShas ?? []);
          }

          this.enhanceErrorMessage.set(null);
        }

        this.notificationsFacade.setActiveEnvironment(clientId, agentId);
        this.notificationsFacade.markEnvironmentRead(clientId, agentId);
      }
    }
  }

  /**
   * Unselect the current agent and close the websocket if open
   * @param navigate - Whether to navigate to the client route (default: true)
   */
  onAgentUnselect(navigate = true): void {
    const clientId = this.activeClientId;

    if (clientId) {
      // Clear selected agent in facade
      this.agentsFacade.clearSelectedClientAgent(clientId);
    }

    // Clear local selected agent ID
    this.selectedAgentId.set(null);
    this.notificationsFacade.setActiveEnvironment(clientId ?? null, null);
    // Disconnect socket if connected
    this.socketConnected$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((connected) => {
      if (connected) {
        this.socketsFacade.disconnect();
      }
    });

    // Navigate to client route (without agent) if requested
    if (navigate) {
      this.router.navigate(['/clients', clientId]);
    }

    // Reset message count
    this.previousMessageCount = 0;
    this.previousDisplayThreadLength = 0;
    this.lastUserMessageTimestamp.set(null);

    // Close editor if open
    if (this.editorOpen()) {
      this.editorOpen.set(false);
      setTimeout(() => this.syncFileEditorVisibility(), 0);
    }
  }

  /**
   * Navigate back to workspaces by unselecting the current client
   */
  onClientUnselect(): void {
    const clientId = this.activeClientId;

    if (clientId) {
      this.onClientSelect(clientId, true);
    }
  }

  onSendMessage(): void {
    let message = this.chatMessage().trim();
    // Append selected command to message if one is selected
    const selectedCmd = this.selectedCommand();

    if (selectedCmd) {
      message = message ? `${selectedCmd}\n${message}` : selectedCmd;
    }

    if (!message) {
      return;
    }

    const agentId = this.selectedAgentId();

    if (!agentId) {
      // Cannot send message without an agent selected
      return;
    }

    // agentId is required for routing the event to the correct agent
    this.socketsFacade.forwardChat(message, agentId, this.selectedChatModel(), this.buildContextInjection(agentId));

    // Track when we sent the message to show loading indicator
    this.lastUserMessageTimestamp.set(Date.now());

    this.chatMessage.set('');
    // Clear selected command after sending
    this.selectedCommand.set(null);
    // Trigger scroll after sending message
    this.shouldScrollToBottom = true;
  }

  clearEnhanceError(): void {
    this.enhanceErrorMessage.set(null);
  }

  onEnhanceMessage(): void {
    let message = this.chatMessage().trim();
    const selectedCmd = this.selectedCommand();

    if (selectedCmd) {
      message = message ? `${selectedCmd}\n${message}` : selectedCmd;
    }

    if (!message) {
      return;
    }

    const agentId = this.selectedAgentId();

    if (!agentId) {
      return;
    }

    this.enhanceErrorMessage.set(null);
    const correlationId = crypto.randomUUID();
    const model = this.selectedChatModel();
    const normalizedModel = model === 'auto' || model === null || model === '' ? null : model;

    this.socketsFacade.forwardEnhanceChat(message, agentId, correlationId, normalizedModel);
  }

  onChatInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  onChatModelChange(value: string): void {
    const normalizedValue = value === '' ? null : value;

    this.selectedChatModel.set(normalizedValue);
    this.socketsFacade.setChatModel(normalizedValue);
  }

  onChatResponseModeChange(value: string): void {
    if (value === 'stream' || value === 'single') {
      this.socketsFacade.setChatResponseMode(value);
    }
  }

  onWorkspaceContextToggle(enabled: boolean): void {
    this.includeWorkspaceContext.set(enabled);
  }

  onAutoEnrichmentToggle(enabled: boolean): void {
    this.autoEnrichmentEnabled.set(enabled);
  }

  onOpenContextSelectionModal(): void {
    this.ticketContextInputError.set(null);
    this.knowledgeContextInputError.set(null);
    const clientId = this.activeClientIdSignal();

    if (clientId) {
      this.ticketsFacade.loadTickets({ clientId });
      this.knowledgeFacade.loadTree(clientId);
    }

    this.showModal(this.contextSelectionModal);
  }

  onCloseContextSelectionModal(): void {
    this.ticketContextInputError.set(null);
    this.ticketContextInput.set('');
    this.ticketContextSuggestionsOpen.set(false);
    this.knowledgeContextInputError.set(null);
    this.knowledgeContextInput.set('');
    this.knowledgeContextSuggestionsOpen.set(false);
    this.hideModal(this.contextSelectionModal);
  }

  isEnvironmentContextSelected(environmentId: string): boolean {
    return this.selectedEnvironmentContextIds().includes(environmentId);
  }

  onEnvironmentContextToggle(environmentId: string, enabled: boolean): void {
    const current = this.selectedEnvironmentContextIds();

    if (enabled) {
      if (!current.includes(environmentId)) {
        this.selectedEnvironmentContextIds.set([...current, environmentId]);
      }

      return;
    }

    this.selectedEnvironmentContextIds.set(current.filter((id) => id !== environmentId));
  }

  onTicketContextInputChange(value: string): void {
    this.ticketContextInput.set(value);

    if (this.ticketContextInputError()) {
      this.ticketContextInputError.set(null);
    }

    if (value.trim().length > 0) {
      this.ticketContextSuggestionsOpen.set(true);
    }
  }

  onTicketContextShaInputFocus(): void {
    if (this.ticketContextInput().trim().length > 0 && this.ticketContextSuggestions().length > 0) {
      this.ticketContextSuggestionsOpen.set(true);
    }
  }

  onTicketContextShaInputBlur(): void {
    setTimeout(() => this.ticketContextSuggestionsOpen.set(false), 180);
  }

  onPickTicketContextSuggestion(ticket: TicketResponseDto, event?: Event): void {
    event?.preventDefault();
    this.addTicketToContextIfPermitted(ticket);
    this.ticketContextInput.set('');
    this.ticketContextInputError.set(null);
    this.ticketContextSuggestionsOpen.set(false);
  }

  onAddTicketContextBySha(): void {
    const raw = this.ticketContextInput();
    const input = raw.trim().toLowerCase();

    if (!input) {
      this.ticketContextInputError.set('Enter a ticket SHA.');

      return;
    }

    const permitted = this.ticketContextPermittedTickets();
    const ticket = findPermittedTicketByExactSha(permitted, raw);

    if (!ticket?.shas?.long) {
      this.ticketContextInputError.set(null);

      return;
    }

    this.addTicketToContextIfPermitted(ticket);
    this.ticketContextInput.set('');
    this.ticketContextInputError.set(null);
    this.ticketContextSuggestionsOpen.set(false);
  }

  private addTicketToContextIfPermitted(ticket: TicketResponseDto): void {
    const longSha = ticket.shas?.long;

    if (!longSha) {
      return;
    }

    const clientId = this.activeClientIdSignal();

    if (clientId && ticket.clientId !== clientId) {
      return;
    }

    const current = this.selectedTicketContextShas();

    if (!current.includes(longSha)) {
      this.selectedTicketContextShas.set([...current, longSha]);
    }
  }

  ticketContextChipLabel(longSha: string): { shortSha: string; title: string } {
    const clientId = this.activeClientIdSignal();
    const ticket = (this.ticketsSnapshot() ?? []).find(
      (row) => row.shas?.long === longSha && (!clientId || row.clientId === clientId),
    );

    if (ticket?.shas?.short) {
      return { shortSha: ticket.shas.short, title: ticket.title ?? '' };
    }

    return { shortSha: longSha.slice(0, 7), title: 'Unavailable ticket' };
  }

  ticketContextChipDisplay(longSha: string): string {
    const { shortSha, title } = this.ticketContextChipLabel(longSha);

    return `${shortSha} · ${title}`;
  }

  onRemoveTicketContextSha(longSha: string): void {
    this.selectedTicketContextShas.set(this.selectedTicketContextShas().filter((sha) => sha !== longSha));
  }

  onKnowledgeContextInputChange(value: string): void {
    this.knowledgeContextInput.set(value);

    if (this.knowledgeContextInputError()) {
      this.knowledgeContextInputError.set(null);
    }

    if (value.trim().length > 0) {
      this.knowledgeContextSuggestionsOpen.set(true);
    }
  }

  onKnowledgeContextShaInputFocus(): void {
    if (this.knowledgeContextInput().trim().length > 0 && this.knowledgeContextSuggestions().length > 0) {
      this.knowledgeContextSuggestionsOpen.set(true);
    }
  }

  onKnowledgeContextShaInputBlur(): void {
    setTimeout(() => this.knowledgeContextSuggestionsOpen.set(false), 180);
  }

  onPickKnowledgeContextSuggestion(node: KnowledgeNodeDto, event?: Event): void {
    event?.preventDefault();
    this.addKnowledgeToContextIfPermitted(node);
    this.knowledgeContextInput.set('');
    this.knowledgeContextInputError.set(null);
    this.knowledgeContextSuggestionsOpen.set(false);
  }

  onAddKnowledgeContextBySha(): void {
    const input = this.knowledgeContextInput().trim().toLowerCase();

    if (!input) {
      this.knowledgeContextInputError.set('Enter a page or folder SHA.');

      return;
    }

    const node = this.knowledgeContextPermittedNodes().find((row) => {
      const shortSha = row.shas?.short?.toLowerCase() ?? '';
      const longSha = row.shas?.long?.toLowerCase() ?? '';

      return shortSha === input || longSha === input;
    });

    if (!node?.shas?.long) {
      this.knowledgeContextInputError.set(null);

      return;
    }

    this.addKnowledgeToContextIfPermitted(node);
    this.knowledgeContextInput.set('');
    this.knowledgeContextInputError.set(null);
    this.knowledgeContextSuggestionsOpen.set(false);
  }

  private addKnowledgeToContextIfPermitted(node: KnowledgeNodeDto): void {
    const longSha = node.shas?.long;

    if (!longSha) {
      return;
    }

    const clientId = this.activeClientIdSignal();

    if (clientId && node.clientId !== clientId) {
      return;
    }

    const current = this.selectedKnowledgeContextShas();

    if (!current.includes(longSha)) {
      this.selectedKnowledgeContextShas.set([...current, longSha]);
    }
  }

  knowledgeContextChipDisplay(longSha: string): string {
    const node = this.knowledgeContextPermittedNodes().find((row) => row.shas?.long === longSha);

    if (node?.shas?.short) {
      const kind = node.nodeType === 'folder' ? 'Folder' : 'Page';

      return `${node.shas.short} · ${kind}: ${node.title}`;
    }

    return `${longSha.slice(0, 7)} · Unavailable knowledge`;
  }

  onRemoveKnowledgeContextSha(longSha: string): void {
    this.selectedKnowledgeContextShas.set(this.selectedKnowledgeContextShas().filter((sha) => sha !== longSha));
  }

  private buildContextInjection(agentId: string):
    | {
        includeWorkspace?: boolean;
        environmentIds?: string[];
        ticketShas?: string[];
        knowledgeShas?: string[];
        autoEnrichmentEnabled?: boolean;
      }
    | undefined {
    const includeWorkspace = this.includeWorkspaceContext() === true;
    const autoEnrichmentEnabled = this.autoEnrichmentEnabled() === true;
    const selected = this.selectedEnvironmentContextIds()
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const environmentIds = selected.includes(agentId) ? selected : [agentId, ...selected];
    const ticketShas = [
      ...new Set(
        this.selectedTicketContextShas()
          .map((sha) => sha.trim())
          .filter((sha) => sha),
      ),
    ];
    const knowledgeShas = [
      ...new Set(
        this.selectedKnowledgeContextShas()
          .map((sha) => sha.trim())
          .filter((sha) => sha),
      ),
    ];

    if (
      !includeWorkspace &&
      !autoEnrichmentEnabled &&
      environmentIds.length === 0 &&
      ticketShas.length === 0 &&
      knowledgeShas.length === 0
    ) {
      return undefined;
    }

    return { includeWorkspace, environmentIds, ticketShas, knowledgeShas, autoEnrichmentEnabled };
  }

  onCommandChange(value: string): void {
    const normalizedValue = value === '' ? null : value;

    this.selectedCommand.set(normalizedValue);
  }

  onConnectSocket(): void {
    this.socketsFacade.connect();
  }

  onDisconnectSocket(): void {
    this.socketsFacade.disconnect();
  }

  onToggleEditor(navigate = true, openInNewWindow = false): void {
    const wasOpen = this.editorOpen();

    // If opening in new window and editor is not open, open new window
    if (openInNewWindow && !wasOpen) {
      this.openEditorInNewWindow();

      return;
    }

    // Close deployment manager if opening editor (unless in standalone mode)
    if (!wasOpen && this.deploymentManagerOpen() && !this.standaloneMode()) {
      this.deploymentManagerOpen.set(false);
    }

    this.editorOpen.update((open) => !open);

    if (navigate) {
      // Check if we're in file-only mode
      const filePath = this.route.snapshot.queryParams['file'];

      if (filePath && !wasOpen) {
        // Navigate with file query parameter
        this.router.navigate(['/clients', this.activeClientId, 'agents', this.selectedAgentId(), 'editor'], {
          queryParams: { file: filePath },
        });
      } else {
        this.router.navigate(
          wasOpen
            ? ['/clients', this.activeClientId, 'agents', this.selectedAgentId()]
            : ['/clients', this.activeClientId, 'agents', this.selectedAgentId(), 'editor'],
        );
      }
    }

    // Reset visibility when opening editor for a new agent (unless in file-only mode)
    if (!wasOpen && this.editorOpen() && !this.fileOnlyMode()) {
      // Only show chat and file tree on desktop, hide on mobile by default
      if (!this.isMobile()) {
        this.chatVisible.set(true);

        if (this.fileEditor) {
          this.fileEditor.fileTreeVisible.set(true);
        }
      }

      if (this.fileEditor) {
        this.fileEditor.terminalVisible.set(false);
        this.fileEditor.autosaveEnabled.set(false);
      }

      setTimeout(() => this.syncFileEditorVisibility(), 0);
    }

    // Sync visibility signals after editor toggles
    setTimeout(() => this.syncFileEditorVisibility(), 0);
  }

  /**
   * Navigate to the provider agent config file editor (requires workspace management access).
   */
  onOpenAgentConfigFiles(openInNewWindow = false): void {
    const clientId = this.activeClientId;
    const agentId = this.selectedAgentId();

    if (!clientId || !agentId) {
      return;
    }

    if (openInNewWindow) {
      this.openAgentConfigInNewWindow();

      return;
    }

    void this.router.navigate(['/clients', clientId, 'agents', agentId, 'config']);
  }

  /**
   * Open virtual desktop for the selected agent
   */
  onToggleVNC(client: ClientResponseDto, agent: AgentResponseDto): void {
    const vncPort = agent.vnc?.port;

    if (!vncPort) {
      return;
    }

    // Build the URL
    const urlObj = new URL(client.endpoint);
    const url = `${urlObj.protocol}//${urlObj.hostname}:${vncPort}/vnc.html?resize=scale&autoconnect=1&reconnect=1&password=${encodeURIComponent(agent.vnc?.password || '')}`;
    // Open new window with minimal controls and maximize if possible
    // Note: Modern browsers have restrictions on window features, but we try to minimize what's possible
    // Use screen dimensions to maximize the window
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const windowFeatures = [
      'menubar=no',
      'toolbar=no',
      'location=no', // Attempts to hide address bar (may be ignored by browsers)
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      `left=0`,
      `top=0`,
    ].join(',');
    const newWindow = window.open(url, '_blank', windowFeatures);

    // Try to maximize after window opens (may be blocked by browser security)
    if (newWindow) {
      // Use setTimeout to ensure window is fully loaded before attempting to maximize
      setTimeout(() => {
        try {
          newWindow.moveTo(0, 0);
          newWindow.resizeTo(screenWidth, screenHeight);

          // Try to maximize if the browser supports it
          if (newWindow.screen && 'availWidth' in newWindow.screen) {
            const availWidth = (newWindow.screen as Screen & { availWidth?: number }).availWidth;
            const availHeight = (newWindow.screen as Screen & { availHeight?: number }).availHeight;

            if (availWidth && availHeight) {
              newWindow.resizeTo(availWidth, availHeight);
            }
          }
        } catch (e) {
          // Browser may block window manipulation for security reasons
          console.warn('Could not maximize window:', e);
        }
      }, 100);
    }
  }

  /**
   * Get whether to open editor in new window from environment configuration
   */
  getOpenInNewWindow(): boolean {
    return this.environment.editor?.openInNewWindow ?? false;
  }

  getDeploymentOpenInNewWindow(): boolean {
    return this.environment.deployment?.openInNewWindow ?? false;
  }

  getFileTreeToggleTitle(): string {
    return this.fileTreeVisible()
      ? $localize`:@@featureChat-hideFileTree:Hide File Tree`
      : $localize`:@@featureChat-showFileTree:Show File Tree`;
  }

  getChatToggleTitle(): string {
    return this.chatVisible()
      ? $localize`:@@featureChat-hideChat:Hide Chat`
      : $localize`:@@featureChat-showChat:Show Chat`;
  }

  getTerminalToggleTitle(): string {
    return this.terminalVisible()
      ? $localize`:@@featureChat-hideTerminal:Hide Terminal`
      : $localize`:@@featureChat-showTerminal:Show Terminal`;
  }

  getGitManagerToggleTitle(): string {
    return this.gitManagerVisible()
      ? $localize`:@@featureChat-hideVersionControl:Hide Version Control`
      : $localize`:@@featureChat-showVersionControl:Show Version Control`;
  }

  getChatBackTitle(): string {
    return this.editorOpen()
      ? $localize`:@@featureChat-closeChat:Close Chat`
      : $localize`:@@featureChat-backToEnvironments:Back to environments`;
  }

  getSocketStatusTitle(reconnecting: boolean): string {
    return reconnecting
      ? $localize`:@@featureChat-reconnecting:Reconnecting...`
      : $localize`:@@featureChat-connected:Connected`;
  }

  getOpenEditorTitle(): string {
    return this.getOpenInNewWindow()
      ? $localize`:@@featureChat-openEditorNewWindow:Open Editor in New Window`
      : $localize`:@@featureChat-openEditor:Open Editor`;
  }

  getOpenAgentConfigFilesTitle(): string {
    return this.getOpenInNewWindow()
      ? $localize`:@@featureChat-openAgentConfigFilesNewWindow:Open agent config in New Window`
      : $localize`:@@featureChat-openAgentConfigFilesTitle:Open provider agent config files (requires workspace management access)`;
  }

  getDeploymentManagerToggleTitle(): string {
    const openInNew = this.getDeploymentOpenInNewWindow();
    const isOpen = this.deploymentManagerOpen();

    if (openInNew && !isOpen) {
      return $localize`:@@featureChat-openDeploymentManagerNewWindow:Open Deployment Manager in New Window`;
    }

    return isOpen
      ? $localize`:@@featureChat-closeDeploymentManager:Close Deployment Manager`
      : $localize`:@@featureChat-openDeploymentManager:Open Deployment Manager`;
  }

  /**
   * Open editor in a new window with minimal browser controls in standalone mode
   */
  private openEditorInNewWindow(): void {
    const clientId = this.activeClientId;
    const agentId = this.selectedAgentId();

    if (!clientId || !agentId) {
      return;
    }

    // Get currently selected file path if editor is open and file is selected
    let filePath: string | undefined;

    if (this.fileEditor) {
      filePath = this.fileEditor.selectedFilePath() || undefined;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const segment = this.fileManagerContext() === 'config' ? 'config' : 'editor';
    const editorPath = `/clients/${clientId}/agents/${agentId}/${segment}`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');

    if (filePath) {
      queryParams.set('file', encodeURIComponent(filePath));
    }

    const url = `${baseUrl}${editorPath}?${queryParams.toString()}`;
    // Open new window with minimal controls and maximize if possible
    // Note: Modern browsers have restrictions on window features, but we try to minimize what's possible
    // Use screen dimensions to maximize the window
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const windowFeatures = [
      'menubar=no',
      'toolbar=no',
      'location=no', // Attempts to hide address bar (may be ignored by browsers)
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      `left=0`,
      `top=0`,
    ].join(',');
    const newWindow = window.open(url, '_blank', windowFeatures);

    // Try to maximize after window opens (may be blocked by browser security)
    if (newWindow) {
      // Use setTimeout to ensure window is fully loaded before attempting to maximize
      setTimeout(() => {
        try {
          newWindow.moveTo(0, 0);
          newWindow.resizeTo(screenWidth, screenHeight);

          // Try to maximize if the browser supports it
          if (newWindow.screen && 'availWidth' in newWindow.screen) {
            const availWidth = (newWindow.screen as Screen & { availWidth?: number }).availWidth;
            const availHeight = (newWindow.screen as Screen & { availHeight?: number }).availHeight;

            if (availWidth && availHeight) {
              newWindow.resizeTo(availWidth, availHeight);
            }
          }
        } catch (e) {
          // Browser may block window manipulation for security reasons
          console.warn('Could not maximize window:', e);
        }
      }, 100);
    }
  }

  /**
   * Open the config file editor in a new window with standalone mode (same as {@link openEditorInNewWindow}).
   */
  private openAgentConfigInNewWindow(): void {
    const clientId = this.activeClientId;
    const agentId = this.selectedAgentId();

    if (!clientId || !agentId) {
      return;
    }

    let filePath: string | undefined;

    if (this.fileEditor && this.fileManagerContext() === 'config') {
      filePath = this.fileEditor.selectedFilePath() || undefined;
    }

    const baseUrl = window.location.origin;
    const configPath = `/clients/${clientId}/agents/${agentId}/config`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');

    if (filePath) {
      queryParams.set('file', encodeURIComponent(filePath));
    }

    const url = `${baseUrl}${configPath}?${queryParams.toString()}`;
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const windowFeatures = [
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      `left=0`,
      `top=0`,
    ].join(',');
    const newWindow = window.open(url, '_blank', windowFeatures);

    if (newWindow) {
      setTimeout(() => {
        try {
          newWindow.moveTo(0, 0);
          newWindow.resizeTo(screenWidth, screenHeight);

          if (newWindow.screen && 'availWidth' in newWindow.screen) {
            const availWidth = (newWindow.screen as Screen & { availWidth?: number }).availWidth;
            const availHeight = (newWindow.screen as Screen & { availHeight?: number }).availHeight;

            if (availWidth && availHeight) {
              newWindow.resizeTo(availWidth, availHeight);
            }
          }
        } catch (e) {
          console.warn('Could not maximize window:', e);
        }
      }, 100);
    }
  }

  onToggleChat(): void {
    this.chatVisible.update((visible) => !visible);

    // Recalculate file editor tabs when chat visibility changes
    if (this.fileEditor) {
      this.fileEditor.recalculateTabs();
    }
  }

  onToggleDeploymentManager(navigate = true, openInNewWindow = false): void {
    const wasOpen = this.deploymentManagerOpen();

    // If opening in new window and deployment manager is not open, open new window
    if (openInNewWindow && !wasOpen) {
      this.openDeploymentManagerInNewWindow();

      return;
    }

    // Close editor if opening deployment manager (unless in standalone mode)
    if (!wasOpen && this.editorOpen() && !this.standaloneMode()) {
      this.editorOpen.set(false);
    }

    this.deploymentManagerOpen.set(!wasOpen);

    // Clear standalone loading when opening deployment manager
    if (!wasOpen) {
      this.standaloneLoadingService.setLoading(false);
    }

    if (navigate) {
      this.router.navigate(
        wasOpen
          ? ['/clients', this.activeClientId, 'agents', this.selectedAgentId()]
          : ['/clients', this.activeClientId, 'agents', this.selectedAgentId(), 'deployments'],
      );
    }
  }

  onCloseDeploymentManager(): void {
    this.deploymentManagerOpen.set(false);
  }

  onManageTicketAutonomyClick(agent: AgentResponseDto): void {
    const clientId = this.activeClientId;

    if (!clientId) {
      return;
    }

    this.managingTicketAutonomyAgentId.set(agent.id);
    this.showModal(this.ticketAutonomyModal);
  }

  onCloseTicketAutonomyModal(): void {
    this.managingTicketAutonomyAgentId.set(null);
    this.autonomyFacade.clear();
  }

  private applyTicketAutonomyDraftFromRow(row: ClientAgentAutonomyResponseDto): void {
    this.ticketAutonomyDraftEnabled.set(row.enabled);
    this.ticketAutonomyDraftPreImprove.set(row.preImproveTicket);
    this.ticketAutonomyDraftMaxRuntimeMs.set(row.maxRuntimeMs);
    this.ticketAutonomyDraftMaxIterations.set(row.maxIterations);
    this.ticketAutonomyDraftTokenBudgetText.set(row.tokenBudgetLimit !== null ? String(row.tokenBudgetLimit) : '');
  }

  onResetTicketAutonomyDraft(): void {
    const row = this.autonomyRow();

    if (row) {
      this.applyTicketAutonomyDraftFromRow(row);

      return;
    }

    this.ticketAutonomyDraftEnabled.set(false);
    this.ticketAutonomyDraftPreImprove.set(false);
    this.ticketAutonomyDraftMaxRuntimeMs.set(3_600_000);
    this.ticketAutonomyDraftMaxIterations.set(25);
    this.ticketAutonomyDraftTokenBudgetText.set('');
  }

  onSaveTicketAutonomy(): void {
    const clientId = this.activeClientId;
    const agentId = this.managingTicketAutonomyAgentId();

    if (!clientId || !agentId) {
      return;
    }

    const tokenRaw = this.ticketAutonomyDraftTokenBudgetText().trim();
    const tokenBudgetLimit = tokenRaw === '' ? null : Number(tokenRaw);
    const dto: UpsertClientAgentAutonomyDto = {
      enabled: this.ticketAutonomyDraftEnabled(),
      preImproveTicket: this.ticketAutonomyDraftPreImprove(),
      maxRuntimeMs: Number(this.ticketAutonomyDraftMaxRuntimeMs()) || 1,
      maxIterations: Number(this.ticketAutonomyDraftMaxIterations()) || 1,
      tokenBudgetLimit: tokenBudgetLimit !== null && !Number.isNaN(tokenBudgetLimit) ? tokenBudgetLimit : null,
    };

    this.autonomyFacade.clearError();
    this.autonomyFacade.upsert(clientId, agentId, dto);

    // Close modal when save completes (same pattern as onSubmitUpdateAgent)
    this.autonomyFacade.saving$
      .pipe(
        pairwise(),
        filter(([wasSaving, isSaving]) => wasSaving && !isSaving),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.ticketAutonomyModal);
      });
  }

  /**
   * Open deployment manager in a new standalone window
   */
  private openDeploymentManagerInNewWindow(): void {
    const clientId = this.activeClientId;
    const agentId = this.selectedAgentId();

    if (!clientId || !agentId) {
      return;
    }

    // Get currently selected run ID if deployment manager is open and run is selected
    let runId: string | undefined;

    if (this.deploymentManager) {
      // Access the selectedRunId signal from the deployment manager component
      // Note: We'll need to expose this via a getter or method if needed
      // For now, we'll check the URL query parameter
      const urlParams = new URLSearchParams(window.location.search);

      runId = urlParams.get('run') || undefined;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const deploymentsPath = `/clients/${clientId}/agents/${agentId}/deployments`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');

    if (runId) {
      queryParams.set('run', encodeURIComponent(runId));
    }

    const url = `${baseUrl}${deploymentsPath}?${queryParams.toString()}`;
    // Open new window with minimal controls and maximize if possible
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const windowFeatures = [
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      `left=0`,
      `top=0`,
    ].join(',');
    const newWindow = window.open(url, '_blank', windowFeatures);

    // Try to maximize after window opens
    if (newWindow) {
      setTimeout(() => {
        try {
          newWindow.moveTo(0, 0);
          newWindow.resizeTo(screenWidth, screenHeight);

          if (newWindow.screen && 'availWidth' in newWindow.screen) {
            const availWidth = (newWindow.screen as Screen & { availWidth?: number }).availWidth;
            const availHeight = (newWindow.screen as Screen & { availHeight?: number }).availHeight;

            if (availWidth && availHeight) {
              newWindow.resizeTo(availWidth, availHeight);
            }
          }
        } catch (e) {
          console.warn('Could not maximize window:', e);
        }
      }, 100);
    }
  }

  /**
   * Handle back button click in chat panel on mobile
   * - If editor is open: close the chat panel and return to editor
   * - If editor is closed: unselect agent and return to agent list
   */
  onChatBackButton(): void {
    if (this.editorOpen()) {
      // Editor is open, just close the chat
      this.chatVisible.set(false);

      if (this.fileEditor) {
        this.fileEditor.recalculateTabs();
      }
    } else {
      // Editor is closed, go back to agent list
      this.onAgentUnselect();
    }
  }

  /**
   * Share the currently selected file link by copying it to clipboard
   */
  onShareFileLink(): void {
    const filePath = this.fileEditor?.selectedFilePath();
    const clientId = this.activeClientId;
    const agentId = this.selectedAgentId();

    if (!filePath || !clientId || !agentId) {
      return;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const segment = this.fileManagerContext() === 'config' ? 'config' : 'editor';
    const editorPath = `/clients/${clientId}/agents/${agentId}/${segment}`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');
    queryParams.set('file', encodeURIComponent(filePath));
    const url = `${baseUrl}${editorPath}?${queryParams.toString()}`;

    // Copy to clipboard
    navigator.clipboard
      .writeText(url)
      .then(() => {
        console.log('File link copied to clipboard:', url);
        this.showShareTooltip('Link copied');
      })
      .catch((err) => {
        console.error('Failed to copy file link to clipboard:', err);
        // Fallback: try using the older clipboard API
        const success = this.fallbackCopyToClipboard(url);

        if (success) {
          this.showShareTooltip('Link copied');
        }
      });
  }

  /**
   * Show tooltip with message and hide it after a couple seconds.
   * Uses a simple approach: just update the title and let Bootstrap handle it naturally.
   * Avoids programmatic hide() calls that cause errors.
   */
  private showShareTooltip(message: string): void {
    if (!this.shareFileLinkButton?.nativeElement || !message) {
      return;
    }

    const element = this.shareFileLinkButton.nativeElement;
    // Store original values
    const originalTitle = element.getAttribute('title') || 'Share file link';

    // Clean up any existing tooltip completely first
    this.cleanupTooltipCompletely();

    // Update title - this will be picked up by Bootstrap's tooltip
    element.setAttribute('title', message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = (window as any).bootstrap;

    if (!bootstrap?.Tooltip) {
      console.warn('Bootstrap Tooltip not available');

      return;
    }

    // Get or create tooltip instance - let Bootstrap manage it
    try {
      // Use getOrCreateInstance if available to avoid creating duplicates
      if (bootstrap.Tooltip.getOrCreateInstance) {
        this.shareButtonTooltip = bootstrap.Tooltip.getOrCreateInstance(element);
      } else {
        // Fallback: check for existing instance first
        const existing = bootstrap.Tooltip.getInstance?.(element);

        if (existing) {
          this.shareButtonTooltip = existing;
        } else {
          this.shareButtonTooltip = new bootstrap.Tooltip(element);
        }
      }

      // Update the tooltip title
      if (this.shareButtonTooltip && typeof this.shareButtonTooltip.setContent === 'function') {
        this.shareButtonTooltip.setContent({ '.tooltip-inner': message });
      }

      // Show tooltip manually
      setTimeout(() => {
        if (this.shareButtonTooltip && typeof this.shareButtonTooltip.show === 'function') {
          try {
            this.shareButtonTooltip.show();
          } catch (error) {
            console.error('Failed to show tooltip:', error);
          }
        }
      }, 10);
    } catch (error) {
      console.error('Failed to create Bootstrap Tooltip:', error);

      return;
    }

    // After 2 seconds, restore original state
    // Don't call hide() - just update the title and let it fade naturally
    setTimeout(() => {
      // Restore original title
      element.setAttribute('title', originalTitle);

      // Update tooltip content if method exists
      if (this.shareButtonTooltip && typeof this.shareButtonTooltip.setContent === 'function') {
        try {
          this.shareButtonTooltip.setContent({ '.tooltip-inner': originalTitle });
        } catch (e) {
          // Ignore
        }
      }

      // Remove manual trigger and let it work normally
      element.removeAttribute('data-bs-trigger');
    }, 2000);
  }

  /**
   * Completely clean up tooltip - removes from DOM to prevent errors
   */
  private cleanupTooltipCompletely(): void {
    if (!this.shareFileLinkButton?.nativeElement) {
      return;
    }

    const element = this.shareFileLinkButton.nativeElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = (window as any).bootstrap;
    // Remove any tooltip elements from DOM first to prevent Bootstrap from accessing them
    const tooltipElements = document.querySelectorAll('.tooltip');

    tooltipElements.forEach((tooltip) => {
      try {
        tooltip.remove();
      } catch (e) {
        // Ignore
      }
    });

    // Get and dispose any Bootstrap-managed instance
    if (bootstrap?.Tooltip?.getInstance) {
      try {
        const instance = bootstrap.Tooltip.getInstance(element);

        if (instance) {
          try {
            instance.dispose();
          } catch (e) {
            // Ignore disposal errors
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // Dispose our stored reference
    if (this.shareButtonTooltip) {
      try {
        this.shareButtonTooltip.dispose();
      } catch (e) {
        // Ignore disposal errors
      }

      this.shareButtonTooltip = null;
    }
  }

  /**
   * Fallback method to copy text to clipboard for older browsers
   * Returns true if successful, false otherwise
   */
  private fallbackCopyToClipboard(text: string): boolean {
    const textArea = document.createElement('textarea');

    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');

      if (successful) {
        console.log('File link copied to clipboard (fallback):', text);

        return true;
      } else {
        console.error('Fallback copy command failed');

        return false;
      }
    } catch (err) {
      console.error('Fallback copy to clipboard failed:', err);

      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }

  onDeleteClientClick(clientId: string, clientName: string): void {
    this.clientToDeleteId.set(clientId);
    this.clientToDeleteName.set(clientName);
    // Check if serverInfo already exists in store
    this.clientsFacade
      .getServerInfo$(clientId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((serverInfo) => {
        if (serverInfo) {
          // ServerInfo exists, client has provisioning
          this.clientToDeleteHasProvisioning.set(true);
          this.showModal(this.deleteClientModal);
        } else {
          // Try to load serverInfo to check if provisioning exists
          this.clientsFacade.loadServerInfo(clientId);
          // Wait for loading to complete, then check result
          this.clientsFacade
            .getLoadingServerInfo$(clientId)
            .pipe(
              filter((loading) => !loading), // Wait for loading to finish
              switchMap(() => this.clientsFacade.getServerInfo$(clientId)),
              take(1),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe((info) => {
              this.clientToDeleteHasProvisioning.set(!!info);
              this.showModal(this.deleteClientModal);
            });
        }
      });
  }

  onDeleteAgentClick(agentId: string, agentName: string): void {
    this.agentToDeleteId.set(agentId);
    this.agentToDeleteName.set(agentName);
    this.showModal(this.deleteAgentModal);
  }

  confirmDeleteClient(): void {
    const clientId = this.clientToDeleteId();

    if (clientId) {
      this.clientsFacade.deleteClient(clientId);
      // Subscribe to deletion completion (success or failure) to close modal
      this.clientsDeleting$
        .pipe(
          filter((deleting) => !deleting),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          this.hideModal(this.deleteClientModal);
          this.clientToDeleteId.set(null);
          this.clientToDeleteName.set('');
          this.clientToDeleteHasProvisioning.set(false);
        });
    }
  }

  confirmDeleteAgent(): void {
    const agentId = this.agentToDeleteId();
    const clientId = this.activeClientId;

    if (agentId && clientId) {
      this.agentsFacade.deleteClientAgent(clientId, agentId);
      // Subscribe to deletion completion (success or failure) to close modal
      this.agentsDeleting$
        .pipe(
          filter((deleting) => !deleting),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          this.hideModal(this.deleteAgentModal);
          this.agentToDeleteId.set(null);
          this.agentToDeleteName.set('');
        });
    }
  }

  /**
   * Show a Bootstrap modal
   */
  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      // Use Bootstrap 5 Modal API
      const modal = (window as any).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) {
        modal.show();
      } else {
        // Fallback: create new modal instance
        const Modal = (window as any).bootstrap?.Modal;

        if (Modal) {
          new Modal(modalElement.nativeElement).show();
        }
      }
    }
  }

  /**
   * Hide a Bootstrap modal
   */
  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (window as any).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }

  onAddClientClick(): void {
    // Reset form
    this.newClient.set({
      name: '',
      description: '',
      endpoint: '',
      authenticationType: undefined,
      apiKey: undefined,
      keycloakClientId: undefined,
      keycloakClientSecret: undefined,
      keycloakRealm: undefined,
      keycloakAuthServerUrl: undefined,
      agentWsPort: undefined,
      gitRepositorySetupMode: 'clone',
      gitRepositoryUrl: undefined,
      gitUsername: undefined,
      gitToken: undefined,
      gitPassword: undefined,
      gitPrivateKey: undefined,
      cursorApiKey: undefined,
      agentDefaultImage: undefined,
      autoEnrichEnabledGlobal: 'true',
      autoEnrichVectorMaxCosineDistance: 1,
    });
    this.useProvisioning.set(false);
    this.selectedProvider.set('');
    this.selectedServerType.set('');
    this.selectedLocation.set('');
    // Load providers when opening modal
    this.clientsFacade.loadProvisioningProviders();
    this.showModal(this.addClientModal);
  }

  onAddAgentClick(): void {
    // Reset form; inherit workspace git setup default from agent-manager config
    this.newAgent.set({
      name: '',
      description: '',
      agentType: undefined,
      containerType: undefined,
      gitRepositorySetupMode: this.getDefaultAgentGitRepositorySetupMode(),
      gitRepositoryUrl: undefined,
    });
    this.showModal(this.addAgentModal);
  }

  onClientAuthTypeChange(): void {
    // Clear authentication-specific fields when type changes
    const current = this.newClient();

    this.newClient.set({
      ...current,
      apiKey: undefined,
      keycloakClientId: undefined,
      keycloakClientSecret: undefined,
      keycloakRealm: undefined,
    });
  }

  onProvisioningToggle(enabled: boolean): void {
    this.useProvisioning.set(enabled);

    if (enabled) {
      // Auto-fill name when provisioning is enabled
      this.autoFillProvisioningName();

      // Set default WebSocket port to 8443 for provisioned servers
      if (!this.newClient().agentWsPort) {
        this.updateClientFieldNumber('agentWsPort', 8443);
      }
    }
  }

  onProviderChange(providerType: string): void {
    this.selectedProvider.set(providerType);
    this.selectedServerType.set('');

    if (providerType) {
      this.clientsFacade.loadServerTypes(providerType);
    }

    // Auto-fill name when provider is selected and provisioning is enabled
    if (this.useProvisioning()) {
      this.autoFillProvisioningName();
    }
  }

  onSubmitAddClient(): void {
    let clientData = this.newClient();
    const useProvisioning = this.useProvisioning();

    if (useProvisioning) {
      // Auto-fill name if empty
      if (!clientData.name?.trim()) {
        this.autoFillProvisioningName();
        // Get the updated data after auto-fill
        clientData = this.newClient();

        if (!clientData.name?.trim()) {
          return; // Still empty after generation, should not happen but safety check
        }
      }

      // Provisioning flow
      if (
        !clientData.name ||
        !clientData.authenticationType ||
        !this.selectedProvider() ||
        !this.selectedServerType()
      ) {
        return;
      }

      const provisionDto: ProvisionServerDto = {
        providerType: this.selectedProvider(),
        serverType: this.selectedServerType(),
        name: clientData.name,
        authenticationType: clientData.authenticationType,
      };

      if (clientData.description) {
        provisionDto.description = clientData.description;
      }

      if (this.selectedLocation()) {
        provisionDto.location = this.selectedLocation();
      }

      if (clientData.authenticationType === 'api_key' && clientData.apiKey) {
        provisionDto.apiKey = clientData.apiKey;
      }

      if (clientData.authenticationType === 'keycloak') {
        if (clientData.keycloakClientId) {
          provisionDto.keycloakClientId = clientData.keycloakClientId;
        }

        if (clientData.keycloakClientSecret) {
          provisionDto.keycloakClientSecret = clientData.keycloakClientSecret;
        }

        if (clientData.keycloakRealm) {
          provisionDto.keycloakRealm = clientData.keycloakRealm;
        }

        if (clientData.keycloakAuthServerUrl) {
          provisionDto.keycloakAuthServerUrl = clientData.keycloakAuthServerUrl;
        }
      }

      if (clientData.agentWsPort) {
        provisionDto.agentWsPort = clientData.agentWsPort;
      }

      // GIT configuration
      const gitSetupMode = clientData.gitRepositorySetupMode ?? 'clone';

      provisionDto.gitRepositorySetupMode = gitSetupMode;

      if (gitSetupMode === 'clone') {
        if (clientData.gitRepositoryUrl) {
          provisionDto.gitRepositoryUrl = clientData.gitRepositoryUrl;
        }

        if (clientData.gitUsername) {
          provisionDto.gitUsername = clientData.gitUsername;
        }

        if (clientData.gitToken) {
          provisionDto.gitToken = clientData.gitToken;
        }

        if (clientData.gitPassword) {
          provisionDto.gitPassword = clientData.gitPassword;
        }

        if (clientData.gitPrivateKey) {
          provisionDto.gitPrivateKey = clientData.gitPrivateKey;
        }
      }

      // Cursor agent configuration
      if (clientData.cursorApiKey) {
        provisionDto.cursorApiKey = clientData.cursorApiKey;
      }

      if (clientData.agentDefaultImage) {
        provisionDto.agentDefaultImage = clientData.agentDefaultImage;
      }

      const autoEnrich = (clientData.autoEnrichEnabledGlobal ?? 'true').trim();

      if (autoEnrich === 'true' || autoEnrich === 'false') {
        provisionDto.autoEnrichEnabledGlobal = autoEnrich;
      }

      const maxCos = clientData.autoEnrichVectorMaxCosineDistance;

      if (maxCos !== undefined && maxCos !== null && Number.isFinite(maxCos) && maxCos >= 0 && maxCos <= 2) {
        provisionDto.autoEnrichVectorMaxCosineDistance = maxCos;
      }

      this.clientsFacade.provisionServer(provisionDto);

      // Subscribe to provisioning completion to close modal
      this.provisioning$
        .pipe(
          filter((provisioning) => !provisioning),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          this.hideModal(this.addClientModal);
          this.resetClientForm();
        });
    } else {
      // Manual client creation flow
      if (!clientData.name || !clientData.endpoint || !clientData.authenticationType) {
        return;
      }

      // Build the DTO, only including defined values
      const createDto: CreateClientDto = {
        name: clientData.name,
        endpoint: clientData.endpoint,
        authenticationType: clientData.authenticationType,
      };

      if (clientData.description) {
        createDto.description = clientData.description;
      }

      if (clientData.authenticationType === 'api_key' && clientData.apiKey) {
        createDto.apiKey = clientData.apiKey;
      }

      if (clientData.authenticationType === 'keycloak') {
        if (clientData.keycloakClientId) {
          createDto.keycloakClientId = clientData.keycloakClientId;
        }

        if (clientData.keycloakClientSecret) {
          createDto.keycloakClientSecret = clientData.keycloakClientSecret;
        }

        if (clientData.keycloakRealm) {
          createDto.keycloakRealm = clientData.keycloakRealm;
        }
      }

      if (clientData.agentWsPort) {
        createDto.agentWsPort = clientData.agentWsPort;
      }

      this.clientsFacade.createClient(createDto);

      // Subscribe to creation completion to close modal
      this.clientsCreating$
        .pipe(
          filter((creating) => !creating),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          this.hideModal(this.addClientModal);
          this.resetClientForm();
        });
    }
  }

  private resetClientForm(): void {
    this.newClient.set({
      name: '',
      description: '',
      endpoint: '',
      authenticationType: undefined,
      apiKey: undefined,
      keycloakClientId: undefined,
      keycloakClientSecret: undefined,
      keycloakRealm: undefined,
      agentWsPort: undefined,
      autoEnrichEnabledGlobal: 'true',
      autoEnrichVectorMaxCosineDistance: 1,
    });
    this.useProvisioning.set(false);
    this.selectedProvider.set('');
    this.selectedServerType.set('');
    this.selectedLocation.set('');
  }

  onSubmitAddAgent(): void {
    const agentData = this.newAgent();
    const clientId = this.activeClientId;

    if (!agentData.name || !clientId) {
      return;
    }

    // Build the DTO
    const createDto: CreateAgentDto = {
      name: agentData.name,
    };

    if (agentData.description) {
      createDto.description = agentData.description;
    }

    if (agentData.agentType) {
      createDto.agentType = agentData.agentType;
    }

    const workspaceMode = this.activeClientSignal()?.config?.gitRepositorySetupMode;
    const gitSetupMode = agentData.gitRepositorySetupMode ?? workspaceMode ?? 'clone';

    createDto.gitRepositorySetupMode = gitSetupMode;

    if (gitSetupMode === 'clone' && agentData.gitRepositoryUrl) {
      createDto.gitRepositoryUrl = agentData.gitRepositoryUrl;
    }

    if (agentData.containerType) {
      createDto.containerType = agentData.containerType;
    }

    // Include boolean fields (default to true if not set)
    createDto.createVirtualWorkspace = agentData.createVirtualWorkspace ?? false;
    createDto.createSshConnection = agentData.createSshConnection ?? false;

    this.agentsFacade.createClientAgent(clientId, createDto);

    // Subscribe to creation completion to close modal
    this.agentsCreating$
      .pipe(
        filter((creating) => !creating),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.addAgentModal);
        // Reset form
        this.newAgent.set({
          name: '',
          description: '',
          agentType: undefined,
          containerType: undefined,
          gitRepositorySetupMode: this.getDefaultAgentGitRepositorySetupMode(),
          gitRepositoryUrl: undefined,
          createVirtualWorkspace: false,
          createSshConnection: false,
        });
      });
  }

  private getDefaultAgentGitRepositorySetupMode(): 'clone' | 'empty' {
    return this.activeClientSignal()?.config?.gitRepositorySetupMode ?? 'clone';
  }

  getWorkspaceGitSetupModeDefaultLabel(mode: 'clone' | 'empty'): string {
    return mode === 'empty' ? 'Empty repository (git init)' : 'Clone from remote';
  }

  /**
   * Generate a random cool name in DigitalOcean node naming style.
   * Format: adjective-noun-number (e.g., "stellar-nova-42", "cosmic-dream-17")
   */
  private generateCoolName(): string {
    const adjectives = [
      'stellar',
      'cosmic',
      'quantum',
      'nebula',
      'galactic',
      'stellar',
      'lunar',
      'solar',
      'atomic',
      'digital',
      'virtual',
      'cloud',
      'azure',
      'crimson',
      'emerald',
      'sapphire',
      'amber',
      'violet',
      'silver',
      'golden',
    ];
    const nouns = [
      'nova',
      'dream',
      'leap',
      'pulse',
      'wave',
      'stream',
      'node',
      'core',
      'edge',
      'flux',
      'spark',
      'beam',
      'ray',
      'star',
      'moon',
      'sun',
      'orbit',
      'comet',
      'meteor',
      'planet',
    ];
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 100);

    return `${adjective}-${noun}-${number}`;
  }

  /**
   * Auto-fill the client name with a generated cool name if provisioning is enabled and name is empty.
   */
  private autoFillProvisioningName(): void {
    if (this.useProvisioning() && !this.newClient().name?.trim()) {
      const generatedName = this.generateCoolName();

      this.updateClientField('name', generatedName);
    }
  }

  // Helper methods to update signal values for form binding
  updateClientField<K extends keyof CreateClientDto>(field: K, value: CreateClientDto[K]): void {
    this.newClient.update((current) => ({ ...current, [field]: value }));
  }

  updateClientFieldNumber(field: 'agentWsPort', value: string | number | null | undefined): void {
    const numValue = value === '' || value === null || value === undefined ? undefined : Number(value);

    this.newClient.update((current) => ({ ...current, [field]: numValue }));
  }

  updateClientProvisioningVectorMaxCos(value: string | number | null | undefined): void {
    const numValue = value === '' || value === null || value === undefined ? 1 : Number(value);

    this.updateClientField('autoEnrichVectorMaxCosineDistance', Number.isFinite(numValue) ? numValue : 1);
  }

  updateAgentField<K extends keyof CreateAgentDto>(field: K, value: CreateAgentDto[K]): void {
    this.newAgent.update((current) => ({ ...current, [field]: value }));
  }

  // Helper methods to update editing signal values for form binding
  updateEditingClientField<K extends keyof UpdateClientDto>(field: K, value: UpdateClientDto[K]): void {
    this.editingClient.update((current) => ({ ...current, [field]: value }));
  }

  updateEditingClientFieldNumber(field: 'agentWsPort', value: string | number | null | undefined): void {
    const numValue = value === '' || value === null || value === undefined ? undefined : Number(value);

    this.editingClient.update((current) => ({ ...current, [field]: numValue }));
  }

  updateEditingAgentField<K extends keyof UpdateAgentDto>(field: K, value: UpdateAgentDto[K]): void {
    this.editingAgent.update((current) => ({ ...current, [field]: value }));
  }

  onEditClientClick(client: ClientResponseDto): void {
    // Pre-fill form with current client values
    this.editingClientId.set(client.id);
    this.editingClient.set({
      name: client.name,
      description: client.description,
      endpoint: client.endpoint,
      authenticationType: client.authenticationType,
      // Note: API key and secrets are not returned in ClientResponseDto for security
      // They will be undefined, and user can optionally set new values
      apiKey: undefined,
      keycloakClientId: undefined,
      keycloakClientSecret: undefined,
      keycloakRealm: undefined,
      agentWsPort: client.agentWsPort,
    });
    this.showModal(this.updateClientModal);
  }

  onEditAgentClick(agent: AgentResponseDto): void {
    // Pre-fill form with current agent values
    this.editingAgentId.set(agent.id);
    this.editingAgent.set({
      name: agent.name,
      description: agent.description,
      containerType: agent.containerType,
    });
    this.showModal(this.updateAgentModal);
  }

  onStartAgent(clientId: string, agentId: string): void {
    this.agentsFacade.startClientAgent(clientId, agentId);
  }

  onStopAgent(clientId: string, agentId: string): void {
    this.agentsFacade.stopClientAgent(clientId, agentId);
  }

  onRestartAgent(clientId: string, agentId: string): void {
    this.agentsFacade.restartClientAgent(clientId, agentId);
  }

  /**
   * Creates the .openclaw directory and .openclaw/openclaw.json with default configuration,
   * then refreshes the directory listing so the quickstart step 1 button can disable.
   */
  createOpenClawConfig(clientId: string, agentId: string): void {
    this.filesFacade.createFileOrDirectory(clientId, agentId, AgentConsoleChatComponent.OPENCLAW_CONFIG_DIR, {
      type: 'directory',
    } as CreateFileDto);

    of(null)
      .pipe(delay(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const config = this.getDefaultOpenClawConfig();
        const content = JSON.stringify(config, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));
        const writeDto: WriteFileDto = { content: base64Content, encoding: 'utf-8' };

        this.filesFacade.writeFile(clientId, agentId, AgentConsoleChatComponent.OPENCLAW_CONFIG_PATH, writeDto);

        this.filesFacade
          .isWritingFile$(clientId, agentId, AgentConsoleChatComponent.OPENCLAW_CONFIG_PATH)
          .pipe(
            filter((writing) => !writing),
            take(1),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(() => {
            this.filesFacade.listDirectory(clientId, agentId, {
              path: AgentConsoleChatComponent.OPENCLAW_CONFIG_DIR,
            });
          });
      });
  }

  /** Returns the default OpenClaw config object written to .openclaw/openclaw.json. */
  private getDefaultOpenClawConfig(): object {
    return {
      commands: {
        native: 'auto',
        nativeSkills: 'auto',
      },
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: 'pairing',
          botToken: '1234567890',
          groupPolicy: 'allowlist',
          streamMode: 'partial',
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.1-codex',
          },
          maxConcurrent: 4,
          subagents: {
            maxConcurrent: 8,
          },
        },
      },
      messages: {
        ackReactionScope: 'group-mentions',
      },
      plugins: {
        entries: {
          telegram: {
            enabled: true,
          },
        },
      },
      meta: {
        lastTouchedVersion: '2026.2.9',
        lastTouchedAt: '2026-02-10T19:07:41.424Z',
      },
    };
  }

  onEditingClientAuthTypeChange(): void {
    // Clear authentication-specific fields when type changes
    const current = this.editingClient();

    this.editingClient.set({
      ...current,
      apiKey: undefined,
      keycloakClientId: undefined,
      keycloakClientSecret: undefined,
      keycloakRealm: undefined,
    });
  }

  onSubmitUpdateClient(): void {
    const clientId = this.editingClientId();
    const clientData = this.editingClient();

    if (!clientId || !clientData.name || !clientData.endpoint || !clientData.authenticationType) {
      return;
    }

    // Build the DTO, only including defined values
    const updateDto: UpdateClientDto = {};

    if (clientData.name) {
      updateDto.name = clientData.name;
    }

    if (clientData.description !== undefined) {
      updateDto.description = clientData.description;
    }

    if (clientData.endpoint) {
      updateDto.endpoint = clientData.endpoint;
    }

    if (clientData.authenticationType) {
      updateDto.authenticationType = clientData.authenticationType;
    }

    if (clientData.authenticationType === 'api_key' && clientData.apiKey !== undefined) {
      updateDto.apiKey = clientData.apiKey;
    }

    if (clientData.authenticationType === 'keycloak') {
      if (clientData.keycloakClientId !== undefined) {
        updateDto.keycloakClientId = clientData.keycloakClientId;
      }

      if (clientData.keycloakClientSecret !== undefined) {
        updateDto.keycloakClientSecret = clientData.keycloakClientSecret;
      }

      if (clientData.keycloakRealm !== undefined) {
        updateDto.keycloakRealm = clientData.keycloakRealm;
      }
    }

    if (clientData.agentWsPort !== undefined) {
      updateDto.agentWsPort = clientData.agentWsPort;
    }

    this.clientsFacade.updateClient(clientId, updateDto);

    // Subscribe to update completion to close modal
    this.clientsUpdating$
      .pipe(
        filter((updating) => !updating),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.updateClientModal);
        // Reset form
        this.editingClientId.set(null);
        this.editingClient.set({
          name: '',
          description: '',
          endpoint: '',
          authenticationType: undefined,
          apiKey: undefined,
          keycloakClientId: undefined,
          keycloakClientSecret: undefined,
          keycloakRealm: undefined,
          agentWsPort: undefined,
        });
      });
  }

  onSubmitUpdateAgent(): void {
    const agentId = this.editingAgentId();
    const agentData = this.editingAgent();
    const clientId = this.activeClientId;

    if (!agentId || !agentData.name || !clientId) {
      return;
    }

    // Build the DTO
    const updateDto: UpdateAgentDto = {};

    if (agentData.name) {
      updateDto.name = agentData.name;
    }

    if (agentData.description !== undefined) {
      updateDto.description = agentData.description;
    }

    if (agentData.containerType !== undefined) {
      updateDto.containerType = agentData.containerType;
    }

    this.agentsFacade.updateClientAgent(clientId, agentId, updateDto);

    // Subscribe to update completion to close modal
    this.agentsUpdating$
      .pipe(
        filter((updating) => !updating),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.updateAgentModal);
        // Reset form
        this.editingAgentId.set(null);
        this.editingAgent.set({
          name: '',
          description: '',
          containerType: undefined,
        });
      });
  }

  onManageEnvironmentVariablesClick(agent: AgentResponseDto): void {
    const clientId = this.activeClientId;

    if (!clientId) {
      return;
    }

    // Store the agent ID for this modal session
    this.managingEnvVarsAgentId.set(agent.id);

    // Load environment variables when opening modal
    this.envFacade.loadEnvironmentVariables(clientId, agent.id);

    this.showModal(this.environmentVariablesModal);
  }

  onSubmitCreateEnvironmentVariable(): void {
    const clientId = this.activeClientId;
    const agentId = this.managingEnvVarsAgentId();

    if (!clientId || !agentId) {
      return;
    }

    const newEnvVar = this.newEnvVar();

    if (!newEnvVar.variable || !newEnvVar.content) {
      return;
    }

    this.envFacade.createEnvironmentVariable(clientId, agentId, newEnvVar);

    // Subscribe to creation completion to reset form
    this.environmentVariablesCreating$
      .pipe(
        filter((creating) => !creating),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Reset form
        this.newEnvVar.set({
          variable: '',
          content: '',
        });
      });
  }

  onEditEnvironmentVariableClick(envVar: EnvironmentVariableResponseDto): void {
    this.editingEnvVarId.set(envVar.id);
    this.editingEnvVarValue.set(envVar.content);
  }

  onCancelEditEnvironmentVariable(): void {
    this.editingEnvVarId.set(null);
    this.editingEnvVarValue.set('');
  }

  onSaveEnvironmentVariable(envVar: EnvironmentVariableResponseDto): void {
    const clientId = this.activeClientId;
    const agentId = this.managingEnvVarsAgentId();

    if (!clientId || !agentId) {
      return;
    }

    const newValue = this.editingEnvVarValue();

    if (newValue === envVar.content) {
      // No change, just cancel edit
      this.onCancelEditEnvironmentVariable();

      return;
    }

    const updateDto: UpdateEnvironmentVariableDto = {
      variable: envVar.variable,
      content: newValue,
    };

    this.envFacade.updateEnvironmentVariable(clientId, agentId, envVar.id, updateDto);

    // Subscribe to update completion to cancel edit mode
    this.envFacade
      .isUpdatingEnvironmentVariable$(clientId, agentId, envVar.id)
      .pipe(
        filter((updating) => !updating),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.onCancelEditEnvironmentVariable();
      });
  }

  onDeleteEnvironmentVariable(envVarId: string): void {
    const clientId = this.activeClientId;
    const agentId = this.managingEnvVarsAgentId();

    if (!clientId || !agentId) {
      return;
    }

    this.envFacade.deleteEnvironmentVariable(clientId, agentId, envVarId);
  }

  updateEnvVarField(field: keyof CreateEnvironmentVariableDto, value: string): void {
    this.newEnvVar.update((current: CreateEnvironmentVariableDto) => ({ ...current, [field]: value }));
  }

  onCloseEnvironmentVariablesModal(): void {
    // Reset state when modal is closed
    this.managingEnvVarsAgentId.set(null);
    this.editingEnvVarId.set(null);
    this.editingEnvVarValue.set('');
    this.newEnvVar.set({
      variable: '',
      content: '',
    });
  }

  onManageWorkspaceConfigurationClick(client: ClientResponseDto): void {
    this.managingWorkspaceConfigurationClient.set(client);
    this.managingWorkspaceConfigurationClientId.set(client.id);
    this.workspaceConfigFacade.loadSettings(client.id);
    this.showModal(this.workspaceConfigurationModal);
  }

  getEditingWorkspaceConfigurationValue(setting: WorkspaceConfigurationSettingResponseDto): string {
    const overrides = this.editingWorkspaceConfigurationValues();
    const fromOverride = overrides[setting.settingKey];

    if (fromOverride !== undefined) {
      return fromOverride;
    }

    if (setting.settingKey === 'gitRepositorySetupMode') {
      const raw = setting.value?.trim();

      if (raw === 'empty' || raw === 'clone') {
        return raw;
      }

      return 'clone';
    }

    if (setting.settingKey === 'autoEnrichEnabledGlobal') {
      const raw = setting.value?.trim();

      if (raw === undefined || raw === '') {
        return 'true';
      }

      return raw.toLowerCase() === 'false' || raw === '0' ? 'false' : 'true';
    }

    if (setting.settingKey === 'autoEnrichVectorMaxCosineDistance') {
      const raw = setting.value?.trim();

      if (raw === undefined || raw === '') {
        return '1';
      }

      return raw;
    }

    return setting.value ?? '';
  }

  getWorkspaceConfigurationSettingTitle(settingKey: WorkspaceConfigurationSettingKey): string {
    switch (settingKey) {
      case 'gitRepositorySetupMode':
        return $localize`:@@featureChat-workspaceSettingTitleGitSetupMode:Git repository setup mode`;
      case 'gitRepositoryUrl':
        return $localize`:@@featureChat-workspaceSettingTitleGitRepo:Git repository URL`;
      case 'gitUsername':
        return $localize`:@@featureChat-workspaceSettingTitleGitUsername:Git username`;
      case 'gitToken':
        return $localize`:@@featureChat-workspaceSettingTitleGitToken:Git token`;
      case 'gitPassword':
        return $localize`:@@featureChat-workspaceSettingTitleGitPassword:Git password`;
      case 'gitPrivateKey':
        return $localize`:@@featureChat-workspaceSettingTitleGitPrivateKey:Git private key (SSH)`;
      case 'cursorApiKey':
        return $localize`:@@featureChat-workspaceSettingTitleCursorApiKey:Cursor API key`;
      case 'agentDefaultImage':
        return $localize`:@@featureChat-workspaceSettingTitleAgentImage:Agent default image`;
      case 'autoEnrichEnabledGlobal':
        return $localize`:@@featureChat-workspaceSettingTitleAutoEnrichGlobal:Prompt auto-enrichment (workspace)`;
      case 'autoEnrichVectorMaxCosineDistance':
        return $localize`:@@featureChat-workspaceSettingTitleVectorMaxCosineDistance:Vector auto-enrichment max cosine distance`;
      default:
        return settingKey;
    }
  }

  getWorkspaceConfigurationSourceLabel(setting: WorkspaceConfigurationSettingResponseDto): string {
    switch (setting.source) {
      case 'override':
        return $localize`:@@featureChat-workspaceConfigurationSourceLabel:Override`;
      case 'default_env':
        return $localize`:@@featureChat-workspaceConfigurationSourceLabelDefaultEnvironment:Default environment`;
      default:
        return $localize`:@@featureChat-workspaceConfigurationSourceLabelUnset:Unset`;
    }
  }

  getWorkspaceConfigurationSourceBadgeClass(setting: WorkspaceConfigurationSettingResponseDto): string {
    switch (setting.source) {
      case 'override':
        return 'bg-primary-subtle text-primary-emphasis';
      case 'default_env':
        return 'bg-info-subtle text-info-emphasis';
      default:
        return 'bg-secondary-subtle text-secondary-emphasis';
    }
  }

  onWorkspaceConfigurationValueChange(settingKey: WorkspaceConfigurationSettingKey, value: string): void {
    this.editingWorkspaceConfigurationValues.update((current) => ({ ...current, [settingKey]: value }));
  }

  onSaveWorkspaceConfigurationOverride(setting: WorkspaceConfigurationSettingResponseDto): void {
    const clientId = this.managingWorkspaceConfigurationClientId();

    if (!clientId) {
      return;
    }

    const value = this.getEditingWorkspaceConfigurationValue(setting).trim();

    if (!value) {
      return;
    }

    this.workspaceConfigFacade.upsertSetting(clientId, setting.settingKey, value);
  }

  onDeleteWorkspaceConfigurationOverride(settingKey: WorkspaceConfigurationSettingKey): void {
    const clientId = this.managingWorkspaceConfigurationClientId();

    if (!clientId) {
      return;
    }

    this.workspaceConfigFacade.deleteSettingOverride(clientId, settingKey);
  }

  getWorkspaceConfigurationSettingSaving$(settingKey: WorkspaceConfigurationSettingKey): Observable<boolean> {
    const clientId = this.managingWorkspaceConfigurationClientId();

    if (!clientId) {
      return of(false);
    }

    return this.workspaceConfigFacade.isSavingSetting$(clientId, settingKey);
  }

  getWorkspaceConfigurationSettingDeleting$(settingKey: WorkspaceConfigurationSettingKey): Observable<boolean> {
    const clientId = this.managingWorkspaceConfigurationClientId();

    if (!clientId) {
      return of(false);
    }

    return this.workspaceConfigFacade.isDeletingSetting$(clientId, settingKey);
  }

  onCloseWorkspaceConfigurationModal(): void {
    const clientId = this.managingWorkspaceConfigurationClientId();

    if (clientId) {
      this.workspaceConfigFacade.clearSettings(clientId);
    }

    this.managingWorkspaceConfigurationClientId.set(null);
    this.managingWorkspaceConfigurationClient.set(null);
    this.editingWorkspaceConfigurationValues.set({});
  }

  onManageClientUsersClick(client: ClientResponseDto): void {
    this.managingClientUsersClientId.set(client.id);
    this.clientsFacade.loadClientUsers(client.id);
    this.showModal(this.clientUsersModal);
  }

  onSubmitAddClientUser(): void {
    const clientId = this.managingClientUsersClientId();

    if (!clientId) {
      return;
    }

    const dto = this.newClientUser();

    if (!dto.email?.trim()) {
      return;
    }

    this.clientsFacade.addClientUser(clientId, {
      email: dto.email.trim(),
      role: dto.role,
    });

    this.clientUsersAdding$
      .pipe(
        filter((adding) => !adding),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.newClientUser.set({
          email: '',
          role: 'user' as ClientUserRole,
        });
      });
  }

  onRemoveClientUser(relationshipId: string): void {
    const clientId = this.managingClientUsersClientId();

    if (!clientId) {
      return;
    }

    this.clientsFacade.removeClientUser(clientId, relationshipId);
  }

  getRemovingClientUser$(relationshipId: string): Observable<boolean> {
    return this.clientsFacade.getRemovingClientUser$(relationshipId);
  }

  updateClientUserField(field: keyof AddClientUserDto, value: string | ClientUserRole): void {
    this.newClientUser.update((current) => ({ ...current, [field]: value }));
  }

  onCloseClientUsersModal(): void {
    this.managingClientUsersClientId.set(null);
    this.newClientUser.set({
      email: '',
      role: 'user' as ClientUserRole,
    });
  }

  formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  openTicketAutomationRunFromChat(payload: TicketAutomationRunChatEventPayload): void {
    const act = payload.actions.find((a) => a.type === 'openTicketAutomationRun');

    if (!act) {
      return;
    }

    void this.router.navigate(['/tickets', payload.ticket.clientId], {
      queryParams: { openTicketId: act.ticketId, openAutomationRunId: act.runId },
    });
  }

  openTicketDetailFromChat(payload: TicketAutomationRunChatEventPayload): void {
    void this.router.navigate(['/tickets', payload.ticket.clientId], {
      queryParams: { openTicketId: payload.ticket.id },
    });
  }

  /**
   * Format a price value to 2 decimal places with currency symbol
   * @param price - The price value (can be number, string, null, or undefined)
   * @returns Formatted price string (e.g., "10.50") or empty string if invalid
   */
  formatPrice(price: number | string | null | undefined): string {
    if (price == null) {
      return '';
    }

    const numPrice = typeof price === 'string' ? parseFloat(price) : price;

    if (isNaN(numPrice)) {
      return '';
    }

    return numPrice.toFixed(2);
  }

  /**
   * Extract hostname and port from a URL string
   * @param url - The full URL string
   * @returns The hostname with port if present (e.g., "example.com:8080") or just hostname if no port, or the original string if parsing fails
   */
  getHostname(url: string, withPort = true): string {
    try {
      const urlObj = new URL(url);

      // Return hostname with port if port is explicitly specified in the URL
      if (withPort && urlObj.port) {
        return `${urlObj.hostname}:${urlObj.port}`;
      }

      return urlObj.hostname;
    } catch {
      // If URL parsing fails, return the original string
      return url;
    }
  }

  /**
   * Get the display name for an agent type from a client's config.
   * @param agentType - The agent type identifier (e.g., 'cursor')
   * @param client - The client response DTO (optional, will use active client if not provided)
   * @returns The display name (e.g., 'Cursor') or the type itself if not found
   */
  getAgentTypeDisplayName(agentType: string | undefined, client?: ClientResponseDto | null): string {
    if (!agentType) {
      return '';
    }

    const clientToUse = client;
    const agentTypeInfo = clientToUse?.config?.agentTypes?.find((at) => at.type === agentType);

    return agentTypeInfo?.displayName || agentType;
  }

  /**
   * Get the display name for a provisioning provider type.
   * @param providerType - The provider type (e.g., 'hetzner')
   * @param providers - Array of provisioning provider info
   * @returns The display name (e.g., 'Hetzner Cloud') or null if not found
   */
  getProviderDisplayName(
    providerType: string | undefined,
    providers: Array<{ type: string; displayName: string }>,
  ): string | null {
    if (!providerType) {
      return null;
    }

    const provider = providers.find((p) => p.type === providerType);

    return provider?.displayName || null;
  }

  /**
   * Get the provider display name observable for a client.
   * @param clientId - The client ID
   * @returns Observable of provider display name or null
   */
  getClientProviderDisplayName$(clientId: string): Observable<string | null> {
    return this.provisioningProviders$.pipe(
      switchMap((providers): Observable<string | null> => {
        return this.clientsFacade.getServerInfo$(clientId).pipe(
          map((serverInfo): string | null => {
            if (!serverInfo || !serverInfo.providerType || !providers || providers.length === 0) {
              return null;
            }

            const displayName = this.getProviderDisplayName(serverInfo.providerType, providers);

            return displayName;
          }),
          // Handle errors gracefully - if serverInfo doesn't exist (404), return null
          catchError(() => of(null as string | null)),
        );
      }),
      startWith(null as string | null),
    );
  }

  /**
   * Get deployment status for an agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of deployment status info or null
   */
  /**
   * Get container run status (running/stopped) for an agent from stats.
   */
  getAgentContainerRunning$(clientId: string, agentId: string): Observable<boolean | null> {
    return this.statsFacade.getContainerRunningStatus$(clientId, agentId);
  }

  getAgentDeploymentStatus$(
    clientId: string,
    agentId: string,
  ): Observable<{ status: string; icon: string; color: string } | null> {
    const cacheKey = `${clientId}:${agentId}`;
    // Return cached observable if it exists
    const cached = this.deploymentStatusCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    // Create new observable and cache it
    const status$ = this.deploymentsService.getConfiguration(clientId, agentId).pipe(
      switchMap((config) => {
        if (!config) {
          return of(null);
        }

        // Get the latest run (limit=1, sorted by createdAt desc on backend)
        return this.deploymentsService.listRuns(clientId, agentId, 1, 0).pipe(
          map((runs): { status: string; icon: string; color: string } | null => {
            if (!runs || runs.length === 0) {
              return null;
            }

            const latestRun = runs[0];

            return this.getDeploymentStatusInfo(latestRun);
          }),
          catchError(() => of(null)),
        );
      }),
      catchError(() => of(null)),
      startWith(null),
    );

    this.deploymentStatusCache.set(cacheKey, status$);

    return status$;
  }

  /**
   * Get deployment status info (icon, color, text) from a deployment run.
   * @param run - The deployment run
   * @returns Status info with icon, color, and status text
   */
  private getDeploymentStatusInfo(run: DeploymentRun): { status: string; icon: string; color: string } {
    // Use conclusion if available (completed runs), otherwise use status (in-progress runs)
    const statusOrConclusion = run.conclusion || run.status;

    switch (statusOrConclusion) {
      case 'success':
        return { status: 'Successful', icon: 'bi-check', color: 'bg-success' };
      case 'failure':
        return { status: 'Failed', icon: 'bi-x', color: 'bg-danger' };
      case 'cancelled':
        return { status: 'Cancelled', icon: 'bi-x', color: 'bg-warning' };
      case 'skipped':
        return { status: 'Skipped', icon: 'bi-skip-forward', color: 'bg-secondary' };
      case 'in_progress':
      case 'running':
        return { status: 'Running', icon: 'bi-play', color: 'bg-primary' };
      case 'queued':
        return { status: 'Queued', icon: 'bi-clock-history', color: 'bg-info' };
      case 'completed':
        // If status is completed but no conclusion, treat as success
        return { status: 'Successful', icon: 'bi-check', color: 'bg-success' };
      default:
        return { status: statusOrConclusion || 'Unknown', icon: 'bi-question', color: 'bg-secondary' };
    }
  }

  onClientGitSetupModeChange(mode: 'clone' | 'empty'): void {
    if (mode === 'empty') {
      this.newClient.set({
        ...this.newClient(),
        gitRepositorySetupMode: mode,
        gitRepositoryUrl: undefined,
        gitUsername: undefined,
        gitToken: undefined,
        gitPassword: undefined,
        gitPrivateKey: undefined,
      });

      return;
    }

    this.updateClientField('gitRepositorySetupMode', mode);
  }

  onAgentGitSetupModeChange(mode: 'clone' | 'empty'): void {
    if (mode === 'empty') {
      this.newAgent.set({
        ...this.newAgent(),
        gitRepositorySetupMode: mode,
        gitRepositoryUrl: undefined,
      });

      return;
    }

    this.updateAgentField('gitRepositorySetupMode', mode);
  }

  isClientGitCloneMode(): boolean {
    return (this.newClient().gitRepositorySetupMode ?? 'clone') === 'clone';
  }

  isAgentGitCloneMode(): boolean {
    return (this.newAgent().gitRepositorySetupMode ?? 'clone') === 'clone';
  }

  private readonly gitCloneOnlyWorkspaceSettings: WorkspaceConfigurationSettingKey[] = [
    'gitRepositoryUrl',
    'gitUsername',
    'gitToken',
    'gitPassword',
    'gitPrivateKey',
  ];

  isWorkspaceConfigurationSettingVisible(
    settingKey: WorkspaceConfigurationSettingKey,
    settings: WorkspaceConfigurationSettingResponseDto[],
    clientConfig?: ConfigResponseDto | null,
  ): boolean {
    if (!this.gitCloneOnlyWorkspaceSettings.includes(settingKey)) {
      return true;
    }

    return this.resolveWorkspaceGitSetupMode(settings, clientConfig) === 'clone';
  }

  resolveWorkspaceGitSetupMode(
    settings: WorkspaceConfigurationSettingResponseDto[],
    clientConfig?: ConfigResponseDto | null,
  ): 'clone' | 'empty' {
    return resolveGitRepositorySetupMode(null, clientConfig, settings);
  }

  getClientGitRepositoryLabel(client: ClientResponseDto): string | null {
    const settings = client.id === this.activeClientIdSignal() ? this.activeWorkspaceSettings() : null;

    return getGitRepositoryDisplayLabel(null, client.config ?? null, settings);
  }

  getAgentGitRepositoryLabel(agent: AgentResponseDto, client?: ClientResponseDto | null): string | null {
    return getGitRepositoryDisplayLabel(agent, client?.config ?? null, this.activeWorkspaceSettings());
  }

  isLocalGitRepository(agent: AgentResponseDto, client?: ClientResponseDto | null): boolean {
    return isLocalGitRepositoryMode(agent, client?.config ?? null, this.activeWorkspaceSettings());
  }

  /**
   * Parse git repository URL to extract owner/repo
   * @param gitUrl - The git repository URL (e.g., "https://github.com/owner/repo.git" or "git@github.com:owner/repo.git")
   * @returns The owner/repo string (e.g., "owner/repo") or null if parsing fails
   */
  parseGitRepository(gitUrl: string | null | undefined): string | null {
    return parseGitRepositoryLabel(gitUrl);
  }

  buildSSHCommand(clientEndpoint: string, port: number, username?: string, password?: string): string | null {
    const hostname = this.getHostname(clientEndpoint, false);

    if (!hostname) {
      return null;
    }

    const sshUser = username ?? 'agenstra';

    if (!password) {
      return `ssh -o StrictHostKeyChecking=no ${port ? `-p ${port} ` : ''}${sshUser}@${hostname}`;
    }

    return `SSHPASS='${password}' sshpass -e ssh -o StrictHostKeyChecking=no ${port ? `-p ${port} ` : ''}${sshUser}@${hostname}`;
  }

  /**
   * Earliest client timestamp that bounds the current turn's `chatEvent` stream: min(send time, echoed user row).
   * Avoids dropping deltas that arrive before the echoed `chatMessage` user row (which has a later timestamp).
   */
  private deriveStreamingChatEventBaselineMs(
    messages: Array<{ payload: ForwardedEventPayload; timestamp: number }>,
    sentFallbackTs: number | null,
  ): number | null {
    const userMessages = messages.filter((msg) => this.isUserMessage(msg.payload));
    let latestUserInArray: number | null = null;

    if (userMessages.length > 0) {
      const lastUser = userMessages.reduce((latest, msg) => (msg.timestamp > latest.timestamp ? msg : latest));

      latestUserInArray = lastUser.timestamp;
    }

    const candidates: number[] = [];

    if (sentFallbackTs != null) {
      candidates.push(sentFallbackTs);
    }

    if (latestUserInArray != null) {
      candidates.push(latestUserInArray);
    }

    if (candidates.length === 0) {
      return null;
    }

    return Math.min(...candidates);
  }

  private deriveLastUserAndAgentComplete(
    messages: Array<{ payload: ForwardedEventPayload; timestamp: number }>,
    sentFallbackTs: number | null,
  ): { lastUserTs: number | null; hasAgentMessageAfter: boolean } {
    const chatMessages = messages.filter((msg) => this.isUserMessage(msg.payload) || this.isAgentMessage(msg.payload));
    let lastUserTs: number | null = null;
    const userMessages = chatMessages.filter((msg) => this.isUserMessage(msg.payload));

    if (userMessages.length > 0) {
      const lastUserMessage = userMessages.reduce((latest, msg) => (msg.timestamp > latest.timestamp ? msg : latest));

      lastUserTs = lastUserMessage.timestamp;
    } else if (sentFallbackTs) {
      lastUserTs = sentFallbackTs;
    }

    if (!lastUserTs) {
      return { lastUserTs: null, hasAgentMessageAfter: false };
    }

    const lastTs = lastUserTs;
    const hasAgentMessageAfter = chatMessages.some((msg) => this.isAgentMessage(msg.payload) && msg.timestamp > lastTs);

    return { lastUserTs, hasAgentMessageAfter };
  }

  isUserMessage(payload: ForwardedEventPayload): boolean {
    if ('success' in payload && payload.success && 'data' in payload) {
      const data = payload.data as ChatMessageData;

      return 'from' in data && data.from === 'user';
    }

    return false;
  }

  isAgentMessage(payload: ForwardedEventPayload): boolean {
    if ('success' in payload && payload.success && 'data' in payload) {
      const data = payload.data as ChatMessageData;

      return 'from' in data && data.from === 'agent';
    }

    return false;
  }

  getChatMessageData(payload: ForwardedEventPayload): ChatMessageData | null {
    if ('success' in payload && payload.success && 'data' in payload) {
      return payload.data as ChatMessageData;
    }

    return null;
  }

  hasResponse(messageData: ChatMessageData): boolean {
    return 'response' in messageData;
  }

  isResponseString(messageData: ChatMessageData): boolean {
    return 'response' in messageData && typeof messageData.response === 'string';
  }

  getResponse(messageData: ChatMessageData): string | unknown {
    if ('response' in messageData) {
      return messageData.response;
    }

    return null;
  }

  getResult(messageData: ChatMessageData): string | null {
    if ('response' in messageData) {
      return formatAgentResponseForChatMarkdown(messageData.response);
    }

    return null;
  }

  isToolResultAgentMessage(messageData: ChatMessageData): boolean {
    if (!('response' in messageData)) {
      return false;
    }

    const r = messageData.response;

    if (typeof r !== 'object' || r === null) {
      return false;
    }

    const t = (r as AgentResponseObject)['type'];

    return t === 'tool_result' || t === 'toolResult';
  }

  getToolResultAccordionSummary(messageData: ChatMessageData): {
    name: string;
    status: 'failed' | 'success';
  } {
    if (!('response' in messageData)) {
      return {
        name: 'tool',
        status: 'success',
      };
    }

    const r = messageData.response;

    if (typeof r !== 'object' || r === null) {
      return {
        name: 'tool',
        status: 'success',
      };
    }

    const agentResponse = r as AgentResponseObject;
    const name = typeof agentResponse['name'] === 'string' ? agentResponse['name'] : 'tool';
    const isError = Boolean(agentResponse['isError']);

    return {
      name,
      status: isError ? 'failed' : 'success',
    };
  }

  getToolResultBodyMarkdown(messageData: ChatMessageData): string {
    if (!('response' in messageData)) {
      return '_—_';
    }

    const r = messageData.response;

    if (typeof r !== 'object' || r === null) {
      return '_—_';
    }

    return formatUnknownAsMarkdown((r as AgentResponseObject)['result']);
  }

  /**
   * Stable keys for @for — do not include $index or rows remount on unrelated list rebuilds.
   */
  trackChatDisplayItem(item: ChatDisplayThreadItem): string {
    if (item.kind === 'user') {
      return `u-${item.msg.timestamp}`;
    }

    if (item.kind === 'ticketAutomationRun') {
      return `ar-${item.payload.run.id}-${item.sortTime}`;
    }

    const firstTs = item.msgs[0]?.timestamp ?? item.view.displayTimestamp;
    const lastTs = item.msgs[item.msgs.length - 1]?.timestamp ?? firstTs;

    return `a-${firstTs}-${lastTs}-${item.msgs.length}-${item.view.hasFiltered ? 'f' : 'n'}-${item.view.hasDropped ? 'd' : 'n'}`;
  }

  private chatFilterResultEqual(
    a: ChatMessageWithFilter['filterResult'],
    b: ChatMessageWithFilter['filterResult'],
  ): boolean {
    if (a === b) {
      return true;
    }

    if (a == null || b == null) {
      return a == null && b == null;
    }

    return (
      a.direction === b.direction &&
      a.status === b.status &&
      a.matchedFilter?.type === b.matchedFilter?.type &&
      a.matchedFilter?.displayName === b.matchedFilter?.displayName
    );
  }

  private chatMessagesWithFilterViewEqual(a: ChatMessageWithFilter[], b: ChatMessageWithFilter[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];

      if (x.timestamp !== y.timestamp || x.event !== y.event || x.payload !== y.payload) {
        return false;
      }

      if (!this.chatFilterResultEqual(x.filterResult, y.filterResult)) {
        return false;
      }
    }

    return true;
  }

  toolResultCollapseId(msgTimestamp: number, msgIndex: number): string {
    return `tool-result-${msgTimestamp}-${msgIndex}`;
  }

  /**
   * Check if an agent message is a MESSAGE_DROPPED error response
   */
  isMessageDropped(messageData: ChatMessageData): boolean {
    if ('response' in messageData) {
      const response = messageData.response;

      if (typeof response === 'object' && response !== null) {
        return response.is_error === true && 'result' in response && response.result === 'MESSAGE_DROPPED';
      }
    }

    return false;
  }

  /**
   * Get filter result for a message
   */
  getFilterResultForMessage(
    messageData: ChatMessageData,
    messageTimestamp: number,
    filterResults: Array<{
      direction: 'incoming' | 'outgoing';
      status: 'allowed' | 'filtered' | 'dropped';
      message: string;
      appliedFilters: Array<{
        type: string;
        displayName: string;
        matched: boolean;
        reason?: string;
      }>;
      matchedFilter?: {
        type: string;
        displayName: string;
        matched: boolean;
        reason?: string;
      };
      action?: 'drop' | 'flag';
      timestamp: number;
    }>,
  ): {
    direction: 'incoming' | 'outgoing';
    status: 'allowed' | 'filtered' | 'dropped';
    matchedFilter?: {
      type: string;
      displayName: string;
      matched: boolean;
      reason?: string;
    };
  } | null {
    const direction = 'from' in messageData && messageData.from === 'user' ? 'incoming' : 'outgoing';
    const TIME_WINDOW_MS = 5000;
    // Find matching filter result
    const matchingResults = filterResults.filter(
      (fr) => fr.direction === direction && Math.abs(fr.timestamp - messageTimestamp) <= TIME_WINDOW_MS,
    );

    if (matchingResults.length === 0) {
      return null;
    }

    // Return the closest match
    const closest = matchingResults.reduce((closest, current) =>
      Math.abs(current.timestamp - messageTimestamp) < Math.abs(closest.timestamp - messageTimestamp)
        ? current
        : closest,
    );

    return {
      direction: closest.direction,
      status: closest.status,
      matchedFilter: closest.matchedFilter,
    };
  }

  /**
   * Load marked library asynchronously and cache the instance
   */
  private async loadMarked(): Promise<Marked> {
    if (this.markedInstance) {
      return this.markedInstance;
    }

    if (this.markedLoadPromise) {
      return this.markedLoadPromise;
    }

    this.markedLoadPromise = (async () => {
      try {
        const markedModule = await import('marked');
        // marked exports the parser directly
        const marked = markedModule.marked;

        this.markedInstance = marked;

        return marked;
      } catch (error) {
        this.markedLoadPromise = null;
        throw error;
      }
    })();

    return this.markedLoadPromise;
  }

  /**
   * Parse markdown to HTML and sanitize it
   */
  parseMarkdown(messageData: ChatMessageData): SafeHtml | null {
    return this.parseMarkdownFromString(this.getResult(messageData));
  }

  /**
   * Parse a markdown string to HTML and sanitize it (shared by full messages and tool-result accordion bodies).
   */
  parseMarkdownFromString(result: string | null): SafeHtml | null {
    if (!result) {
      return null;
    }

    if (this.markedInstance) {
      const cached = this.markdownHtmlCache.get(result);

      if (cached !== undefined) {
        return cached;
      }

      try {
        const html = this.markedInstance.parse(result, {
          breaks: true,
          gfm: true,
        });
        const safe = this.sanitizer.bypassSecurityTrustHtml(html || '');

        this.markdownHtmlCache.set(result, safe);
        this.trimHtmlCache(this.markdownHtmlCache);

        return safe;
      } catch (error) {
        console.warn('Error parsing markdown:', error);
        const escaped = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safe = this.sanitizer.bypassSecurityTrustHtml(escaped);

        this.markdownHtmlCache.set(result, safe);
        this.trimHtmlCache(this.markdownHtmlCache);

        return safe;
      }
    }

    this.loadMarked()
      .then(() => {
        this.cdr.detectChanges();
      })
      .catch(() => undefined);

    const escaped = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return this.sanitizer.bypassSecurityTrustHtml(escaped);
  }

  getText(messageData: ChatMessageData): string | null {
    if ('text' in messageData) {
      return messageData.text;
    }

    return null;
  }

  /**
   * Format message text with command badge if message starts with a slash command
   * @param text - The message text
   * @returns SafeHtml with command wrapped in badge if applicable
   */
  formatMessageWithCommandBadge(text: string | null): SafeHtml | null {
    if (!text) {
      return null;
    }

    const cached = this.commandBadgeHtmlCache.get(text);

    if (cached !== undefined) {
      return cached;
    }

    // Check if message starts with a slash command
    const commandMatch = text.match(/^(\/[^\s\n]+)(.*)$/s);

    if (commandMatch) {
      const command = commandMatch[1];
      const restOfMessage = commandMatch[2];
      // Escape HTML in the rest of the message
      const escapedRest = restOfMessage
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>');
      // Create HTML with badge (white background with primary text for user messages)
      const html = `<span class="badge bg-white text-primary me-2">${command}</span>${escapedRest}`;
      const safe = this.sanitizer.bypassSecurityTrustHtml(html);

      this.commandBadgeHtmlCache.set(text, safe);
      this.trimHtmlCache(this.commandBadgeHtmlCache);

      return safe;
    }

    // No command, return escaped text
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
    const safe = this.sanitizer.bypassSecurityTrustHtml(escaped);

    this.commandBadgeHtmlCache.set(text, safe);
    this.trimHtmlCache(this.commandBadgeHtmlCache);

    return safe;
  }

  /**
   * Scroll chat messages container to the bottom
   */
  private scrollToBottom(): void {
    if (!this.chatMessagesContainer?.nativeElement) {
      return;
    }

    const element = this.chatMessagesContainer.nativeElement;
    const apply = (): void => {
      element.scrollTop = element.scrollHeight;
    };

    // Double rAF + microtask catches rows whose height changes after first paint (e.g. automation cards).
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(() => {
        apply();
        queueMicrotask(apply);
      });
    });
  }

  /**
   * Ensure socket is connected, then set the client
   * @param clientId - The client UUID
   */
  private ensureSocketConnectedAndSetClient(clientId: string): void {
    // Check if socket is already connected
    this.socketConnected$
      .pipe(
        take(1),
        switchMap((connected) => {
          if (connected) {
            // Already connected, set client immediately
            this.socketsFacade.setClient(clientId);

            return of(null);
          } else {
            // Not connected, connect first then set client
            this.socketsFacade.connect();

            return this.socketConnected$.pipe(
              filter((connected) => connected === true),
              take(1),
              tap(() => {
                this.socketsFacade.setClient(clientId);
              }),
            );
          }
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /**
   * Open a file when the file editor is ready
   * @param filePath - The file path to open
   */
  private openFileWhenReady(filePath: string): void {
    if (this.fileOpenedFromQuery) {
      // Already opened this file, skip
      return;
    }

    // Wait for agent to be selected and editor to be open
    this.selectedAgent$
      .pipe(
        filter((agent) => !!agent && this.editorOpen()),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Use multiple requestAnimationFrame calls and setTimeout to ensure file editor is fully initialized
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (this.fileEditor && !this.fileOpenedFromQuery) {
                // Check if file is already selected to avoid unnecessary reloads
                const currentPath = this.fileEditor.selectedFilePath();

                if (currentPath !== filePath) {
                  this.fileEditor.onFileSelect(filePath);
                  this.fileOpenedFromQuery = true;
                } else {
                  this.fileOpenedFromQuery = true;
                }
              }
            }, 200);
          });
        });
      });
  }

  /**
   * Disconnect current socket, reconnect, then set client and forward login
   * @param clientId - The client UUID
   * @param agentId - The agent UUID
   */
  private disconnectAndReconnectForAgent(clientId: string, agentId: string): void {
    // Check current connection state and handle disconnect/reconnect
    this.socketConnected$
      .pipe(
        take(1),
        switchMap((connected) => {
          if (connected) {
            // Currently connected, disconnect first
            this.socketsFacade.disconnect();

            // Wait for disconnection to complete (connected becomes false)
            return this.socketConnected$.pipe(
              filter((connected) => connected === false),
              take(1),
              switchMap(() => {
                // Now connect
                this.socketsFacade.connect();

                // Wait for connection to be established
                return this.socketConnected$.pipe(
                  filter((connected) => connected === true),
                  take(1),
                );
              }),
            );
          } else {
            // Not connected, just connect
            this.socketsFacade.connect();

            // Wait for connection to be established
            return this.socketConnected$.pipe(
              filter((connected) => connected === true),
              take(1),
            );
          }
        }),
        switchMap(() => {
          // Socket is now connected, set client
          this.socketsFacade.setClient(clientId);

          // Wait for setClientSuccess (indicated by selectedClientId matching clientId)
          return this.selectedClientId$.pipe(
            filter((selectedClientId) => selectedClientId === clientId),
            take(1),
          );
        }),
        tap(() => {
          // setClientSuccess received, now forward login
          this.socketsFacade.forwardLogin(agentId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /**
   * Toggle the SSH command visibility
   */
  onToggleSSHCommand(): void {
    this.showSSHCommand.set(!this.showSSHCommand());
  }

  /**
   * Get the display name for a container type
   * @param containerType - The container type
   * @returns The display name
   */
  getContainerTypeDisplayName(containerType: ContainerType): string {
    switch (containerType) {
      case ContainerType.DOCKER:
        return 'Docker';
      case ContainerType.TERRAFORM:
        return 'Terraform';
      case ContainerType.KUBERNETES:
        return 'Kubernetes';
      case ContainerType.GENERIC:
      default:
        return 'Generic';
    }
  }

  /**
   * Static model list from environment config (fallback until GET …/models returns or if unset).
   */
  getChatModelOptions(provider: string): { value: string; label: string }[] {
    const options = this.environment.chatModelOptions?.[provider] ?? {};

    return Object.entries(options).map(([value, label]) => ({
      value,
      label,
    }));
  }

  private resolveChatModelOptions(
    agentType: string,
    models: AgentModelsMap | null,
  ): { value: string; label: string }[] {
    if (models !== null) {
      return Object.entries(models).map(([value, label]) => ({ value, label }));
    }

    return this.getChatModelOptions(agentType);
  }
}
