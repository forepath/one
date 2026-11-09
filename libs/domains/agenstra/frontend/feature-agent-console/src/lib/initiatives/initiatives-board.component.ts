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
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentsFacade,
  ClientsFacade,
  InitiativesBoardSocketFacade,
  InitiativesFacade,
  type AgentResponseDto,
  type ClientResponseDto,
  type InitiativeActivityDto,
  type InitiativeDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  INITIATIVE_PATHS,
  INITIATIVE_PHASES,
  INITIATIVE_STATES,
  type InitiativePath,
  type InitiativePhase,
  type InitiativeState,
} from '@forepath/agenstra/shared/util-initiative-method';
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
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcStepStripComponent,
  FpcStepStripDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  fpcCopyText,
  fpcFormatDateTime,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, debounceTime, distinctUntilChanged, filter, map, of, skip, switchMap, take } from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { agCopyIdItem, agOpenItem } from '../shared/data-list';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

import { InitiativeDocumentsComponent } from './initiative-documents.component';
import {
  initiativeActivityDetail,
  initiativeActivityLabel,
  initiativePathHint,
  initiativePathLabel,
  initiativePhaseLabel,
  initiativeStateLabel,
  initiativeStateTableTone,
  initiativeStateTone,
} from './initiative-labels';
import { InitiativeModelSelectComponent } from './initiative-model-select.component';
import { InitiativeLearnComponent, type LearnView } from './initiative-learn.component';
import { InitiativeRunsComponent, type InitiativeStartRequest } from './initiative-runs.component';
import { InitiativeSidebarComponent } from './initiative-sidebar.component';
import { filterInitiativeRows } from './initiative-table-search';
import { InitiativeWorkItemsComponent } from './initiative-work-items.component';

export type InitiativeTab = 'documents' | 'work' | 'runs' | 'learn' | 'activity';

const TABS: readonly InitiativeTab[] = ['runs', 'work', 'documents', 'learn', 'activity'];
/** Guided steps first: "What's next", progress and the work items stay in view in the sidebar of every tab. */
const DEFAULT_TAB: InitiativeTab = 'runs';
const SEARCH_DEBOUNCE_MS = 300;

/** Public guide of the method the page follows (attribution; Initiatives are not an official BMad product). */
export const BMAD_METHOD_URL = 'https://docs.bmad-method.org/';

/**
 * Initiatives (`/initiatives/:clientId?initiativeId=&tab=`): workspace planning that follows the BMad Method —
 * Clarify → Plan → Build & verify → Learn & adjust, with guided steps run by an environment, documents with versions,
 * work items in build order, transfer to tickets and change proposals. Live for everybody in the workspace
 * (`initiatives` socket); every write is conditional on the version the user saw.
 */
@Component({
  selector: 'framework-initiatives-board',
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
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    InitiativeModelSelectComponent,
    FpcPageHeaderComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcStepStripComponent,
    FpcStepStripDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
    InitiativeSidebarComponent,
    InitiativeDocumentsComponent,
    InitiativeWorkItemsComponent,
    InitiativeRunsComponent,
    InitiativeLearnComponent,
  ],
  templateUrl: './initiatives-board.component.html',
  styleUrls: ['./initiatives-board.component.scss'],
})
export class InitiativesBoardComponent implements AfterViewInit {
  readonly pageTitle = $localize`:@@featureInitiatives-title:Initiatives`;
  readonly switchWorkspaceTitle = $localize`:@@featureInitiatives-switchWorkspaceTitle:Switch workspace`;
  readonly listLabel = $localize`:@@featureInitiatives-listLabel:Initiatives`;
  readonly searchPlaceholder = $localize`:@@featureInitiatives-search:Search initiatives`;
  readonly refreshTitle = $localize`:@@featureInitiatives-refresh:Refresh`;
  readonly createTitle = $localize`:@@featureInitiatives-create:New initiative`;
  readonly settingsTitle = $localize`:@@featureInitiatives-settings:Settings`;
  readonly deleteTitle = $localize`:@@featureInitiatives-delete:Delete initiative`;
  readonly backTitle = $localize`:@@featureInitiatives-back:Back to initiatives`;
  readonly copyReferenceTitle = $localize`:@@featureInitiatives-copyReference:Copy context reference`;
  readonly methodTitle = $localize`:@@featureInitiatives-methodGuide:Initiatives follow the BMad Method: open its guide`;
  readonly tabLabels: Record<InitiativeTab, string> = {
    documents: $localize`:@@featureInitiatives-tabDocuments:Documents`,
    work: $localize`:@@featureInitiatives-tabWork:Work items`,
    runs: $localize`:@@featureInitiatives-tabRuns:Guided steps`,
    learn: $localize`:@@featureInitiatives-tabLearn:Learn & adjust`,
    activity: $localize`:@@featureInitiatives-tabActivity:Activity`,
  };
  readonly tabIcons: Record<InitiativeTab, string> = {
    documents: 'file-earmark-text',
    work: 'diagram-3',
    runs: 'chat-square-dots',
    learn: 'arrow-repeat',
    activity: 'clock-history',
  };
  readonly tabs = TABS;
  readonly phases = INITIATIVE_PHASES;
  readonly paths = INITIATIVE_PATHS;
  readonly states = INITIATIVE_STATES;
  readonly methodUrl = BMAD_METHOD_URL;
  readonly phaseLabel = initiativePhaseLabel;
  readonly pathLabel = initiativePathLabel;
  readonly pathHint = initiativePathHint;
  readonly stateLabel = initiativeStateLabel;
  readonly stateTone = initiativeStateTone;

  readonly columns: FpcTableColumn<InitiativeDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({ label: initiativeStateLabel(row.state), tone: initiativeStateTableTone(row.state) }),
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-colTitle:Initiative`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'phase',
      label: $localize`:@@featureInitiatives-colPhase:Phase`,
      value: (row) => initiativePhaseLabel(row.phase),
      priority: 2,
    },
    {
      id: 'updated',
      label: $localize`:@@featureInitiatives-colUpdated:Updated`,
      value: (row) => fpcFormatDateTime(row.updatedAt, this.locale, '—'),
      priority: 3,
      hidden: true,
    },
  ];
  readonly rowMenu = (): FpcMenuItem[] => [agOpenItem(), agCopyIdItem()];
  readonly activityColumns: FpcTableColumn<InitiativeActivityDto>[] = [
    {
      id: 'action',
      label: $localize`:@@featureInitiatives-colAction:Action`,
      type: 'state',
      state: (row) => ({ label: initiativeActivityLabel(row.actionType), tone: activityTone(row.actionType) }),
      iconOnly: false,
    },
    { id: 'time', label: $localize`:@@featureInitiatives-colTime:Time`, value: (row) => row.occurredAt, priority: 1 },
    {
      id: 'actor',
      label: $localize`:@@featureInitiatives-colActor:Actor`,
      value: (row) => this.actorLabel(row),
      priority: 2,
    },
    {
      id: 'details',
      label: $localize`:@@featureInitiatives-colDetails:Details`,
      value: (row) => initiativeActivityDetail(row.payload),
      required: true,
      priority: 1,
      sortable: false,
    },
  ];

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly facade = inject(InitiativesFacade);
  private readonly socketFacade = inject(InitiativesBoardSocketFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  readonly activeClientId = toSignal(this.clientsFacade.activeClientId$, { initialValue: null });
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

  readonly initiatives = toSignal(this.facade.initiatives$, { initialValue: [] as InitiativeDto[] });
  readonly listLoading = toSignal(this.facade.listLoading$, { initialValue: false });
  readonly selected = toSignal(this.facade.selected$, { initialValue: null });
  readonly detailLoading = toSignal(this.facade.detailLoading$, { initialValue: false });
  readonly activity = toSignal(this.facade.activity$, { initialValue: [] as InitiativeActivityDto[] });
  readonly visibleActivity = computed(() =>
    filterInitiativeRows(this.activity(), this.activitySearch(), this.activityColumns, (row) => this.actorLabel(row)),
  );
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly conflict = toSignal(this.facade.conflict$, { initialValue: false });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });

  readonly selectedId = signal<string | null>(null);
  readonly tab = signal<InitiativeTab>(DEFAULT_TAB);
  /** The sidebar asked for a work item: the Work items tab opens it. */
  readonly focusRequest = signal<{ itemId: string; nonce: number } | null>(null);
  /** What's next asked for a transfer: the Work items tab opens its transfer modal (with that epic). */
  readonly transferRequest = signal<{ epicId: string | null; nonce: number } | null>(null);
  /** What's next asked for proposals / findings: Learn & adjust opens on that view. */
  readonly learnViewRequest = signal<{ view: LearnView; nonce: number } | null>(null);
  readonly activitySearch = signal('');
  readonly activitySearchPlaceholder = $localize`:@@featureInitiatives-activitySearch:Search activity`;
  readonly search = signal('');
  /** Prefill of the step form when an action elsewhere starts a step (overview, documents, work items, learn). */
  readonly startRequest = signal<InitiativeStartRequest | null>(null);

  readonly createOpen = signal(false);
  readonly createTitleValue = signal('');
  readonly createIntent = signal('');
  readonly createPath = signal<InitiativePath>('epic');

  readonly settingsOpen = signal(false);
  readonly settingsDraft = signal<{
    title: string;
    path: InitiativePath;
    state: InitiativeState;
    defaultAgentId: string;
    defaultModel: string;
    prerequisiteSatisfiedAt: 'built' | 'done';
    autoRelease: boolean;
  } | null>(null);
  readonly deleteOpen = signal(false);

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

    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const tab = params.get('tab') as InitiativeTab | null;

      const next = tab && TABS.includes(tab) ? tab : DEFAULT_TAB;

      this.selectedId.set(params.get('initiativeId')?.trim() || null);
      this.tab.set(next);
      // A request (open a modal, a view) is meant for the tab it opened; leaving the tab drops it, so coming back
      // later does not open the modal again (the tab's component is created anew each time).
      if (next !== 'runs') this.startRequest.set(null);
      if (next !== 'work') {
        this.focusRequest.set(null);
        this.transferRequest.set(null);
      }
      if (next !== 'learn') this.learnViewRequest.set(null);
    });

    // Workspace: environments, list and the live board of its room.
    this.effectiveClientId$
      .pipe(
        filter((clientId): clientId is string => !!clientId),
        switchMap((clientId) => {
          this.agentsFacade.loadClientAgents(clientId);
          this.facade.load(clientId, this.search());

          return this.socketFacade.ensureConnectedAndSetClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    toObservable(this.search)
      .pipe(skip(1), debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        const clientId = this.effectiveClientId();

        if (clientId) {
          this.facade.load(clientId, search);
        }
      });

    effect(() => {
      const id = this.selectedId();

      untracked(() => this.facade.select(id));
    });

    // An initiative this user created opens right away.
    this.facade.createdId$
      .pipe(
        skip(1),
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(
        (id) =>
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { initiativeId: id, tab: null },
            queryParamsHandling: 'merge',
          }),
      );
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

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  // --- navigation ---------------------------------------------------------------------------------------------

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
    void this.router.navigate(['/initiatives', client.id]);
  }

  onSelect(row: InitiativeDto): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { initiativeId: row.id, tab: null },
      queryParamsHandling: 'merge',
    });
  }

  onClose(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { initiativeId: null, tab: null },
      queryParamsHandling: 'merge',
    });
  }

  onRowAction(row: InitiativeDto, action: string): void {
    if (action === 'open') {
      this.onSelect(row);
    } else if (action === 'copy-id') {
      fpcCopyText(row.id);
    }
  }

  onTabChange(tab: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab ?? null },
      queryParamsHandling: 'merge',
    });
  }

  onRefresh(): void {
    const clientId = this.effectiveClientId();
    const id = this.selectedId();

    if (clientId) {
      this.facade.load(clientId, this.search());
    }

    if (id) {
      this.facade.reload(id);
    }
  }

  /** Another action asks for a step (prefills the guided steps tab). */
  onStartStep(request: InitiativeStartRequest): void {
    this.startRequest.set({ ...request, nonce: Date.now() });
    this.onTabChange('runs');
  }

  onNavigateTab(tab: InitiativeTab): void {
    this.onTabChange(tab);
  }

  onOpenLearn(view: LearnView): void {
    this.learnViewRequest.set({ view, nonce: Date.now() });
    this.onTabChange('learn');
  }

  onOpenTransfer(epicId: string | null): void {
    this.transferRequest.set({ epicId, nonce: Date.now() });
    this.onTabChange('work');
  }

  onOpenWorkItem(itemId: string): void {
    this.focusRequest.set({ itemId, nonce: Date.now() });
    this.onTabChange('work');
  }

  onCopyReference(longSha: string): void {
    fpcCopyText(`initiative:${longSha}`);
  }

  onDismissError(): void {
    this.facade.clearError();
  }

  // --- create / settings / delete --------------------------------------------------------------------------------

  openCreate(): void {
    this.createTitleValue.set('');
    this.createIntent.set('');
    this.createPath.set('epic');
    this.createOpen.set(true);
  }

  submitCreate(): void {
    const clientId = this.effectiveClientId();
    const title = this.createTitleValue().trim();

    if (!clientId || !title) {
      return;
    }

    this.facade.run({
      type: 'createInitiative',
      dto: { clientId, title, intent: this.createIntent().trim() || undefined, path: this.createPath() },
    });
    this.createOpen.set(false);
  }

  openSettings(initiative: InitiativeDto): void {
    this.settingsDraft.set({
      title: initiative.title,
      path: initiative.path,
      state: initiative.state,
      defaultAgentId: initiative.defaultAgentId ?? '',
      defaultModel: initiative.defaultModel ?? '',
      prerequisiteSatisfiedAt: initiative.prerequisiteSatisfiedAt,
      autoRelease: initiative.autoRelease,
    });
    this.settingsOpen.set(true);
  }

  patchSettings(patch: Partial<NonNullable<ReturnType<typeof this.settingsDraft>>>): void {
    const draft = this.settingsDraft();

    if (draft) {
      this.settingsDraft.set({ ...draft, ...patch });
    }
  }

  submitSettings(initiative: InitiativeDto): void {
    const draft = this.settingsDraft();

    if (!draft || !draft.title.trim()) {
      return;
    }

    this.facade.run({
      type: 'updateInitiative',
      id: initiative.id,
      dto: {
        expectedVersion: initiative.version,
        title: draft.title.trim(),
        path: draft.path,
        state: draft.state,
        defaultAgentId: draft.defaultAgentId || null,
        defaultModel: draft.defaultModel.trim() || null,
        prerequisiteSatisfiedAt: draft.prerequisiteSatisfiedAt,
        autoRelease: draft.autoRelease,
      },
    });
    this.settingsOpen.set(false);
  }

  onPhase(initiative: InitiativeDto, phase: InitiativePhase): void {
    if (phase !== initiative.phase) {
      this.facade.run({
        type: 'updateInitiative',
        id: initiative.id,
        dto: { expectedVersion: initiative.version, phase },
      });
    }
  }

  confirmDelete(initiative: InitiativeDto): void {
    this.facade.run({ type: 'deleteInitiative', id: initiative.id });
    this.deleteOpen.set(false);
    this.onClose();
  }

  /** Conflict: reload everything of the initiative (unsaved edits in editors stay until discarded). */
  onLoadLatest(): void {
    this.facade.clearError();
    this.onRefresh();
  }

  phaseIndex(phase: InitiativePhase): number {
    return INITIATIVE_PHASES.indexOf(phase);
  }

  agentName(agentId: string | null | undefined): string {
    if (!agentId) {
      return '—';
    }

    return resolveNamedDisplayLabel(this.agents().find((agent) => agent.id === agentId)?.name ?? agentId);
  }

  actorLabel(row: InitiativeActivityDto): string {
    if (row.actorType === 'ai') {
      return $localize`:@@featureInitiatives-actorAgent:Agent` + (row.agentId ? ` ${this.agentName(row.agentId)}` : '');
    }

    if (row.actorType === 'system') {
      return $localize`:@@featureInitiatives-actorSystem:System`;
    }

    return row.actorEmail ?? row.actorUserId ?? '—';
  }
}

/** Tone of an activity entry (outcomes stand out; everything else is neutral). */
function activityTone(actionType: string): 'success' | 'danger' | 'primary' | 'neutral' {
  if (/ACCEPTED|RELEASED|TRANSFERRED|PUBLISHED/.test(actionType)) {
    return 'success';
  }

  if (/FAILED|DELETED|REJECTED/.test(actionType)) {
    return 'danger';
  }

  if (/STARTED|CREATED/.test(actionType)) {
    return 'primary';
  }

  return 'neutral';
}
