import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  ChatSessionsService,
  InitiativesFacade,
  type AgentResponseDto,
  type ChatSessionResponseDto,
  type InitiativeDto,
  type InitiativeUnknownDto,
  type InitiativeWorkItemDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  UNKNOWN_RESOLUTIONS,
  type InitiativeStepKey,
  type UnknownResolution,
  type WorkItemKind,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  fpcCopyText,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { AG_DL_DELETE, agCopyIdItem, agOpenItem } from '../shared/data-list';

import {
  initiativeStepLabel,
  initiativeTableTone,
  unknownResolutionLabel,
  verdictLabel,
  verdictTone,
  workItemKindLabel,
  workItemPriorityLabel,
  workItemStatusLabel,
  workItemStatusTone,
} from './initiative-labels';
import { InitiativeModelSelectComponent } from './initiative-model-select.component';
import type { InitiativeStartRequest } from './initiative-runs.component';

type WorkItemPriority = 'low' | 'medium' | 'high' | 'critical';

interface ItemDraft {
  id: string | null;
  kind: WorkItemKind;
  parentId: string | null;
  version: number;
  title: string;
  requirements: string;
  verify: string;
  doneWhen: string;
  refined: boolean;
  planCheckpoint: boolean;
  doneCheckpoint: boolean;
  priority: WorkItemPriority;
  locked: boolean;
}

const EPIC_STEPS: readonly InitiativeStepKey[] = ['refine-epic', 'incept-stories', 'readiness-review', 'retrospective'];
const PRIORITIES: readonly WorkItemPriority[] = ['low', 'medium', 'high', 'critical'];

/**
 * Work items in build order (one searchable table grouped by epic; actions in the ⋮ row menu) with dependencies,
 * questions and checkpoints; transfer to tickets, release of ready stories, story plans and the epic steps (refine,
 * incept, readiness, retrospective).
 */
@Component({
  selector: 'framework-initiative-work-items',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    InitiativeModelSelectComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './initiative-work-items.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
    `,
  ],
})
export class InitiativeWorkItemsComponent {
  readonly initiative = input.required<InitiativeDto>();
  readonly agents = input<AgentResponseDto[]>([]);
  /** Opens the edit modal of an item (e.g. from the initiative sidebar); the nonce repeats a request. */
  readonly focusRequest = input<{ itemId: string; nonce: number } | null>(null);
  /** Open the transfer modal (What's next); `epicId` preselects that epic only. Each nonce is applied once. */
  readonly transferRequest = input<{ epicId: string | null; nonce: number } | null>(null);
  readonly startStep = output<InitiativeStartRequest>();

  private readonly facade = inject(InitiativesFacade);
  private readonly chatSessions = inject(ChatSessionsService);
  private readonly router = inject(Router);

  readonly tableLabel = $localize`:@@featureInitiatives-wiTableLabel:Work items`;
  readonly searchPlaceholder = $localize`:@@featureInitiatives-wiSearch:Search work items`;
  readonly addEpicTitle = $localize`:@@featureInitiatives-addEpic:Add epic`;
  readonly sliceTitle = $localize`:@@featureInitiatives-sliceWithAgent:Slice with the agent`;
  readonly transferTitle = $localize`:@@featureInitiatives-transfer:Transfer to tickets`;
  readonly questionsLabel = $localize`:@@featureInitiatives-openQuestions:Open questions`;
  readonly itemQuestionsLabel = $localize`:@@featureInitiatives-questions:Questions`;
  readonly openTicketLabel = $localize`:@@featureInitiatives-wiOpenTicket:Open ticket`;

  readonly workItems = toSignal(this.facade.workItems$, { initialValue: null });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });
  readonly lastBuildResult = toSignal(this.facade.lastBuildResult$, { initialValue: null });
  readonly kindLabel = workItemKindLabel;
  readonly statusLabel = workItemStatusLabel;
  readonly statusTone = workItemStatusTone;
  readonly verdictLabel = verdictLabel;
  readonly verdictTone = verdictTone;
  readonly priorityLabel = workItemPriorityLabel;
  readonly resolutionLabel = unknownResolutionLabel;
  readonly resolutions = UNKNOWN_RESOLUTIONS;
  readonly priorities = PRIORITIES;

  readonly items = computed(() => this.workItems()?.items ?? []);
  readonly epics = computed(() =>
    this.items()
      .filter((item) => item.kind === 'epic')
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );
  readonly keyOf = computed(() => new Map(this.items().map((item) => [item.id, item.key])));
  readonly readyCount = computed(
    () =>
      this.items().filter((item) => item.kind !== 'epic' && item.ticketId && item.status === 'draft' && item.ready)
        .length,
  );
  readonly untransferredCount = computed(
    () => this.items().filter((item) => !item.ticketId && item.status !== 'dropped').length,
  );
  /** Initiative-level questions that are not settled yet (item questions live in the item). */
  readonly openQuestions = computed(() => (this.workItems()?.unknowns ?? []).filter((unknown) => !unknown.resolvedAt));
  readonly releaseTitle = computed(
    () => $localize`:@@featureInitiatives-wiReleaseTitle:Release ready stories (${this.readyCount()}:count:)`,
  );
  readonly questionsTitle = computed(
    () => $localize`:@@featureInitiatives-wiQuestionsTitle:Open questions (${this.openQuestions().length}:count:)`,
  );

  // --- table ------------------------------------------------------------------------------------------------------
  readonly search = signal('');
  /** Build order: every epic followed by its items; filtered by the search (key, title, requirements, type, state). */
  readonly rows = computed(() => {
    const query = this.search().trim().toLowerCase();
    const ordered = this.epics().flatMap((epic) => [epic, ...this.childrenOf(epic.id)]);

    if (!query) {
      return ordered;
    }

    return ordered.filter((item) =>
      [item.key, item.title, item.requirements, workItemKindLabel(item.kind), workItemStatusLabel(item.status)]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });
  readonly groupBy = (item: InitiativeWorkItemDto): string =>
    item.kind === 'epic' ? item.id : (item.parentId ?? item.id);
  readonly groupLabel = (key: string): string => {
    const epic = this.items().find((item) => item.id === key);

    return epic ? `${epic.key} ${epic.title}` : key;
  };
  readonly columns: FpcTableColumn<InitiativeWorkItemDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (item) => ({
        label: workItemStatusLabel(item.status),
        tone: initiativeTableTone(workItemStatusTone(item.status)),
      }),
    },
    {
      id: 'key',
      label: $localize`:@@featureInitiatives-wiColKey:Key`,
      value: (item) => item.key,
      mono: true,
      width: '6rem',
      priority: 1,
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-wiColTitle:Title`,
      value: (item) => item.title,
      required: true,
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@featureInitiatives-wiColType:Type`,
      value: (item) => workItemKindLabel(item.kind),
      priority: 2,
    },
    {
      id: 'waiting',
      label: $localize`:@@featureInitiatives-waitingFor:Waiting for`,
      value: (item) => (item.ready ? '' : item.blockedBy.join(', ')),
      priority: 2,
    },
    {
      id: 'ticket',
      label: $localize`:@@featureInitiatives-wiColTicket:Ticket`,
      value: (item) => (item.ticketId ? 1 : 0),
      sortable: false,
      priority: 3,
    },
    {
      id: 'priority',
      label: $localize`:@@featureInitiatives-wiColPriority:Priority`,
      value: (item) => workItemPriorityLabel(item.priority),
      priority: 3,
    },
    {
      id: 'questions',
      label: $localize`:@@featureInitiatives-questions:Questions`,
      value: (item) => item.unknowns.filter((unknown) => !unknown.resolvedAt).length,
      hidden: true,
      priority: 3,
    },
  ];
  readonly questionColumns: FpcTableColumn<InitiativeUnknownDto>[] = [
    {
      id: 'question',
      label: $localize`:@@featureInitiatives-wiColQuestion:Question`,
      value: (unknown) => unknown.question,
      required: true,
      priority: 1,
    },
    {
      id: 'resolution',
      label: $localize`:@@featureInitiatives-wiColResolution:Resolution`,
      value: (unknown) => unknownResolutionLabel(unknown.resolution),
      priority: 2,
    },
    {
      id: 'answer',
      label: $localize`:@@featureInitiatives-wiColAnswer:Answer`,
      value: (unknown) => unknown.answer ?? '',
      priority: 2,
    },
  ];
  readonly rowMenu = (item: InitiativeWorkItemDto): FpcMenuItem[] => {
    const menu: FpcMenuItem[] = [agOpenItem()];
    const siblings = this.siblingsOf(item);
    const index = siblings.findIndex((sibling) => sibling.id === item.id);

    if (item.kind === 'epic') {
      EPIC_STEPS.forEach((step, stepIndex) =>
        menu.push({
          id: `step:${step}`,
          label: initiativeStepLabel(step),
          icon: 'stars',
          heading: stepIndex === 0 ? $localize`:@@featureInitiatives-wiMenuSteps:Guided steps` : undefined,
          dividerBefore: stepIndex === 0,
          disabled: step === 'incept-stories' && !item.refined,
          title:
            step === 'incept-stories' && !item.refined
              ? $localize`:@@featureInitiatives-wiInceptNeedsRefined:Refine the epic first`
              : undefined,
        }),
      );
      menu.push({
        id: 'add-story',
        label: $localize`:@@featureInitiatives-addStory:Add story`,
        icon: 'plus-lg',
        dividerBefore: true,
      });
    }

    menu.push(
      {
        id: 'move-up',
        label: $localize`:@@featureInitiatives-moveUp:Move up`,
        icon: 'arrow-up',
        disabled: index <= 0,
        dividerBefore: item.kind !== 'epic',
      },
      {
        id: 'move-down',
        label: $localize`:@@featureInitiatives-moveDown:Move down`,
        icon: 'arrow-down',
        disabled: index < 0 || index >= siblings.length - 1,
      },
      {
        id: 'dependencies',
        label: $localize`:@@featureInitiatives-wiMenuDependencies:Dependencies…`,
        icon: 'diagram-2',
      },
    );

    if (item.ticketId && item.status === 'draft' && item.ready && item.kind !== 'epic') {
      menu.push({ id: 'release', label: $localize`:@@featureInitiatives-release:Release`, icon: 'play' });
    }

    if (item.ticketId && !item.locked && item.kind !== 'epic') {
      menu.push({ id: 'plan', label: $localize`:@@featureInitiatives-wiMenuPlan:Plan story`, icon: 'list-check' });
    }

    if (item.status === 'built') {
      menu.push({ id: 'mark-done', label: $localize`:@@featureInitiatives-markDone:Mark done`, icon: 'check2' });
    }

    if (item.ticketId) {
      menu.push({ id: 'open-ticket', label: this.openTicketLabel, icon: 'ticket-perforated' });
    }

    menu.push(agCopyIdItem());

    if (!item.locked && item.status !== 'dropped') {
      menu.push({
        id: 'drop',
        label: $localize`:@@featureInitiatives-drop:Drop`,
        icon: 'x-circle',
        danger: true,
        dividerBefore: true,
      });
    }

    if (!item.ticketId) {
      menu.push({
        id: 'delete',
        label: AG_DL_DELETE,
        icon: 'trash',
        danger: true,
        dividerBefore: item.locked || item.status === 'dropped',
      });
    }

    return menu;
  };
  readonly questionMenu = (unknown: InitiativeUnknownDto): FpcMenuItem[] => [
    ...(unknown.resolvedAt
      ? []
      : [{ id: 'settle', label: $localize`:@@featureInitiatives-settle:Settle`, icon: 'check2' }]),
    {
      id: 'remove',
      label: $localize`:@@featureInitiatives-remove:Remove`,
      icon: 'trash',
      danger: true,
      dividerBefore: true,
    },
  ];

  // --- modals -----------------------------------------------------------------------------------------------------
  readonly editDraft = signal<ItemDraft | null>(null);
  readonly depsItem = signal<InitiativeWorkItemDto | null>(null);
  readonly depsSelection = signal<string[]>([]);
  readonly transferOpen = signal(false);
  readonly transferEpicIds = signal<string[]>([]);
  readonly transferAutomation = signal(false);
  readonly transferModel = signal('');
  readonly planItem = signal<InitiativeWorkItemDto | null>(null);
  readonly planAgentId = signal('');
  readonly planChats = signal<ChatSessionResponseDto[]>([]);
  readonly planChatId = signal('');
  readonly planInstructions = signal('');
  readonly questionsOpen = signal(false);
  readonly unknownQuestion = signal('');
  readonly unknownResolution = signal<UnknownResolution>('settle_now');
  /** The question being settled (its answer is entered below the questions table). */
  readonly settleUnknownId = signal<string | null>(null);
  readonly settleAnswer = signal('');
  readonly deleteItem = signal<InitiativeWorkItemDto | null>(null);
  /** The build result whose "not everything was done" notice was dismissed. */
  readonly dismissedResult = signal<unknown>(null);
  readonly skippedReasons = computed(() => {
    const result = this.lastBuildResult();

    return result && result !== this.dismissedResult() ? result.skipped : [];
  });

  private handledFocusNonce: number | null = null;

  private handledTransferNonce: number | null = null;

  constructor() {
    effect(() => {
      const request = this.transferRequest();
      const loaded = !!this.workItems();

      untracked(() => {
        if (!request || !loaded || request.nonce === this.handledTransferNonce) {
          return;
        }

        this.handledTransferNonce = request.nonce;
        this.openTransfer();

        if (request.epicId && this.epics().some((epic) => epic.id === request.epicId)) {
          this.transferEpicIds.set([request.epicId]);
        }
      });
    });

    // Focus requests wait for the tree (an item of a just-opened initiative is not known yet).
    effect(() => {
      const request = this.focusRequest();
      const items = this.items();

      untracked(() => {
        if (!request || request.nonce === this.handledFocusNonce) {
          return;
        }

        const item = items.find((entry) => entry.id === request.itemId);

        if (item) {
          this.handledFocusNonce = request.nonce;
          this.openEdit(item);
        }
      });
    });
  }

  dependenciesTitle(item: InitiativeWorkItemDto): string {
    return $localize`:@@featureInitiatives-wiDependenciesTitle:Dependencies of ${item.key}:key:`;
  }

  siblingsOf(item: InitiativeWorkItemDto): InitiativeWorkItemDto[] {
    return item.parentId ? this.childrenOf(item.parentId) : this.epics();
  }

  onRowAction(item: InitiativeWorkItemDto, action: string): void {
    if (action.startsWith('step:')) {
      this.epicStep(item, action.slice('step:'.length) as InitiativeStepKey);

      return;
    }

    switch (action) {
      case 'open':
        this.openEdit(item);
        break;
      case 'add-story':
        this.openCreate('story', item.id);
        break;
      case 'move-up':
        this.move(item, -1);
        break;
      case 'move-down':
        this.move(item, 1);
        break;
      case 'dependencies':
        this.openDependencies(item);
        break;
      case 'release':
        this.release(item);
        break;
      case 'plan':
        this.openPlan(item);
        break;
      case 'mark-done':
        this.setStatus(item, 'done');
        break;
      case 'open-ticket':
        this.openTicket(item);
        break;
      case 'copy-id':
        fpcCopyText(item.id);
        break;
      case 'drop':
        this.setStatus(item, 'dropped');
        break;
      case 'delete':
        this.deleteItem.set(item);
        break;
    }
  }

  openTicket(item: InitiativeWorkItemDto): void {
    if (item.ticketId) {
      void this.router.navigate(['/tickets', this.initiative().clientId], {
        queryParams: { openTicketId: item.ticketId },
      });
    }
  }

  dismissSkipped(): void {
    this.dismissedResult.set(this.lastBuildResult());
  }

  // --- questions ----------------------------------------------------------------------------------------------------

  openQuestionsModal(): void {
    this.resetQuestionForms();
    this.questionsOpen.set(true);
  }

  resetQuestionForms(): void {
    this.unknownQuestion.set('');
    this.unknownResolution.set('settle_now');
    this.settleUnknownId.set(null);
    this.settleAnswer.set('');
  }

  onQuestionAction(unknown: InitiativeUnknownDto, action: string): void {
    if (action === 'settle') {
      this.settleUnknownId.set(unknown.id);
      this.settleAnswer.set('');
    } else if (action === 'remove') {
      this.removeUnknown(unknown.id);
    }
  }

  questionText(unknownId: string | null, list: readonly InitiativeUnknownDto[]): string {
    return list.find((unknown) => unknown.id === unknownId)?.question ?? '';
  }

  childrenOf(epicId: string): InitiativeWorkItemDto[] {
    return this.items()
      .filter((item) => item.parentId === epicId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  afterKeys(item: InitiativeWorkItemDto): string {
    return item.prerequisiteIds.map((id) => this.keyOf().get(id) ?? '?').join(', ');
  }

  agentName(agentId: string): string {
    return resolveNamedDisplayLabel(this.agents().find((agent) => agent.id === agentId)?.name ?? agentId);
  }

  stepLabel(step: InitiativeStepKey): string {
    return initiativeStepLabel(step);
  }

  epicStep(epic: InitiativeWorkItemDto, step: InitiativeStepKey): void {
    this.startStep.emit({ step, workItemId: epic.id });
  }

  epicStepAll(step: InitiativeStepKey): void {
    this.startStep.emit({ step });
  }

  // --- edit / create ------------------------------------------------------------------------------------------------

  openCreate(kind: WorkItemKind, parentId: string | null): void {
    this.editDraft.set({
      id: null,
      kind,
      parentId,
      version: 0,
      title: '',
      requirements: '',
      verify: '',
      doneWhen: '',
      refined: false,
      planCheckpoint: false,
      doneCheckpoint: false,
      priority: 'medium',
      locked: false,
    });
  }

  openEdit(item: InitiativeWorkItemDto): void {
    this.editDraft.set({
      id: item.id,
      kind: item.kind,
      parentId: item.parentId,
      version: item.version,
      title: item.title,
      requirements: item.requirements,
      verify: item.verify,
      doneWhen: item.doneWhen,
      refined: item.refined,
      planCheckpoint: item.planCheckpoint,
      doneCheckpoint: item.doneCheckpoint,
      priority: item.priority,
      locked: item.locked,
    });
    this.resetQuestionForms();
  }

  patchDraft(patch: Partial<ItemDraft>): void {
    const draft = this.editDraft();

    if (draft) {
      this.editDraft.set({ ...draft, ...patch });
    }
  }

  saveDraft(): void {
    const draft = this.editDraft();

    if (!draft || !draft.title.trim()) {
      return;
    }

    if (draft.id) {
      this.facade.run({
        type: 'updateWorkItem',
        itemId: draft.id,
        dto: {
          expectedVersion: draft.version,
          ...(draft.locked
            ? {}
            : {
                title: draft.title.trim(),
                requirements: draft.requirements,
                verify: draft.verify,
                doneWhen: draft.doneWhen,
              }),
          ...(draft.kind === 'epic' ? { refined: draft.refined } : {}),
          planCheckpoint: draft.planCheckpoint,
          doneCheckpoint: draft.doneCheckpoint,
          priority: draft.priority,
        },
      });
    } else {
      this.facade.run({
        type: 'createWorkItem',
        initiativeId: this.initiative().id,
        dto: {
          kind: draft.kind,
          ...(draft.parentId ? { parentId: draft.parentId } : {}),
          title: draft.title.trim(),
          requirements: draft.requirements,
          verify: draft.verify,
          doneWhen: draft.doneWhen,
        },
      });
    }

    this.editDraft.set(null);
  }

  editedItem(): InitiativeWorkItemDto | undefined {
    const id = this.editDraft()?.id;

    return id ? this.items().find((item) => item.id === id) : undefined;
  }

  addUnknown(itemId: string): void {
    const question = this.unknownQuestion().trim();

    if (!question) {
      return;
    }

    this.facade.run({
      type: 'createUnknown',
      initiativeId: this.initiative().id,
      dto: { workItemId: itemId || undefined, question, resolution: this.unknownResolution() },
    });
    this.unknownQuestion.set('');
  }

  settleSelected(): void {
    const unknownId = this.settleUnknownId();
    const answer = this.settleAnswer().trim();

    if (unknownId && answer) {
      this.facade.run({ type: 'resolveUnknown', unknownId, initiativeId: this.initiative().id, answer });
      this.settleUnknownId.set(null);
      this.settleAnswer.set('');
    }
  }

  removeUnknown(unknownId: string): void {
    this.facade.run({ type: 'deleteUnknown', unknownId, initiativeId: this.initiative().id });
  }

  // --- order / dependencies / status ------------------------------------------------------------------------------

  move(item: InitiativeWorkItemDto, direction: -1 | 1): void {
    const siblings = this.siblingsOf(item);
    const index = siblings.findIndex((sibling) => sibling.id === item.id);
    const target = index + direction;

    if (target < 0 || target >= siblings.length) {
      return;
    }

    // "before" semantics: moving down means before the item after the next one (or to the end).
    const beforeId = direction === -1 ? siblings[target].id : siblings[target + 1]?.id;

    this.facade.run({
      type: 'reorderWorkItem',
      itemId: item.id,
      expectedInitiativeVersion: this.workItems()?.initiativeVersion ?? this.initiative().version,
      ...(beforeId ? { beforeId } : {}),
    });
  }

  openDependencies(item: InitiativeWorkItemDto): void {
    this.depsItem.set(item);
    this.depsSelection.set([...item.prerequisiteIds]);
  }

  dependencyCandidates(item: InitiativeWorkItemDto): InitiativeWorkItemDto[] {
    return this.items().filter((candidate) => candidate.id !== item.id && candidate.id !== item.parentId);
  }

  toggleDependency(id: string, checked: boolean): void {
    const current = this.depsSelection();

    this.depsSelection.set(checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id));
  }

  saveDependencies(): void {
    const item = this.depsItem();

    if (!item) {
      return;
    }

    this.facade.run({
      type: 'setDependencies',
      itemId: item.id,
      expectedInitiativeVersion: this.workItems()?.initiativeVersion ?? this.initiative().version,
      prerequisiteIds: this.depsSelection(),
    });
    this.depsItem.set(null);
  }

  setStatus(item: InitiativeWorkItemDto, status: 'done' | 'dropped' | 'blocked' | 'draft'): void {
    this.facade.run({ type: 'setWorkItemStatus', itemId: item.id, status });
  }

  confirmDelete(): void {
    const item = this.deleteItem();

    if (item) {
      this.facade.run({ type: 'deleteWorkItem', itemId: item.id });
    }

    this.deleteItem.set(null);
  }

  // --- build --------------------------------------------------------------------------------------------------

  openTransfer(): void {
    this.transferEpicIds.set(
      this.epics()
        .filter((epic) => epic.status !== 'dropped')
        .map((epic) => epic.id),
    );
    this.transferAutomation.set(false);
    this.transferModel.set(this.initiative().defaultModel ?? '');
    this.transferOpen.set(true);
  }

  toggleTransferEpic(id: string, checked: boolean): void {
    const current = this.transferEpicIds();

    this.transferEpicIds.set(checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id));
  }

  submitTransfer(): void {
    this.facade.run({
      type: 'transfer',
      initiativeId: this.initiative().id,
      dto: {
        epicIds: this.transferEpicIds(),
        ...(this.transferAutomation()
          ? {
              automation: {
                eligible: true,
                ...(this.transferModel().trim() ? { preferredModel: this.transferModel().trim() } : {}),
              },
            }
          : {}),
      },
    });
    this.transferOpen.set(false);
  }

  releaseAll(): void {
    this.facade.run({ type: 'release', initiativeId: this.initiative().id });
  }

  release(item: InitiativeWorkItemDto): void {
    this.facade.run({ type: 'release', initiativeId: this.initiative().id, workItemIds: [item.id] });
  }

  openPlan(item: InitiativeWorkItemDto): void {
    this.planItem.set(item);
    this.planInstructions.set('');
    this.onPlanAgent(this.initiative().defaultAgentId ?? this.agents()[0]?.id ?? '');
  }

  onPlanAgent(agentId: string): void {
    this.planAgentId.set(agentId);
    this.planChats.set([]);
    this.planChatId.set('');

    if (!agentId) {
      return;
    }

    this.chatSessions
      .listChatSessions(this.initiative().clientId, agentId, { limit: 50 })
      .pipe(catchError(() => of([] as ChatSessionResponseDto[])))
      .subscribe((chats) => {
        this.planChats.set(chats);
        this.planChatId.set(chats.find((chat) => chat.kind === 'primary')?.id ?? chats[0]?.id ?? '');
      });
  }

  submitPlan(): void {
    const item = this.planItem();

    if (!item || !this.planAgentId() || !this.planChatId()) {
      return;
    }

    this.facade.run({
      type: 'planStory',
      itemId: item.id,
      dto: {
        agentId: this.planAgentId(),
        chatId: this.planChatId(),
        ...(this.initiative().defaultModel ? { model: this.initiative().defaultModel as string } : {}),
        ...(this.planInstructions().trim() ? { instructions: this.planInstructions().trim() } : {}),
      },
    });
    this.planItem.set(null);
  }

  chatLabel(chat: ChatSessionResponseDto): string {
    return (
      chat.title?.trim() ||
      (chat.kind === 'primary' ? $localize`:@@featureInitiatives-primaryChat:Main chat` : chat.id.slice(0, 8))
    );
  }
}
