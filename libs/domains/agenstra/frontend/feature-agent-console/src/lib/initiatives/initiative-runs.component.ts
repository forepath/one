import { CommonModule } from '@angular/common';
import { Component, LOCALE_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  InitiativesFacade,
  type AgentResponseDto,
  type InitiativeDto,
  type InitiativeRunDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  INITIATIVE_PHASES,
  INITIATIVE_STEPS,
  RUN_STYLES,
  findInitiativeStep,
  type InitiativePhase,
  type InitiativeRunMode,
  type InitiativeRunStyle,
  type InitiativeStepKey,
  type InitiativeTurnDecision,
  type InitiativeTurnFinding,
  type InitiativeTurnStatus,
  type InitiativeTurnUnknown,
  type InitiativeTurnWorkItem,
  type StepAvailability,
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
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  fpcCopyText,
  fpcFormatDateTime,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { agCopyIdItem, agOpenItem } from '../shared/data-list';

import {
  findingSeverityLabel,
  findingSeverityTone,
  initiativeArtifactTypeLabel,
  initiativePhaseLabel,
  initiativeRoleLabel,
  initiativeStepLabel,
  initiativeTableTone,
  runModeLabel,
  runStatusLabel,
  runStatusTone,
  runStyleLabel,
  unknownResolutionLabel,
  verdictLabel,
  verdictTone,
  workItemKindLabel,
  initiativeStepNeedLabel,
} from './initiative-labels';
import { InitiativeModelSelectComponent } from './initiative-model-select.component';
import { filterInitiativeRows } from './initiative-table-search';

import { InitiativeMarkdownRenderer } from './initiative-markdown';

/** Request to start a step (from the sidebar, documents, work items or learn); `nonce` re-applies the same request. */
export interface InitiativeStartRequest {
  step: InitiativeStepKey;
  workItemId?: string;
  mode?: InitiativeRunMode;
  findingIds?: string[];
  nonce?: number;
}

const ACTIVE_STATUSES: readonly string[] = ['pending', 'working', 'needs_input', 'ready'];

/** Result rows of the nested tables (results carry no ids; the position is stable for one result). */
type ResultFindingRow = InitiativeTurnFinding & { id: string };
type ResultDecisionRow = InitiativeTurnDecision & { id: string };
type ResultUnknownRow = InitiativeTurnUnknown & { id: string };
type InitiativeTurnProposalLike = InitiativeTurnStatus['proposal'];

/**
 * Guided steps: a role of the method works with the user in a hidden, read-only session of an environment. The runs
 * are a searchable table; an open run replaces it inside the tab (the page sidebar stays next to it). The
 * conversation is live for every member of the workspace; one turn at a time; a person accepts the result.
 */
@Component({
  selector: 'framework-initiative-runs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBackLinkComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    InitiativeModelSelectComponent,
    FpcTableCellDirective,
  ],
  providers: [InitiativeMarkdownRenderer],
  templateUrl: './initiative-runs.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
        min-width: 0;
      }
      .run-view {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .run-view__body {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
      }
      .run-turn {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .run-turn--agent {
        background: var(--bs-tertiary-bg);
      }
      .run-turn__header {
        padding-bottom: 0.5rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color-translucent);
      }
      .run-result__draft {
        overflow-wrap: anywhere;
      }
      .run-turn__text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      /* Radio cards (ForePath report pages): transparent card with the shared border; the chosen one carries the
         primary border on the subtle primary fill. Theme tokens only, so they read the same in light and dark. */
      .run-step-option {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        padding: 0.75rem 1rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: var(--bs-border-radius-lg, 0.5rem);
        background: transparent;
        cursor: pointer;
        transition:
          border-color 0.15s ease-in-out,
          background-color 0.15s ease-in-out;
      }
      .run-step-option:hover:not(.run-step-option--disabled) {
        border-color: var(--bs-primary-border-subtle);
      }
      .run-step-option:has(input:checked) {
        border-color: var(--bs-primary);
        background: var(--bs-primary-bg-subtle);
      }
      .run-step-option:has(input:focus-visible) {
        box-shadow: 0 0 0 0.25rem rgba(var(--bs-primary-rgb), 0.25);
      }
      .run-step-option--disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .run-step-option__copy {
        min-width: 0;
      }
      .run-step-option__title {
        font-weight: 600;
        margin-bottom: 0.125rem;
      }
      .run-step-option__help {
        color: var(--bs-secondary-color);
      }
      .run-step-option__hint {
        color: var(--bs-warning-text-emphasis);
      }
    `,
  ],
})
export class InitiativeRunsComponent {
  readonly initiative = input.required<InitiativeDto>();
  readonly agents = input<AgentResponseDto[]>([]);
  readonly startRequest = input<InitiativeStartRequest | null>(null);

  private readonly facade = inject(InitiativesFacade);
  private readonly locale = inject(LOCALE_ID);
  readonly markdown = inject(InitiativeMarkdownRenderer);

  readonly runs = toSignal(this.facade.runs$, { initialValue: [] as InitiativeRunDto[] });
  readonly query = signal('');
  readonly visibleRuns = computed(() => filterInitiativeRows(this.runs(), this.query(), this.columns));
  readonly openRun = toSignal(this.facade.openRun$, { initialValue: null });
  readonly workItems = toSignal(this.facade.workItems$, { initialValue: null });
  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });

  readonly phases = INITIATIVE_PHASES;
  readonly styles = RUN_STYLES;
  readonly stepLabel = initiativeStepLabel;
  readonly roleLabel = initiativeRoleLabel;
  readonly phaseLabel = initiativePhaseLabel;
  readonly statusLabel = runStatusLabel;
  readonly statusTone = runStatusTone;
  readonly modeLabel = runModeLabel;
  readonly styleLabel = runStyleLabel;
  readonly resolutionLabel = unknownResolutionLabel;
  readonly severityLabel = findingSeverityLabel;
  readonly severityTone = findingSeverityTone;
  readonly verdictLabel = verdictLabel;
  readonly verdictTone = verdictTone;
  readonly kindLabel = workItemKindLabel;

  readonly tableLabel = $localize`:@@featureInitiatives-runTableLabel:Guided steps`;
  readonly searchPlaceholder = $localize`:@@featureInitiatives-runSearch:Search guided steps`;
  readonly startTitle = $localize`:@@featureInitiatives-startHeading:Start a guided step`;
  readonly backTitle = $localize`:@@featureInitiatives-runBack:Back to guided steps`;
  readonly itemsLabel = $localize`:@@featureInitiatives-runItemsHeading:Proposed work items`;
  readonly findingsLabel = $localize`:@@featureInitiatives-runFindingsHeading:Findings`;
  readonly decisionsLabel = $localize`:@@featureInitiatives-runDecisionsHeading:Decisions`;
  readonly unknownsLabel = $localize`:@@featureInitiatives-runUnknownsHeading:Open questions of the epic`;

  readonly columns: FpcTableColumn<InitiativeRunDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (run) => ({ label: runStatusLabel(run.status), tone: initiativeTableTone(runStatusTone(run.status)) }),
    },
    {
      id: 'step',
      label: $localize`:@@featureInitiatives-runColStep:Step`,
      value: (run) => initiativeStepLabel(run.step),
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@featureInitiatives-runColRole:Role`,
      value: (run) => initiativeRoleLabel(this.stepRole(run.step)),
      priority: 2,
    },
    {
      id: 'target',
      label: $localize`:@@featureInitiatives-runColTarget:Target`,
      value: (run) => this.targetLabel(run),
      priority: 2,
    },
    {
      id: 'environment',
      label: $localize`:@@featureInitiatives-fieldEnvironment:Environment`,
      value: (run) => this.agentName(run.agentId),
      priority: 3,
    },
    {
      id: 'mode',
      label: $localize`:@@featureInitiatives-fieldMode:Mode`,
      value: (run) => runModeLabel(run.mode),
      priority: 3,
      hidden: true,
    },
    {
      id: 'style',
      label: $localize`:@@featureInitiatives-fieldStyle:Style`,
      value: (run) => runStyleLabel(run.style),
      priority: 3,
      hidden: true,
    },
    {
      id: 'started',
      label: $localize`:@@featureInitiatives-runColStarted:Started`,
      value: (run) => run.createdAt,
      priority: 2,
    },
  ];

  readonly rowMenu = (run: InitiativeRunDto): FpcMenuItem[] => {
    const items: FpcMenuItem[] = [agOpenItem()];

    if (this.isAcceptable(run)) {
      items.push({ id: 'accept', label: $localize`:@@featureInitiatives-acceptResult:Accept result`, icon: 'check2' });
    }

    if (run.status === 'failed') {
      items.push({ id: 'retry', label: $localize`:@@featureInitiatives-retry:Retry`, icon: 'arrow-clockwise' });
    }

    if (run.status === 'working' || run.status === 'pending') {
      items.push({
        id: 'cancel',
        label: $localize`:@@featureInitiatives-runCancelMenu:Cancel run`,
        icon: 'stop-circle',
      });
    }

    items.push(agCopyIdItem());

    if (ACTIVE_STATUSES.includes(run.status) || run.status === 'failed') {
      items.push({
        id: 'discard',
        label: $localize`:@@featureInitiatives-discardRun:Discard`,
        icon: 'x-circle',
        danger: true,
      });
    }

    return items;
  };

  // --- result of the open run -------------------------------------------------------------------------------------
  readonly result = computed(() => this.openRun()?.result ?? null);
  readonly resultFacts = computed<FpcKeyValueItem[]>(() => {
    const result = this.result();
    const facts: FpcKeyValueItem[] = [];

    if (result?.verdict) {
      facts.push({
        key: 'verdict',
        label: $localize`:@@featureInitiatives-verdict:Verdict`,
        value: verdictLabel(result.verdict),
      });
    }

    if (result?.epic) {
      facts.push({
        key: 'epicRequirements',
        label: $localize`:@@featureInitiatives-epicRequirements:Epic requirements`,
        value: result.epic.requirements,
      });

      if (result.epic.doneWhen) {
        facts.push({
          key: 'epicDoneWhen',
          label: $localize`:@@featureInitiatives-fieldDoneWhen:Done when`,
          value: result.epic.doneWhen,
        });
      }
    }

    return facts;
  });
  readonly resultFindings = computed<ResultFindingRow[]>(() =>
    (this.result()?.findings ?? []).map((finding, index) => ({ ...finding, id: `finding-${index}` })),
  );
  readonly resultDecisions = computed<ResultDecisionRow[]>(() =>
    (this.result()?.decisions ?? []).map((decision, index) => ({ ...decision, id: `decision-${index}` })),
  );
  readonly resultUnknowns = computed<ResultUnknownRow[]>(() =>
    (this.result()?.epic?.unknowns ?? []).map((unknown, index) => ({ ...unknown, id: `unknown-${index}` })),
  );
  readonly workItemRowId = (row: InitiativeTurnWorkItem): string => row.key;

  /** Size of a proposed change, as facts (documents, work item changes, decisions). */
  proposalFacts(proposal: NonNullable<InitiativeTurnProposalLike>): FpcKeyValueItem[] {
    return [
      {
        key: 'documents',
        label: $localize`:@@featureInitiatives-runProposalDocuments:Documents`,
        value: proposal.artifacts.length,
      },
      {
        key: 'items',
        label: $localize`:@@featureInitiatives-runProposalItems:Work item changes`,
        value: proposal.workItems.length,
      },
      {
        key: 'decisions',
        label: $localize`:@@featureInitiatives-runProposalDecisions:Decisions`,
        value: proposal.decisions.length,
      },
    ];
  }
  readonly resultItemColumns: FpcTableColumn<InitiativeTurnWorkItem>[] = [
    {
      id: 'key',
      label: $localize`:@@featureInitiatives-runColKey:Key`,
      value: (row) => row.key,
      mono: true,
      width: '6rem',
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@featureInitiatives-runColType:Type`,
      value: (row) => workItemKindLabel(row.kind),
      width: '7rem',
      priority: 2,
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-fieldTitle:Title`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'after',
      label: $localize`:@@featureInitiatives-runColAfter:After`,
      value: (row) => row.after.join(', '),
      priority: 2,
    },
    {
      id: 'verify',
      label: $localize`:@@featureInitiatives-verify:Verify`,
      value: (row) => row.verify ?? '',
      priority: 3,
      sortable: false,
    },
  ];
  readonly resultFindingColumns: FpcTableColumn<ResultFindingRow>[] = [
    {
      id: 'severity',
      label: $localize`:@@featureInitiatives-runColSeverity:Severity`,
      type: 'state',
      iconOnly: false,
      state: (row) => ({
        label: findingSeverityLabel(row.severity),
        tone: initiativeTableTone(findingSeverityTone(row.severity)),
      }),
    },
    {
      id: 'body',
      label: $localize`:@@featureInitiatives-runColFinding:Finding`,
      value: (row) => row.body,
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'item',
      label: $localize`:@@featureInitiatives-runColWorkItem:Work item`,
      value: (row) => row.itemKey ?? '',
      mono: true,
      width: '7rem',
      priority: 2,
    },
  ];
  readonly resultDecisionColumns: FpcTableColumn<ResultDecisionRow>[] = [
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-runColDecision:Decision`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'body',
      label: $localize`:@@featureInitiatives-colDetails:Details`,
      value: (row) => row.body,
      priority: 2,
      sortable: false,
    },
  ];
  readonly resultUnknownColumns: FpcTableColumn<ResultUnknownRow>[] = [
    {
      id: 'question',
      label: $localize`:@@featureInitiatives-runColQuestion:Question`,
      value: (row) => row.question,
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'resolution',
      label: $localize`:@@featureInitiatives-runColResolution:Resolution`,
      value: (row) => unknownResolutionLabel(row.resolution),
      priority: 1,
    },
  ];

  // --- start modal ----------------------------------------------------------------------------------------------
  readonly formOpen = signal(false);
  readonly formStep = signal<InitiativeStepKey>('prd');
  readonly formMode = signal<InitiativeRunMode | ''>('');
  readonly formStyle = signal<InitiativeRunStyle>('coaching');
  readonly formAgentId = signal('');
  readonly formModel = signal('');
  readonly formEpicId = signal('');
  readonly formMessage = signal('');
  readonly formFindingIds = signal<string[]>([]);
  readonly formDefinition = computed(() => findInitiativeStep(this.formStep()));
  readonly formAvailability = computed(() => this.availability(this.formStep()));
  readonly epics = computed(() =>
    (this.workItems()?.items ?? []).filter((item) => item.kind === 'epic' && item.status !== 'dropped'),
  );
  readonly formValid = computed(() => {
    const definition = this.formDefinition();

    return (
      !!definition &&
      this.formAvailability()?.available !== false &&
      !!(this.formAgentId() || this.initiative().defaultAgentId) &&
      (definition.target !== 'epic' || !!this.formEpicId())
    );
  });

  // --- open run -------------------------------------------------------------------------------------------------
  readonly selectedRunId = signal<string | null>(null);
  readonly message = signal('');
  readonly answerable = computed(() => {
    const run = this.openRun();

    return !!run && (run.status === 'needs_input' || run.status === 'ready');
  });
  readonly acceptable = computed(() => {
    const run = this.openRun();

    return !!run && this.isAcceptable(run);
  });
  readonly active = computed(() => {
    const run = this.openRun();

    return !!run && ACTIVE_STATUSES.includes(run.status);
  });

  constructor() {
    effect(() => {
      const request = this.startRequest();

      if (request) {
        untracked(() => this.openForm(request));
      }
    });

    effect(() => {
      const id = this.selectedRunId();

      untracked(() => this.facade.openRun(id));
    });

    // A run started or answered by this user opens.
    effect(() => {
      const run = this.openRun();

      untracked(() => {
        if (run && run.id !== this.selectedRunId()) {
          this.selectedRunId.set(run.id);
        }
      });
    });
  }

  agentName(agentId: string | null | undefined): string {
    if (!agentId) {
      return '';
    }

    return resolveNamedDisplayLabel(this.agents().find((agent) => agent.id === agentId)?.name ?? agentId);
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '');
  }

  epicLabel(epicId: string | null): string {
    const epic = (this.workItems()?.items ?? []).find((item) => item.id === epicId);

    return epic ? `${epic.key} ${epic.title}` : '';
  }

  /** The epic a run works on, else the document type its step writes. */
  targetLabel(run: InitiativeRunDto): string {
    const epic = this.epicLabel(run.targetWorkItemId);

    if (epic) {
      return epic;
    }

    const output = findInitiativeStep(run.step)?.output;

    return output?.kind === 'artifact' ? initiativeArtifactTypeLabel(output.artifactType) : '';
  }

  stepRole(step: InitiativeStepKey) {
    return findInitiativeStep(step)?.role ?? 'analyst';
  }

  stepsOf(phase: InitiativePhase) {
    return INITIATIVE_STEPS.filter((step) => step.phase === phase);
  }

  availability(step: InitiativeStepKey) {
    return this.overview()?.steps.find((entry) => entry.step === step);
  }

  stepHint(step: InitiativeStepKey): string {
    const availability = this.availability(step);

    return availability ? [...this.missingTexts(availability), ...this.warningTexts(availability)].join('\n') : '';
  }

  /** Unmet hard needs as human-readable sentences (structured needs; the English texts of older servers as fallback). */
  missingTexts(availability: StepAvailability): string[] {
    return availability.missingNeeds?.map((need) => initiativeStepNeedLabel(need, true)) ?? availability.missing;
  }

  warningTexts(availability: StepAvailability): string[] {
    return availability.warningNeeds?.map((need) => initiativeStepNeedLabel(need, false)) ?? availability.warnings;
  }

  isAcceptable(run: InitiativeRunDto): boolean {
    return !!run.result && (run.status === 'ready' || run.status === 'needs_input');
  }

  openForm(request?: InitiativeStartRequest): void {
    const initiative = this.initiative();
    const step = request?.step ?? this.formStep();

    this.formMode.set(request?.mode ?? '');
    this.formStyle.set('coaching');
    this.formAgentId.set(initiative.defaultAgentId ?? this.agents()[0]?.id ?? '');
    this.formModel.set(initiative.defaultModel ?? '');
    this.formMessage.set('');
    this.formFindingIds.set(request?.findingIds ?? []);
    this.chooseStep(step, request?.workItemId);
    this.formOpen.set(true);
  }

  chooseStep(step: InitiativeStepKey, workItemId?: string): void {
    const definition = findInitiativeStep(step);

    this.formStep.set(step);

    if (!definition?.modes.includes(this.formMode() as InitiativeRunMode)) {
      this.formMode.set('');
    }

    this.formEpicId.set(
      workItemId ??
        (definition?.target === 'epic'
          ? this.epics().some((epic) => epic.id === this.formEpicId())
            ? this.formEpicId()
            : (this.epics()[0]?.id ?? '')
          : ''),
    );
  }

  submitForm(): void {
    const definition = this.formDefinition();

    if (!definition || !this.formValid()) {
      return;
    }

    this.facade.run({
      type: 'startRun',
      initiativeId: this.initiative().id,
      dto: {
        step: definition.key,
        ...(this.formMode() ? { mode: this.formMode() as InitiativeRunMode } : {}),
        style: this.formStyle(),
        ...(this.formAgentId() ? { agentId: this.formAgentId() } : {}),
        ...(this.formModel().trim() ? { model: this.formModel().trim() } : {}),
        ...(definition.target === 'epic' && this.formEpicId() ? { workItemId: this.formEpicId() } : {}),
        ...(this.formMessage().trim() ? { message: this.formMessage().trim() } : {}),
        ...(this.formFindingIds().length ? { findingIds: this.formFindingIds() } : {}),
      },
    });
    this.formOpen.set(false);
  }

  select(run: InitiativeRunDto): void {
    this.selectedRunId.set(run.id);
  }

  close(): void {
    this.selectedRunId.set(null);
    this.message.set('');
  }

  onRowAction(run: InitiativeRunDto, action: string): void {
    switch (action) {
      case 'open':
        this.select(run);
        break;
      case 'accept':
        this.accept(run);
        break;
      case 'retry':
        this.retry(run);
        break;
      case 'cancel':
        this.cancel(run);
        break;
      case 'discard':
        this.discard(run);
        break;
      case 'copy-id':
        fpcCopyText(run.id);
        break;
    }
  }

  send(): void {
    const run = this.openRun();
    const message = this.message().trim();

    if (!run || !message || !this.answerable()) {
      return;
    }

    this.facade.run({ type: 'messageRun', runId: run.id, message });
    this.message.set('');
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.send();
    }
  }

  accept(run: InitiativeRunDto): void {
    this.facade.run({ type: 'acceptRun', runId: run.id, expectedVersion: run.version });
  }

  discard(run: InitiativeRunDto): void {
    this.facade.run({ type: 'discardRun', runId: run.id, expectedVersion: run.version });
  }

  cancel(run: InitiativeRunDto): void {
    this.facade.run({ type: 'cancelRun', runId: run.id, expectedVersion: run.version });
  }

  retry(run: InitiativeRunDto): void {
    this.facade.run({ type: 'retryRun', runId: run.id });
  }
}
