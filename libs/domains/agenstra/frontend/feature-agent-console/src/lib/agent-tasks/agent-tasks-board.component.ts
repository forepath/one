import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  LOCALE_ID,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentTasksFacade,
  AgentTasksService,
  AgentsFacade,
  ClientsFacade,
  ContainerSocketFacade,
  isAgentTaskRunActive,
  type AgentModelsMap,
  type AgentResponseDto,
  type AgentTaskResponseDto,
  type AgentTaskRunResponseDto,
  type ClientResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
  FPC_DEFAULT_PAGE_SIZE,
  fpcFormatDateTime,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcSectionColumnComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  EMPTY,
  type Observable,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  of,
  pairwise,
  skip,
  switchMap,
  take,
} from 'rxjs';

import { AgentChatEventRowComponent } from '../chat/agent-chat-event-row.component';
import { AgentChatHandoffNavigationService } from '../chat/agent-chat-handoff-navigation.service';
import type { AgentChatHandoffCardView, AgentChatHandoffLink } from '../chat/agent-chat-handoff-view';
import { sanitizeAndTrustMarkdownHtml } from '../chat/chat-markdown-html';
import { resolveNamedDisplayLabel } from '../display-name.util';
import { agBulkSummary, agCopyIdItem, agOpenItem, AG_DL_CANCEL, AG_DL_DELETE } from '../shared/data-list';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

import {
  agentTaskRunState,
  agentTaskRunStatusBadgeColor,
  agentTaskRunStatusLabel,
  agentTaskRunTriggerLabel,
  agentTaskSchedulePresets,
  agentTaskState,
  describeAgentTaskSchedule,
} from './agent-task-labels';
import { buildAgentTaskTranscriptSegments } from './agent-task-transcript-view';

type EditorMode = 'create' | 'edit';

interface MarkdownParser {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

/** While a run of the selected task is in progress, its stored history is refreshed this often. */
const RUNNING_HISTORY_REFRESH_MS = 10_000;

/**
 * Recurring agent tasks of a workspace (`/tasks/:clientId`). Same workspace selection flow as tickets and
 * knowledge; tasks can also be created / changed by the agent itself, which arrives live over the clients socket.
 */
@Component({
  selector: 'framework-agent-tasks-board',
  standalone: true,
  imports: [
    FpcSectionRowComponent,
    FpcSectionColumnComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    AgentChatEventRowComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
  ],
  templateUrl: './agent-tasks-board.component.html',
  styleUrls: ['./agent-tasks-board.component.scss'],
})
export class AgentTasksBoardComponent implements AfterViewInit {
  readonly pageTitle = $localize`:@@featureAgentTasks-title:Tasks`;
  readonly switchWorkspaceTitle = $localize`:@@featureAgentTasks-switchWorkspaceTitle:Switch workspace`;
  readonly newTaskTitle = $localize`:@@featureAgentTasks-newTaskTitle:Create task`;
  readonly runNowTitle = $localize`:@@featureAgentTasks-runNowTitle:Run now`;
  readonly editTitle = $localize`:@@featureAgentTasks-editTitle:Edit task`;
  readonly deleteTitle = $localize`:@@featureAgentTasks-deleteTitle:Delete task`;
  readonly refreshTitle = $localize`:@@featureAgentTasks-refreshTitle:Refresh`;
  readonly schedulePresets = agentTaskSchedulePresets();
  readonly runStatusLabel = agentTaskRunStatusLabel;
  readonly runStatusBadgeColor = agentTaskRunStatusBadgeColor;
  readonly runTriggerLabel = agentTaskRunTriggerLabel;
  readonly describeSchedule = describeAgentTaskSchedule;
  readonly isRunActive = isAgentTaskRunActive;
  readonly allowedHandoffAgentsLabel = $localize`:@@featureAgentTasks-allowedHandoffAgentsLabel:Allowed handoff environments`;
  readonly allowedHandoffAgentsHint = $localize`:@@featureAgentTasks-allowedHandoffAgentsHint:Runs may hand off work to these environments of the workspace without asking; their responses are processed by the unattended run with all permissions. Leave empty to keep runs from handing off.`;
  readonly openHandoffChatLabel = $localize`:@@featureAgentTasks-openHandoffChat:Open handoff chat`;
  readonly tasksLabel = $localize`:@@featureAgentTasks-tasksTable:Tasks`;
  readonly taskSearchPlaceholder = $localize`:@@featureAgentTasks-searchTasks:Search tasks`;
  readonly environmentFilterLabel = $localize`:@@featureAgentTasks-agentFilterLabel:Environment`;
  readonly runNowLabel = $localize`:@@featureAgentTasks-runNowTitle:Run now`;
  readonly pauseLabel = $localize`:@@featureAgentTasks-bulkPause:Pause`;
  readonly resumeLabel = $localize`:@@featureAgentTasks-bulkResume:Resume`;
  readonly deleteLabel = AG_DL_DELETE;
  readonly cancelLabel = AG_DL_CANCEL;
  readonly bulkDeleteTitle = $localize`:@@featureAgentTasks-bulkDeleteTitle:Delete tasks`;
  readonly moreActionsTitle = $localize`:@@featureAgentTasks-moreActions:More actions`;
  readonly backToTasksTitle = $localize`:@@featureAgentTasks-backToTasks:Back to tasks`;
  readonly sessionHistoryLabel = $localize`:@@featureAgentTasks-runsTable:Runs`;

  /** Rail table (decision 7): State (approval / paused / last run) · Task · Environment · Schedule · Last / next run. */
  readonly taskColumns: FpcTableColumn<AgentTaskResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAgentTasks-colState:State`,
      type: 'state',
      state: (task) => agentTaskState(task),
    },
    {
      id: 'title',
      label: $localize`:@@featureAgentTasks-colTask:Task`,
      value: (task) => task.title,
      required: true,
      priority: 1,
    },
    {
      id: 'environment',
      label: $localize`:@@featureAgentTasks-colEnvironment:Environment`,
      value: (task) => this.agentName(task.agentId),
      priority: 1,
    },
    {
      id: 'schedule',
      label: $localize`:@@featureAgentTasks-colSchedule:Schedule`,
      value: (task) => describeAgentTaskSchedule(task.cronExpression, task.timezone),
      priority: 2,
    },
    {
      id: 'lastRun',
      label: $localize`:@@featureAgentTasks-colLastRun:Last run`,
      value: (task) => (task.lastRunAt ? this.formatDate(task.lastRunAt) : ''),
      priority: 3,
      hidden: true,
    },
    {
      id: 'nextRun',
      label: $localize`:@@featureAgentTasks-colNextRun:Next run`,
      value: (task) => (task.nextRunAt ? this.formatDate(task.nextRunAt) : ''),
      priority: 3,
      hidden: true,
    },
  ];
  readonly taskRowMenu = (task: AgentTaskResponseDto): FpcMenuItem[] => [
    agOpenItem(),
    { id: 'run', label: this.runNowLabel, icon: 'play-fill', disabled: this.isRunRequested(task.id) },
    task.enabled
      ? { id: 'pause', label: this.pauseLabel, icon: 'pause-circle' }
      : { id: 'resume', label: this.resumeLabel, icon: 'play-circle' },
    ...(task.approvalStatus === 'pending'
      ? [{ id: 'approve', label: $localize`:@@featureAgentTasks-approve:Approve`, icon: 'check2-circle' }]
      : []),
    { id: 'edit', label: this.editTitle, icon: 'pencil' },
    agCopyIdItem(),
    { id: 'delete', label: this.deleteTitle, icon: 'trash', danger: true },
  ];
  readonly runColumns: FpcTableColumn<AgentTaskRunResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAgentTasks-colState:State`,
      type: 'state',
      state: (run) => agentTaskRunState(run.status),
    },
    {
      id: 'started',
      label: $localize`:@@featureAgentTasks-colStarted:Started`,
      value: (run) => run.startedAt,
      required: true,
      priority: 1,
    },
    {
      id: 'trigger',
      label: $localize`:@@featureAgentTasks-colTrigger:Trigger`,
      value: (run) => agentTaskRunTriggerLabel(run.trigger),
      priority: 1,
    },
    {
      id: 'finished',
      label: $localize`:@@featureAgentTasks-colFinished:Finished`,
      value: (run) => (run.finishedAt ? this.formatDate(run.finishedAt) : ''),
      priority: 3,
    },
  ];
  readonly runRowMenu = (run: AgentTaskRunResponseDto): FpcMenuItem[] => [
    {
      id: 'toggle',
      label:
        this.expandedRunId() === run.id
          ? $localize`:@@featureAgentTasks-hideTranscript:Hide transcript`
          : $localize`:@@featureAgentTasks-showTranscript:Show transcript`,
      icon: 'chat-left-text',
    },
    agCopyIdItem(),
  ];

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly locale = inject(LOCALE_ID);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly agentTasksFacade = inject(AgentTasksFacade);
  private readonly agentTasksService = inject(AgentTasksService);
  private readonly socketsFacade = inject(ContainerSocketFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly handoffNavigation = inject(AgentChatHandoffNavigationService);
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
  readonly tasks = toSignal(this.agentTasksFacade.tasks$, { initialValue: [] as AgentTaskResponseDto[] });
  readonly loading = toSignal(this.agentTasksFacade.loading$, { initialValue: false });
  readonly saving = toSignal(this.agentTasksFacade.saving$, { initialValue: false });
  readonly error = toSignal(this.agentTasksFacade.error$, { initialValue: null });
  readonly runRequestTaskIds = toSignal(this.agentTasksFacade.runRequestTaskIds$, { initialValue: [] as string[] });
  readonly lastRunNow = toSignal(this.agentTasksFacade.lastRunNow$, { initialValue: null });

  /** Agent filter (`?agentId=`); `null` shows the tasks of every agent. */
  readonly agentFilter = signal<string | null>(null);
  readonly selectedTaskId = signal<string | null>(null);
  readonly taskSearch = signal('');
  readonly selectedTaskIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureAgentTasks-bulkDeleteMessage:Delete ${this.selectedTasks().length}:count: tasks and their run history? The agents stop running them.`,
  );
  /** Runs table: page / size over the loaded history (the store appends API pages of 10 on demand). */
  readonly runPage = signal(1);
  /** D4: 25 per page like every other table (AG-13). */
  readonly runPageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  readonly visibleTasks = computed(() => {
    const agentId = this.agentFilter();

    return agentId ? this.tasks().filter((task) => task.agentId === agentId) : this.tasks();
  });
  readonly searchedTasks = computed(() => {
    const needle = this.taskSearch().trim().toLowerCase();

    if (!needle) {
      return this.visibleTasks();
    }

    return this.visibleTasks().filter((task) =>
      [task.title, this.agentName(task.agentId), describeAgentTaskSchedule(task.cronExpression, task.timezone)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  });
  /** Selected tasks that are still listed. */
  readonly selectedTasks = computed(() => {
    const ids = new Set(this.selectedTaskIds());

    return this.tasks().filter((task) => ids.has(task.id));
  });
  readonly selectedTask = computed(() => this.tasks().find((task) => task.id === this.selectedTaskId()) ?? null);
  readonly selectedTaskRuns = toSignal(
    toObservable(this.selectedTaskId).pipe(
      switchMap((taskId) => (taskId ? this.agentTasksFacade.runs$(taskId) : of([] as AgentTaskRunResponseDto[]))),
    ),
    { initialValue: [] as AgentTaskRunResponseDto[] },
  );
  /**
   * Session history of the selected task: every run is one turn of the task's hidden session (newest first), rendered
   * like the chat (tool / thinking rows, answer) inside an expandable row.
   */
  readonly sessionHistory = computed(() =>
    this.selectedTaskRuns().map((run) => ({ run, segments: buildAgentTaskTranscriptSegments(run.transcript ?? []) })),
  );
  readonly sessionHasMore = this.selectedTaskSignal((taskId) => this.agentTasksFacade.runsHasMore$(taskId), false);
  readonly sessionAppendLoading = this.selectedTaskSignal(
    (taskId) => this.agentTasksFacade.runsAppendLoading$(taskId),
    false,
  );
  readonly sessionAppendError = this.selectedTaskSignal(
    (taskId) => this.agentTasksFacade.runsAppendError$(taskId),
    null as string | null,
  );
  /** Run requested from a chat card (`?openRunId=`); stays expanded. */
  readonly requestedRunId = signal<string | null>(null);
  /** Run to scroll to once it is rendered (cleared after scrolling). */
  readonly focusRunId = signal<string | null>(null);
  /** Run the user opened / closed in the table (`undefined`: the default below). */
  readonly toggledRunId = signal<string | null | undefined>(undefined);
  /** Collapsed on load (user, 2026-10-29); only a run requested from a chat card (`?openRunId=`) opens by itself. */
  readonly expandedRunId = computed(() => {
    const toggled = this.toggledRunId();

    return toggled !== undefined ? toggled : this.requestedRunId();
  });
  private readonly runSegmentsById = computed(
    () => new Map(this.sessionHistory().map((entry) => [entry.run.id, entry.segments] as const)),
  );
  readonly runPageRows = computed(() => {
    const size = this.runPageSize();
    const start = (this.runPage() - 1) * size;

    return this.selectedTaskRuns().slice(start, start + size);
  });
  /** Known once every run of the task is loaded (no further batch): the pager shows "1–n of N" then. */
  readonly runTotal = computed(() => (this.sessionHasMore() ? null : this.selectedTaskRuns().length));
  readonly runHasNext = computed(
    () => this.selectedTaskRuns().length > this.runPage() * this.runPageSize() || this.sessionHasMore(),
  );
  readonly effectiveWorkspace = computed(() => {
    const id = this.effectiveClientId();

    return id ? (this.clients().find((client) => client.id === id) ?? null) : null;
  });

  readonly workspaceSwitchModalOpen = signal(false);
  readonly workspaceSwitchSearch = signal('');

  readonly editorOpen = signal(false);
  readonly editorMode = signal<EditorMode>('create');
  readonly editorAgentId = signal<string | null>(null);
  readonly editorTitle = signal('');
  readonly editorPrompt = signal('');
  readonly editorCron = signal('0 9 * * *');
  readonly editorTimezone = signal(this.browserTimezone());
  readonly editorModel = signal('');
  readonly editorEnabled = signal(true);
  readonly editorAllowedHandoffAgentIds = signal<string[]>([]);
  /** Other agents of the workspace the task's runs may hand off to. */
  readonly editorHandoffAgentOptions = computed(() =>
    this.agents().filter((agent) => agent.id !== this.editorAgentId()),
  );
  readonly editorModels = toSignal(
    combineLatest([this.effectiveClientId$, toObservable(this.editorAgentId)]).pipe(
      switchMap(([clientId, agentId]) =>
        clientId && agentId ? this.agentsFacade.getClientAgentModels$(clientId, agentId) : of(null),
      ),
    ),
    { initialValue: null as AgentModelsMap | null },
  );
  readonly editorModelOptions = computed(() =>
    Object.entries(this.editorModels() ?? {}).map(([id, name]) => ({ id, name })),
  );
  readonly editorPresetValue = computed(
    () => this.schedulePresets.find((preset) => preset.cron === this.editorCron().trim())?.cron ?? '',
  );
  readonly editorValid = computed(
    () =>
      !!this.editorAgentId() &&
      !!this.editorTitle().trim() &&
      !!this.editorPrompt().trim() &&
      this.editorCron().trim().split(/\s+/).length === 5 &&
      !!this.editorModel().trim(),
  );

  readonly deleteConfirmOpen = signal(false);
  readonly taskPendingDelete = signal<AgentTaskResponseDto | null>(null);

  constructor() {
    this.clientsFacade.loadClients();

    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.agentFilter.set(params.get('agentId')?.trim() || null);

      const openTaskId = params.get('openTaskId')?.trim();

      if (openTaskId) {
        this.selectedTaskId.set(openTaskId);
      }

      const openRunId = params.get('openRunId')?.trim() || null;

      this.requestedRunId.set(openRunId);
      this.focusRunId.set(openRunId);
    });

    this.effectiveClientId$
      .pipe(
        filter((clientId): clientId is string => !!clientId),
        switchMap((clientId) => {
          this.agentTasksFacade.load(clientId);
          this.agentsFacade.loadClientAgents(clientId);

          return this.ensureSocketClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // First page when a task is opened; later task updates (run started / finished) merge the newest page into the
    // pages already scrolled in instead of resetting the infinite scroll.
    let historyTaskId: string | null = null;

    effect(() => {
      const clientId = this.effectiveClientId();
      const task = this.selectedTask();

      if (!clientId || !task) {
        historyTaskId = null;

        return;
      }

      this.agentTasksFacade.loadRuns(clientId, task.agentId, task.id, { refresh: historyTaskId === task.id });
      historyTaskId = task.id;
    });

    effect((onCleanup) => {
      const clientId = this.effectiveClientId();
      const task = this.selectedTask();

      // A run waiting for a handoff response continues on its own (the response arrives in its session).
      if (!clientId || !task || !isAgentTaskRunActive(task.lastRunStatus)) {
        return;
      }

      const timer = setInterval(
        () => this.agentTasksFacade.loadRuns(clientId, task.agentId, task.id, { refresh: true }),
        RUNNING_HISTORY_REFRESH_MS,
      );

      onCleanup(() => clearInterval(timer));
    });

    effect(() => {
      const runId = this.focusRunId();
      const loaded = this.sessionHistory().some((entry) => entry.run.id === runId);

      if (runId && loaded) {
        setTimeout(() =>
          document.getElementById(`agent-task-run-${runId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        );
        this.focusRunId.set(null);
      }
    });

    // Runs table: fetch further history pages until the shown page is filled (or the history ends).
    effect(() => {
      const needed = this.runPage() * this.runPageSize();

      if (
        this.selectedTaskRuns().length < needed &&
        this.sessionHasMore() &&
        !this.sessionAppendLoading() &&
        !this.sessionAppendError()
      ) {
        untracked(() => this.onLoadMoreRuns());
      }
    });

    void import('marked').then((module) => this.markdownParser.set(module.marked));

    effect(() => {
      const clientId = this.effectiveClientId();
      const agentId = this.editorAgentId();

      if (clientId && agentId && this.editorOpen()) {
        this.agentsFacade.loadClientAgentModels(clientId, agentId);
      }
    });

    // Default the model to the first one offered for the chosen agent.
    effect(() => {
      const options = this.editorModelOptions();

      if (this.editorOpen() && !this.editorModel() && options.length > 0) {
        this.editorModel.set(options[0].id);
      }
    });

    // Close the editor / delete confirmation once the mutation finished without an error.
    // Handoff embeds / cards of the run history: task runs are shown here, chats on the agent's chat page.
    this.handoffNavigation.requests$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((link) => this.openHandoffLink(link));

    this.agentTasksFacade.saving$.pipe(pairwise(), takeUntilDestroyed(this.destroyRef)).subscribe(([was, is]) => {
      if (was && !is && !this.error()) {
        this.editorOpen.set(false);
        this.deleteConfirmOpen.set(false);
        this.taskPendingDelete.set(null);
      }
    });
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

  /** Names of the agents a task may hand off to (ids of agents no longer in the workspace are shown as is). */
  handoffAgentNames(task: AgentTaskResponseDto): string[] {
    return (task.allowedHandoffAgentIds ?? []).map((agentId) => this.agentName(agentId));
  }

  isEditorHandoffAgentAllowed(agentId: string): boolean {
    return this.editorAllowedHandoffAgentIds().includes(agentId);
  }

  onToggleEditorHandoffAgent(agentId: string, allowed: boolean): void {
    const current = this.editorAllowedHandoffAgentIds().filter((id) => id !== agentId);

    this.editorAllowedHandoffAgentIds.set(allowed ? [...current, agentId] : current);
  }

  handoffResponseHeading(card: AgentChatHandoffCardView): string {
    const agentName = card.agentName || $localize`:@@featureAgentTasks-handoffUnknownAgent:another environment`;

    return $localize`:@@featureAgentTasks-handoffResponseHeading:Response from ${agentName}:agentName:`;
  }

  handoffStatusLabel(status: 'completed' | 'failed' | undefined): string {
    return status === 'failed'
      ? $localize`:@@featureAgentTasks-handoffStatusFailed:Failed`
      : $localize`:@@featureAgentTasks-handoffStatusCompleted:Completed`;
  }

  onOpenHandoffLink(link: AgentChatHandoffLink): void {
    this.handoffNavigation.open(link);
  }

  isRunRequested(taskId: string): boolean {
    return this.runRequestTaskIds().includes(taskId);
  }

  runSegments(run: AgentTaskRunResponseDto) {
    return this.runSegmentsById().get(run.id) ?? [];
  }

  onToggleRun(run: AgentTaskRunResponseDto): void {
    this.toggledRunId.set(this.expandedRunId() === run.id ? null : run.id);
  }

  onRunRowAction(run: AgentTaskRunResponseDto, action: string): void {
    if (action === 'toggle') {
      this.onToggleRun(run);
    } else if (action === 'copy-id') {
      fpcCopyText(run.id);
    }
  }

  onTaskRowAction(task: AgentTaskResponseDto, action: string): void {
    switch (action) {
      case 'open':
        this.onSelectTask(task);
        break;
      case 'run':
        this.onRunNow(task);
        break;
      case 'pause':
        this.onToggleEnabled(task, false);
        break;
      case 'resume':
        this.onToggleEnabled(task, true);
        break;
      case 'approve':
        this.onApprove(task);
        break;
      case 'edit':
        this.openEditEditor(task);
        break;
      case 'copy-id':
        fpcCopyText(task.id);
        break;
      case 'delete':
        this.onRequestDelete(task);
        break;
    }
  }

  onBulkRunNow(): void {
    void this.runTaskBulk(this.selectedTasks(), (clientId, task) =>
      firstValueFrom(this.agentTasksService.runNow(clientId, task.agentId, task.id)),
    );
  }

  onBulkEnabled(enabled: boolean): void {
    void this.runTaskBulk(
      this.selectedTasks().filter((task) => task.enabled !== enabled),
      (clientId, task) =>
        firstValueFrom(this.agentTasksService.updateTask(clientId, task.agentId, task.id, { enabled })),
    );
  }

  onConfirmBulkDelete(): void {
    const tasks = this.selectedTasks();

    if (tasks.some((task) => task.id === this.selectedTaskId())) {
      this.selectedTaskId.set(null);
    }

    void this.runTaskBulk(tasks, (clientId, task) =>
      firstValueFrom(this.agentTasksService.deleteTask(clientId, task.agentId, task.id)),
    );
  }

  /**
   * Bulk action as a client fan-out over the single-task endpoints (3.38 D8: the server checks every task); the list
   * reloads afterwards, the result shows per task.
   */
  private async runTaskBulk(
    tasks: readonly AgentTaskResponseDto[],
    run: (clientId: string, task: AgentTaskResponseDto) => Promise<unknown>,
  ): Promise<void> {
    const clientId = this.effectiveClientId();

    if (!clientId || tasks.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(tasks, (task) => run(clientId, task));

      this.bulkResult.set(agBulkSummary(result, (task) => task.title));
      this.selectedTaskIds.set(result.failed.concat(result.denied).map((task) => task.id));
      this.agentTasksFacade.load(clientId);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** Runs table refresh: reloads the newest history page (further pages follow on demand). */
  onRefreshRuns(): void {
    const clientId = this.effectiveClientId();
    const task = this.selectedTask();

    if (clientId && task) {
      this.agentTasksFacade.loadRuns(clientId, task.agentId, task.id, { refresh: true });
    }
  }

  onLoadMoreRuns(): void {
    const clientId = this.effectiveClientId();
    const task = this.selectedTask();

    if (clientId && task) {
      this.agentTasksFacade.loadMoreRuns(clientId, task.agentId, task.id);
    }
  }

  renderMarkdown(text: string): SafeHtml | null {
    const parser = this.markdownParser();

    if (!parser) {
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

  formatDate(value: string | null): string {
    // Shared date-time format, never seconds (AG-20, X-04).
    return fpcFormatDateTime(value, this.locale, '—');
  }

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
    this.selectedTaskId.set(null);
    this.clientsFacade.setActiveClient(client.id);
    void this.router.navigate(['/tasks', client.id]);
  }

  onAgentFilterChange(agentId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { agentId: agentId || null, openTaskId: null },
      queryParamsHandling: 'merge',
    });
    this.selectedTaskId.set(null);
  }

  /** Closes the open task (phone back button): the list becomes the view again; drops a deep-linked `openTaskId`. */
  onCloseTask(): void {
    this.selectedTaskId.set(null);
    this.requestedRunId.set(null);
    this.toggledRunId.set(undefined);

    if (this.route.snapshot.queryParamMap.has('openTaskId') || this.route.snapshot.queryParamMap.has('openRunId')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { openTaskId: null, openRunId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  onSelectTask(task: AgentTaskResponseDto): void {
    this.requestedRunId.set(null);
    this.toggledRunId.set(undefined);
    this.runPage.set(1);
    this.selectedTaskId.set(task.id);
  }

  onRefresh(): void {
    const clientId = this.effectiveClientId();

    if (clientId) {
      this.agentTasksFacade.load(clientId);
    }
  }

  openCreateEditor(): void {
    this.agentTasksFacade.clearError();
    this.editorMode.set('create');
    this.editorAgentId.set(this.agentFilter() ?? this.agents()[0]?.id ?? null);
    this.editorTitle.set('');
    this.editorPrompt.set('');
    this.editorCron.set('0 9 * * *');
    this.editorTimezone.set(this.browserTimezone());
    this.editorModel.set('');
    this.editorEnabled.set(true);
    this.editorAllowedHandoffAgentIds.set([]);
    this.editorOpen.set(true);
  }

  openEditEditor(task: AgentTaskResponseDto): void {
    this.agentTasksFacade.clearError();
    this.editorMode.set('edit');
    this.editorAgentId.set(task.agentId);
    this.editorTitle.set(task.title);
    this.editorPrompt.set(task.prompt);
    this.editorCron.set(task.cronExpression);
    this.editorTimezone.set(task.timezone);
    this.editorModel.set(task.model);
    this.editorEnabled.set(task.enabled);
    this.editorAllowedHandoffAgentIds.set([...(task.allowedHandoffAgentIds ?? [])]);
    this.editorOpen.set(true);
  }

  onEditorAgentChange(agentId: string): void {
    this.editorAgentId.set(agentId || null);
    this.editorModel.set('');
    // A task never hands off to its own agent.
    this.editorAllowedHandoffAgentIds.set(this.editorAllowedHandoffAgentIds().filter((id) => id !== agentId));
  }

  onPresetChange(cron: string): void {
    if (cron) {
      this.editorCron.set(cron);
    }
  }

  onSaveEditor(): void {
    const clientId = this.effectiveClientId();
    const agentId = this.editorAgentId();

    if (!clientId || !agentId || !this.editorValid()) {
      return;
    }

    const dto = {
      title: this.editorTitle().trim(),
      prompt: this.editorPrompt().trim(),
      cronExpression: this.editorCron().trim(),
      timezone: this.editorTimezone().trim() || 'UTC',
      model: this.editorModel().trim(),
      enabled: this.editorEnabled(),
      // Always sent: a complete save is what approves the task (handoff targets are approved content too). Agents
      // that left the workspace are dropped.
      allowedHandoffAgentIds: this.editorAllowedHandoffAgentIds().filter((id) =>
        this.editorHandoffAgentOptions().some((agent) => agent.id === id),
      ),
    };
    const task = this.selectedTask();

    if (this.editorMode() === 'edit' && task) {
      this.agentTasksFacade.update(clientId, task.agentId, task.id, dto);
    } else {
      this.agentTasksFacade.create(clientId, agentId, dto);
    }
  }

  onToggleEnabled(task: AgentTaskResponseDto, enabled: boolean): void {
    const clientId = this.effectiveClientId();

    if (clientId && enabled !== task.enabled) {
      this.agentTasksFacade.update(clientId, task.agentId, task.id, { enabled });
    }
  }

  onApprove(task: AgentTaskResponseDto): void {
    const clientId = this.effectiveClientId();

    if (clientId) {
      // Bound to the version on screen: if the agent changed the task meanwhile the approval is refused.
      this.agentTasksFacade.approve(clientId, task.agentId, task.id, task.updatedAt);
    }
  }

  onRunNow(task: AgentTaskResponseDto): void {
    const clientId = this.effectiveClientId();

    if (clientId) {
      this.agentTasksFacade.runNow(clientId, task.agentId, task.id);
    }
  }

  onRequestDelete(task: AgentTaskResponseDto): void {
    this.taskPendingDelete.set(task);
    this.deleteConfirmOpen.set(true);
  }

  onConfirmDelete(): void {
    const clientId = this.effectiveClientId();
    const task = this.taskPendingDelete();

    if (clientId && task) {
      if (this.selectedTaskId() === task.id) {
        this.selectedTaskId.set(null);
      }

      this.agentTasksFacade.delete(clientId, task.agentId, task.id);
    }
  }

  onCancelDelete(): void {
    this.deleteConfirmOpen.set(false);
    this.taskPendingDelete.set(null);
  }

  onDismissError(): void {
    this.agentTasksFacade.clearError();
  }

  /**
   * Task runs (handoffs made by a run) are opened on this page; chats on the agent's chat page, which selects the
   * chat once it is shown.
   */
  private openHandoffLink(link: AgentChatHandoffLink): void {
    const clientId = this.effectiveClientId();

    if (!clientId) {
      return;
    }

    if (link.taskRun) {
      void this.router.navigate(['/tasks', clientId], {
        queryParams: { agentId: link.agentId, openTaskId: link.taskRun.taskId, openRunId: link.taskRun.runId },
      });

      return;
    }

    this.handoffNavigation.defer(link);
    void this.router.navigate(['/clients', clientId, 'agents', link.agentId]);
  }

  /** Live task / run updates arrive on the clients socket of the workspace room (`setClient` dedupes). */
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

  /** Signal of a per-task store value for the selected task. */
  private selectedTaskSignal<T>(select: (taskId: string) => Observable<T>, initialValue: T) {
    return toSignal(
      toObservable(this.selectedTaskId).pipe(switchMap((taskId) => (taskId ? select(taskId) : of(initialValue)))),
      { initialValue },
    );
  }

  private browserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
}
