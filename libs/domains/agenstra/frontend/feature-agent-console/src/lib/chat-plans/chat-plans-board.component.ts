import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
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
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentsFacade,
  ChatPlansFacade,
  ClientsFacade,
  ContainerSocketFacade,
  type AgentResponseDto,
  type ChatPlanActivityDto,
  type ChatPlanListState,
  type ChatPlanResponse,
  type ClientResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBackLinkComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcPageHeaderComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  FPC_DEFAULT_PAGE_SIZE,
  fpcCopyText,
  fpcFormatDateTime,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { EMPTY, combineLatest, debounceTime, distinctUntilChanged, filter, map, of, skip, switchMap, take } from 'rxjs';

import { AgentChatHandoffNavigationService } from '../chat/agent-chat-handoff-navigation.service';
import { sanitizeAndTrustMarkdownHtml } from '../chat/chat-markdown-html';
import { chatPlanStateBadgeColor, chatPlanStateLabel } from '../chat/chat-plan-labels';
import { resolveNamedDisplayLabel } from '../display-name.util';
import { KnowledgeEditorComponent } from '../knowledge/knowledge-editor/knowledge-editor.component';
import { agCopyIdItem, agOpenItem } from '../shared/data-list';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

import {
  chatPlanActivityActor,
  chatPlanActivityDetail,
  chatPlanActivityLabel,
  chatPlanActivityTone,
  chatPlanTableState,
  chatPlanTitle,
  isChatPlanDrafting,
  isChatPlanExecutionLocked,
  isChatPlanRefinable,
} from './chat-plan-board-labels';

interface MarkdownParser {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

/** Debounce for the server-side search (typing) and the activity reload while the agent streams a draft. */
const SEARCH_DEBOUNCE_MS = 300;
const ACTIVITY_RELOAD_DEBOUNCE_MS = 1000;

/**
 * Chat plans of an environment (`/plans/:clientId?agentId=`). Same workspace selection flow as tickets, knowledge and
 * tasks; plans are agent specific, so one environment is always selected (filters drawer). Plans that never entered
 * execution can be edited (markdown editor) or refined by the agent; executed plans are read-only. Live status /
 * content arrives over the clients socket (`chatPlanUpsert`).
 */
@Component({
  selector: 'framework-chat-plans-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBackLinkComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcPageHeaderComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    KnowledgeEditorComponent,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
  ],
  templateUrl: './chat-plans-board.component.html',
  styleUrls: ['./chat-plans-board.component.scss'],
})
export class ChatPlansBoardComponent implements AfterViewInit {
  readonly pageTitle = $localize`:@@featureChatPlans-title:Plans`;
  readonly switchWorkspaceTitle = $localize`:@@featureChatPlans-switchWorkspaceTitle:Switch workspace`;
  readonly refreshTitle = $localize`:@@featureChatPlans-refreshTitle:Refresh`;
  readonly plansLabel = $localize`:@@featureChatPlans-plansTable:Plans`;
  readonly planSearchPlaceholder = $localize`:@@featureChatPlans-searchPlans:Search plans`;
  readonly environmentFilterLabel = $localize`:@@featureChatPlans-environmentFilterLabel:Environment`;
  readonly stateFilterLabel = $localize`:@@featureChatPlans-stateFilterLabel:State`;
  readonly backToPlansTitle = $localize`:@@featureChatPlans-backToPlans:Back to plans`;
  readonly openChatTitle = $localize`:@@featureChatPlans-openChat:Open chat`;
  readonly saveLabel = $localize`:@@featureChatPlans-save:Save`;
  readonly discardLabel = $localize`:@@featureChatPlans-discard:Discard changes`;
  readonly refineTitle = $localize`:@@featureChatPlans-refineTitle:Refine plan`;
  readonly refinePlaceholder = $localize`:@@featureChatPlans-refinePlaceholder:Describe how the agent should change the plan…`;
  readonly activityLabel = $localize`:@@featureChatPlans-activityHeading:Activity`;
  readonly titleLabel = $localize`:@@featureChatPlans-titleLabel:Title`;
  readonly copyReferenceTitle = $localize`:@@featureChatPlans-copyReference:Copy context reference`;

  /** Plans table: State · Plan · Created · Last edited. */
  readonly planColumns: FpcTableColumn<ChatPlanResponse>[] = [
    {
      id: 'state',
      label: $localize`:@@featureChatPlans-colState:State`,
      type: 'state',
      state: (plan) => chatPlanTableState(plan),
    },
    {
      id: 'title',
      label: $localize`:@@featureChatPlans-colPlan:Plan`,
      value: (plan) => chatPlanTitle(plan),
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'created',
      label: $localize`:@@featureChatPlans-colCreated:Created`,
      value: (plan) => this.formatDate(plan.startedAt),
      priority: 2,
      sortable: false,
    },
    {
      id: 'edited',
      label: $localize`:@@featureChatPlans-colEdited:Last edited`,
      value: (plan) => (plan.lastEditedAt ? this.formatDate(plan.lastEditedAt) : ''),
      priority: 3,
      hidden: true,
      sortable: false,
    },
  ];
  readonly planRowMenu = (): FpcMenuItem[] => [
    agOpenItem(),
    { id: 'chat', label: this.openChatTitle, icon: 'chat-left-text' },
    agCopyIdItem(),
  ];
  /** Activity feed as a nested table like knowledge / tickets: Action (state badge) · Time · Actor · Details. */
  readonly activityColumns: FpcTableColumn<ChatPlanActivityDto>[] = [
    {
      id: 'action',
      label: $localize`:@@featureChatPlans-colActivityAction:Action`,
      type: 'state',
      state: (event) => ({
        label: chatPlanActivityLabel(event.actionType),
        tone: chatPlanActivityTone(event.actionType),
      }),
      iconOnly: false,
    },
    {
      id: 'time',
      label: $localize`:@@featureChatPlans-colActivityTime:Time`,
      value: (event) => event.occurredAt,
      required: true,
      priority: 1,
    },
    {
      id: 'actor',
      label: $localize`:@@featureChatPlans-colActivityActor:Actor`,
      value: (event) => chatPlanActivityActor(event),
      priority: 1,
    },
    {
      id: 'details',
      label: $localize`:@@featureChatPlans-colActivityDetails:Details`,
      value: (event) => chatPlanActivityDetail(event),
      priority: 2,
      sortable: false,
    },
  ];
  readonly stateLabel = chatPlanStateLabel;
  readonly stateBadgeColor = chatPlanStateBadgeColor;
  readonly planTitle = chatPlanTitle;

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly chatPlansFacade = inject(ChatPlansFacade);
  private readonly socketsFacade = inject(ContainerSocketFacade);
  private readonly handoffNavigation = inject(AgentChatHandoffNavigationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly locale = inject(LOCALE_ID);
  private readonly markdownParser = signal<MarkdownParser | null>(null);
  private readonly markdownCache = new Map<string, SafeHtml>();

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
  readonly effectiveWorkspace = computed(() => {
    const id = this.effectiveClientId();

    return id ? (this.clients().find((client) => client.id === id) ?? null) : null;
  });

  readonly plans = toSignal(this.chatPlansFacade.plans$, { initialValue: [] as ChatPlanResponse[] });
  readonly total = toSignal(this.chatPlansFacade.total$, { initialValue: 0 });
  readonly loading = toSignal(this.chatPlansFacade.loading$, { initialValue: false });
  readonly selectedPlan = toSignal(this.chatPlansFacade.selectedPlan$, { initialValue: null });
  readonly selectedPlanLoading = toSignal(this.chatPlansFacade.selectedPlanLoading$, { initialValue: false });
  readonly saving = toSignal(this.chatPlansFacade.saving$, { initialValue: false });
  readonly error = toSignal(this.chatPlansFacade.error$, { initialValue: null });
  readonly conflict = toSignal(this.chatPlansFacade.conflict$, { initialValue: false });
  readonly activityLoadingPlanId = toSignal(this.chatPlansFacade.activityLoadingPlanId$, { initialValue: null });

  /** Environment of the page (`?agentId=`); defaults to the workspace's first environment. */
  readonly agentId = signal<string | null>(null);
  /** State filter (`?state=`): editable / read-only / all. */
  readonly stateFilter = signal<ChatPlanListState | null>(null);
  /** Plan opened from the table or a chat card (`?openPlanId=`). */
  readonly selectedPlanId = signal<string | null>(null);
  readonly planSearch = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly hasNext = computed(() => this.page() * this.pageSize() < this.total());

  readonly activity = toSignal(
    toObservable(this.selectedPlanId).pipe(
      switchMap((planId) => (planId ? this.chatPlansFacade.activity$(planId) : of([] as ChatPlanActivityDto[]))),
    ),
    { initialValue: [] as ChatPlanActivityDto[] },
  );

  /** The opened plan once loaded (a stale plan of the previous selection is never shown). */
  readonly openPlan = computed(() => {
    const plan = this.selectedPlan();

    return plan && plan.id === this.selectedPlanId() ? plan : null;
  });
  readonly openPlanEditable = computed(() => this.openPlan()?.editable === true);

  // --- editor -------------------------------------------------------------------------------------------------
  /** Editor content; reset from the plan whenever the plan changes while the user has no unsaved edits. */
  readonly draftMarkdown = signal('');
  readonly draftTitle = signal('');
  /** Version (`updatedAt`) the draft was started from; a save is conditional on it. */
  readonly draftBaseUpdatedAt = signal<string | null>(null);
  readonly draftPlanId = signal<string | null>(null);
  /** Content of the last save request; its echo (response / live upsert) advances the draft's base version. */
  private lastSubmitted: { planId: string; planMarkdown: string; summary: string } | null = null;
  private readonly editor = viewChild(KnowledgeEditorComponent);
  readonly dirty = computed(() => {
    const plan = this.openPlan();

    if (!plan || this.draftPlanId() !== plan.id) {
      return false;
    }

    return (
      this.draftMarkdown() !== (plan.planMarkdown ?? '') || this.draftTitle().trim() !== (plan.summary?.trim() ?? '')
    );
  });
  /** The plan changed (agent, another user, execution) after the user started editing. */
  readonly changedWhileEditing = computed(() => {
    const plan = this.openPlan();

    return !!plan && this.dirty() && this.draftBaseUpdatedAt() !== plan.updatedAt;
  });
  readonly canSave = computed(
    () => this.openPlanEditable() && this.dirty() && !!this.draftMarkdown().trim() && !this.saving(),
  );

  // --- refine -------------------------------------------------------------------------------------------------
  readonly refineMessage = signal('');
  /** Refine is offered on ready plans; unsaved edits must be saved first (the agent refines the stored plan). */
  readonly canRefine = computed(() => {
    const plan = this.openPlan();

    return !!plan && isChatPlanRefinable(plan) && !this.dirty() && !!this.refineMessage().trim();
  });
  readonly refineAvailable = computed(() => {
    const plan = this.openPlan();

    return !!plan && isChatPlanRefinable(plan);
  });
  readonly drafting = computed(() => {
    const plan = this.openPlan();

    return !!plan && isChatPlanDrafting(plan.status);
  });
  readonly executionLocked = computed(() => {
    const plan = this.openPlan();

    return !!plan && isChatPlanExecutionLocked(plan);
  });

  readonly workspaceSwitchModalOpen = signal(false);
  readonly workspaceSwitchSearch = signal('');
  /** Workspace switcher paging over the append-style clients store (further batches load per page). */
  readonly workspaceSwitchHasMore = toSignal(this.clientsFacade.hasMore$, { initialValue: false });
  readonly workspaceSwitchAppendLoading = toSignal(this.clientsFacade.appendLoading$, { initialValue: false });
  readonly workspaceSwitchAppendError = toSignal(this.clientsFacade.appendError$, {
    initialValue: null as string | null,
  });

  onLoadMoreWorkspaces(): void {
    this.clientsFacade.loadMoreClients();
  }

  constructor() {
    this.clientsFacade.loadClients();
    void import('marked').then((module) => this.markdownParser.set(module.marked));

    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const agentId = params.get('agentId')?.trim() || null;
      const state = params.get('state')?.trim();

      if (agentId !== this.agentId()) {
        this.page.set(1);
      }

      this.agentId.set(agentId);
      this.stateFilter.set(state === 'editable' || state === 'readonly' ? state : null);
      this.selectedPlanId.set(params.get('openPlanId')?.trim() || null);
    });

    this.effectiveClientId$
      .pipe(
        filter((clientId): clientId is string => !!clientId),
        switchMap((clientId) => {
          this.agentsFacade.loadClientAgents(clientId);

          return this.ensureSocketClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // Plans are agent specific: without `?agentId=` (or with an agent of another workspace) the first environment
    // of the workspace is selected.
    effect(() => {
      const agents = this.agents();
      const agentId = this.agentId();

      if (agents.length > 0 && (!agentId || !agents.some((agent) => agent.id === agentId))) {
        untracked(
          () =>
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { agentId: agents[0].id, openPlanId: agentId ? null : this.selectedPlanId() },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            }),
        );
      }
    });

    // Server-side search / filter / paging (search debounced while typing).
    const debouncedSearch = toSignal(
      toObservable(this.planSearch).pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
      { initialValue: '' },
    );

    effect(() => {
      const clientId = this.effectiveClientId();
      const agentId = this.agentId();
      const search = debouncedSearch();
      const state = this.stateFilter();
      const page = this.page();
      const pageSize = this.pageSize();

      if (clientId && agentId && this.agents().some((agent) => agent.id === agentId)) {
        untracked(() =>
          this.chatPlansFacade.load(clientId, agentId, {
            search,
            state,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          }),
        );
      }
    });

    // Open the requested plan (deep link / row / chat card).
    effect(() => {
      const clientId = this.effectiveClientId();
      const agentId = this.agentId();
      const planId = this.selectedPlanId();

      untracked(() => {
        if (clientId && agentId && planId) {
          this.chatPlansFacade.open(clientId, agentId, planId);
        } else {
          this.chatPlansFacade.close();
        }

        this.refineMessage.set('');
      });
    });

    // Editor content follows the plan until the user edits; a new plan or a saved version resets it.
    effect(() => {
      const plan = this.openPlan();

      untracked(() => {
        if (!plan) {
          this.draftPlanId.set(null);

          return;
        }

        if (this.draftPlanId() !== plan.id || !this.dirty()) {
          this.resetDraft(plan);

          return;
        }

        // Our own save came back while the user kept typing: the saved version becomes the base of the further
        // edits (no "changed meanwhile" warning for the user's own save).
        const submitted = this.lastSubmitted;

        if (
          submitted &&
          submitted.planId === plan.id &&
          submitted.planMarkdown === (plan.planMarkdown ?? '') &&
          submitted.summary === (plan.summary?.trim() ?? '')
        ) {
          this.draftBaseUpdatedAt.set(plan.updatedAt);
          this.lastSubmitted = null;
        }
      });
    });

    // Activity log: reloaded whenever the opened plan changes (debounced while the agent streams a draft).
    toObservable(this.openPlan)
      .pipe(
        filter((plan): plan is ChatPlanResponse => !!plan),
        map((plan) => ({
          clientId: plan.clientId,
          agentId: plan.agentId,
          planId: plan.id,
          key: `${plan.id}:${plan.status}:${plan.updatedAt}`,
        })),
        distinctUntilChanged((a, b) => a.key === b.key),
        debounceTime(ACTIVITY_RELOAD_DEBOUNCE_MS),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ clientId, agentId, planId }) => this.chatPlansFacade.loadActivity(clientId, agentId, planId));
  }

  ngAfterViewInit(): void {
    this.effectiveClientId$
      .pipe(
        filter((id) => !id),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => setTimeout(() => this.openWorkspaceSwitchModal(), 0));
  }

  workspaceDisplayName(name: string | null | undefined): string {
    return resolveNamedDisplayLabel(name);
  }

  agentName(agentId: string): string {
    return resolveNamedDisplayLabel(this.agents().find((agent) => agent.id === agentId)?.name ?? agentId);
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  renderMarkdown(text: string | null | undefined): SafeHtml | null {
    const parser = this.markdownParser();

    if (!parser || !text) {
      return null;
    }

    const cached = this.markdownCache.get(text);

    if (cached) {
      return cached;
    }

    try {
      const html = sanitizeAndTrustMarkdownHtml(this.sanitizer, parser.parse(text, { breaks: true, gfm: true }));

      this.markdownCache.set(text, html);

      return html;
    } catch {
      return null;
    }
  }

  // --- navigation -------------------------------------------------------------------------------------------

  openWorkspaceSwitchModal(): void {
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    this.workspaceSwitchModalOpen.set(true);
  }

  goToSpaces(event?: Event): void {
    event?.preventDefault();
    this.workspaceSwitchModalOpen.set(false);
    void this.router.navigate(['/clients']);
  }

  onSelectWorkspace(client: ClientResponseDto): void {
    this.workspaceSwitchModalOpen.set(false);
    this.clientsFacade.setActiveClient(client.id);
    void this.router.navigate(['/plans', client.id]);
  }

  onAgentChange(agentId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { agentId: agentId || null, openPlanId: null },
      queryParamsHandling: 'merge',
    });
  }

  onStateFilterChange(state: string): void {
    this.page.set(1);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { state: state || null },
      queryParamsHandling: 'merge',
    });
  }

  onSearchChange(search: string): void {
    this.planSearch.set(search);
  }

  onSelectPlan(plan: ChatPlanResponse): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { openPlanId: plan.id },
      queryParamsHandling: 'merge',
    });
  }

  /** Closes the open plan (phone back button): the list becomes the view again. */
  onClosePlan(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { openPlanId: null },
      queryParamsHandling: 'merge',
    });
  }

  onPlanRowAction(plan: ChatPlanResponse, action: string): void {
    switch (action) {
      case 'open':
        this.onSelectPlan(plan);
        break;
      case 'chat':
        this.onOpenChat(plan);
        break;
      case 'copy-id':
        fpcCopyText(plan.id);
        break;
    }
  }

  /** The plan's chat on the agent's chat page (selected once the chat page shows it). */
  onOpenChat(plan: ChatPlanResponse): void {
    this.handoffNavigation.defer({ agentId: plan.agentId, chatId: plan.chatId });
    void this.router.navigate(['/clients', plan.clientId, 'agents', plan.agentId]);
  }

  onRefresh(): void {
    const clientId = this.effectiveClientId();
    const agentId = this.agentId();
    const planId = this.selectedPlanId();

    if (!clientId || !agentId) {
      return;
    }

    this.chatPlansFacade.load(clientId, agentId, {
      search: this.planSearch(),
      state: this.stateFilter(),
      limit: this.pageSize(),
      offset: (this.page() - 1) * this.pageSize(),
    });

    if (planId) {
      this.chatPlansFacade.open(clientId, agentId, planId);
      this.chatPlansFacade.loadActivity(clientId, agentId, planId);
    }
  }

  // --- editing ----------------------------------------------------------------------------------------------

  onSave(): void {
    const plan = this.openPlan();
    // The editor emits changes debounced: take its content as of now so the last keystrokes are saved too.
    const current = this.editor()?.getMarkdown();

    if (plan && current !== null && current !== undefined && this.openPlanEditable()) {
      this.draftMarkdown.set(current);
    }

    if (!plan || !this.canSave()) {
      return;
    }

    const planMarkdown = this.draftMarkdown();
    const summary = this.draftTitle().trim();

    this.lastSubmitted = { planId: plan.id, planMarkdown, summary };
    this.chatPlansFacade.update(plan.clientId, plan.agentId, plan.id, {
      planMarkdown,
      summary,
      // The version the user started from: a plan changed in between is refused instead of overwritten.
      expectedUpdatedAt: this.draftBaseUpdatedAt() ?? plan.updatedAt,
    });
  }

  /** Drops unsaved edits and reloads the latest version (also after a refused save). */
  onDiscard(): void {
    const plan = this.openPlan();

    this.chatPlansFacade.clearError();

    if (plan) {
      this.resetDraft(plan);
      this.chatPlansFacade.open(plan.clientId, plan.agentId, plan.id);
    }
  }

  /** `plan:<sha>` — usable in "Select context" and by the agent's context tools. */
  onCopyReference(longSha: string): void {
    fpcCopyText(`plan:${longSha}`);
  }

  onDismissError(): void {
    this.chatPlansFacade.clearError();
  }

  /** Agent refine (same socket command as the chat's plan modal); the stored context snapshot is reused. */
  onRefine(): void {
    const plan = this.openPlan();
    const message = this.refineMessage().trim();

    if (!plan || !message || !this.canRefine()) {
      return;
    }

    this.socketsFacade.refineChatPlan(plan.agentId, plan.id, message, crypto.randomUUID());
    this.refineMessage.set('');
  }

  onRefineKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.onRefine();
    }
  }

  private resetDraft(plan: ChatPlanResponse): void {
    this.draftPlanId.set(plan.id);
    this.draftMarkdown.set(plan.planMarkdown ?? '');
    this.draftTitle.set(plan.summary?.trim() ?? '');
    this.draftBaseUpdatedAt.set(plan.updatedAt);
  }

  /** Live plan updates arrive on the clients socket of the workspace room (`setClient` dedupes). */
  private ensureSocketClient(clientId: string) {
    return this.socketsFacade.connected$.pipe(
      take(1),
      switchMap((connected) => {
        if (!connected) {
          this.socketsFacade.connect();
        }

        return this.socketsFacade.connected$.pipe(filter(Boolean), take(1));
      }),
      switchMap(() => {
        this.socketsFacade.setClient(clientId);

        return EMPTY;
      }),
    );
  }
}
