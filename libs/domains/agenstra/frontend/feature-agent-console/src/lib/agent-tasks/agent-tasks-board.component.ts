import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentTasksFacade,
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
  FpcAccordionComponent,
  FpcAccordionItemComponent,
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcInfiniteScrollDirective,
  FpcListAppendFooterComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  EMPTY,
  type Observable,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
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

import {
  agentTaskRunStatusBadgeColor,
  agentTaskRunStatusLabel,
  agentTaskRunTriggerLabel,
  agentTaskSchedulePresets,
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
    CommonModule,
    FormsModule,
    RouterModule,
    AgentChatEventRowComponent,
    FpcAccordionComponent,
    FpcAccordionItemComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcInfiniteScrollDirective,
    FpcListAppendFooterComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
  ],
  templateUrl: './agent-tasks-board.component.html',
  styleUrls: ['./agent-tasks-board.component.scss'],
})
export class AgentTasksBoardComponent implements AfterViewInit {
  readonly pageTitle = $localize`:@@featureAgentTasks-title:Tasks`;
  readonly switchWorkspaceTitle = $localize`:@@featureAgentTasks-switchWorkspaceTitle:Switch workspace`;
  readonly newTaskTitle = $localize`:@@featureAgentTasks-newTaskTitle:New task`;
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
  readonly allowedHandoffAgentsLabel = $localize`:@@featureAgentTasks-allowedHandoffAgentsLabel:Allowed handoff agents`;
  readonly allowedHandoffAgentsHint = $localize`:@@featureAgentTasks-allowedHandoffAgentsHint:Runs may hand off work to these agents of the workspace without asking; their responses are processed by the unattended run with all permissions. Leave empty to keep runs from handing off.`;
  readonly openHandoffChatLabel = $localize`:@@featureAgentTasks-openHandoffChat:Open handoff chat`;

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly agentTasksFacade = inject(AgentTasksFacade);
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

  readonly visibleTasks = computed(() => {
    const agentId = this.agentFilter();

    return agentId ? this.tasks().filter((task) => task.agentId === agentId) : this.tasks();
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
  /** Expanded by default: the requested run, otherwise the newest one. */
  readonly expandedRunId = computed(() => this.requestedRunId() ?? this.sessionHistory()[0]?.run.id ?? null);
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
    const agentName = card.agentName || $localize`:@@featureAgentTasks-handoffUnknownAgent:another agent`;

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
    return value ? new Date(value).toLocaleString() : '—';
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

  onSelectTask(task: AgentTaskResponseDto): void {
    this.requestedRunId.set(null);
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
