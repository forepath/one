import { CommonModule } from '@angular/common';
import { Component, LOCALE_ID, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  InitiativesFacade,
  type InitiativeDecisionDto,
  type InitiativeDto,
  type InitiativeFindingDto,
  type InitiativeProposalDto,
  type InitiativeWorkItemDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FINDING_SEVERITIES,
  RETROSPECTIVE_VERDICTS,
  type FindingSeverity,
  type RetrospectiveVerdict,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  fpcCopyText,
  fpcFormatDateTime,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { agCopyIdItem, agOpenItem } from '../shared/data-list';

import {
  decisionStatusLabel,
  decisionStatusTone,
  findingSeverityLabel,
  findingSeverityTone,
  findingSourceLabel,
  findingStatusLabel,
  initiativeArtifactTypeLabel,
  initiativeTableTone,
  proposalOriginLabel,
  proposalStatusLabel,
  proposalStatusTone,
  verdictLabel,
  verdictTone,
  workItemKindLabel,
} from './initiative-labels';
import { filterInitiativeRows } from './initiative-table-search';

import { InitiativeMarkdownRenderer } from './initiative-markdown';
import type { InitiativeStartRequest } from './initiative-runs.component';

export type LearnView = 'proposals' | 'findings' | 'retrospectives' | 'decisions';

/**
 * Learn & adjust: findings (retrospectives, reviews, automation, agents, people), change proposals (correct course; a
 * person accepts them, which may open the next iteration), decisions and retrospective verdicts.
 */
@Component({
  selector: 'framework-initiative-learn',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
  ],
  providers: [InitiativeMarkdownRenderer],
  templateUrl: './initiative-learn.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .learn-text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .learn-clamp {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        word-break: break-word;
      }
    `,
  ],
})
export class InitiativeLearnComponent {
  readonly initiative = input.required<InitiativeDto>();
  /** Another part of the page asks for a view (e.g. "What's next" → open proposals); each nonce is applied once. */
  readonly viewRequest = input<{ view: LearnView; nonce: number } | null>(null);
  readonly startStep = output<InitiativeStartRequest>();

  private readonly facade = inject(InitiativesFacade);
  private readonly locale = inject(LOCALE_ID);
  readonly markdown = inject(InitiativeMarkdownRenderer);

  readonly findings = toSignal(this.facade.findings$, { initialValue: [] as InitiativeFindingDto[] });
  readonly proposals = toSignal(this.facade.proposals$, { initialValue: [] as InitiativeProposalDto[] });
  readonly decisions = toSignal(this.facade.decisions$, { initialValue: [] as InitiativeDecisionDto[] });
  readonly workItems = toSignal(this.facade.workItems$, { initialValue: null });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });

  readonly severities = FINDING_SEVERITIES;
  readonly verdicts = RETROSPECTIVE_VERDICTS;
  readonly severityLabel = findingSeverityLabel;
  readonly severityTone = findingSeverityTone;
  readonly proposalLabel = proposalStatusLabel;
  readonly proposalTone = proposalStatusTone;
  readonly verdictLabel = verdictLabel;
  readonly verdictTone = verdictTone;
  readonly typeLabel = initiativeArtifactTypeLabel;
  readonly sourceLabel = findingSourceLabel;
  readonly findingStatus = findingStatusLabel;
  readonly originLabel = proposalOriginLabel;
  readonly decisionLabel = decisionStatusLabel;
  readonly decisionTone = decisionStatusTone;

  // --- views ---------------------------------------------------------------------------------------------------

  readonly views: readonly LearnView[] = ['proposals', 'findings', 'retrospectives', 'decisions'];
  readonly viewLabels: Record<LearnView, string> = {
    proposals: $localize`:@@featureInitiatives-learnViewProposals:Change proposals`,
    findings: $localize`:@@featureInitiatives-learnViewFindings:Findings`,
    retrospectives: $localize`:@@featureInitiatives-learnViewRetrospectives:Retrospectives`,
    decisions: $localize`:@@featureInitiatives-learnViewDecisions:Decisions`,
  };
  readonly viewIcons: Record<LearnView, string> = {
    proposals: 'file-diff',
    findings: 'flag',
    retrospectives: 'arrow-repeat',
    decisions: 'check2-square',
  };
  readonly viewSwitchLabel = $localize`:@@featureInitiatives-learnViewSwitch:What to show`;
  readonly searchPlaceholders: Record<LearnView, string> = {
    proposals: $localize`:@@featureInitiatives-learnSearchProposals:Search proposals`,
    findings: $localize`:@@featureInitiatives-learnSearchFindings:Search findings`,
    retrospectives: $localize`:@@featureInitiatives-learnSearchRetrospectives:Search epics`,
    decisions: $localize`:@@featureInitiatives-learnSearchDecisions:Search decisions`,
  };
  readonly filterLabel = $localize`:@@featureInitiatives-learnFilterShow:Show`;
  readonly correctCourseTitle = $localize`:@@featureInitiatives-correctCourse:Correct course with the agent`;
  readonly addFindingTitle = $localize`:@@featureInitiatives-addFinding:Add finding`;
  readonly addDecisionTitle = $localize`:@@featureInitiatives-addDecision:Record decision`;
  readonly proposeSelectionTitle = $localize`:@@featureInitiatives-proposeFromFindings:Propose changes for the selection`;

  /** Chosen by the user; until then Proposals when some are open, otherwise Findings. */
  private readonly chosenView = signal<LearnView | null>(null);
  private appliedViewNonce: number | null = null;
  readonly view = computed<LearnView>(
    () => this.chosenView() ?? (this.openProposals().length > 0 ? 'proposals' : 'findings'),
  );

  readonly proposalQuery = signal('');
  readonly findingQuery = signal('');
  readonly retroQuery = signal('');
  readonly decisionQuery = signal('');
  readonly proposalScope = signal<'open' | 'all'>('open');
  readonly findingScope = signal<'open' | 'all'>('open');

  readonly selectedFindingIds = signal<readonly string[]>([]);
  readonly epics = computed(() =>
    (this.workItems()?.items ?? []).filter((item) => item.kind === 'epic').sort((a, b) => a.sortOrder - b.sortOrder),
  );
  readonly openProposals = computed(() =>
    this.proposals().filter((proposal) => proposal.status === 'open' || proposal.status === 'stale'),
  );
  readonly openFindings = computed(() => this.findings().filter((finding) => finding.status === 'open'));
  readonly proposalRows = computed(() => (this.proposalScope() === 'open' ? this.openProposals() : this.proposals()));
  readonly findingRows = computed(() => (this.findingScope() === 'open' ? this.openFindings() : this.findings()));
  readonly visibleProposals = computed(() =>
    filterInitiativeRows(this.proposalRows(), this.proposalQuery(), this.proposalColumns, (row) => row.rationale),
  );
  readonly visibleFindings = computed(() =>
    filterInitiativeRows(this.findingRows(), this.findingQuery(), this.findingColumns, (row) => row.body),
  );
  readonly visibleRetros = computed(() => filterInitiativeRows(this.epics(), this.retroQuery(), this.retroColumns));
  readonly visibleDecisions = computed(() =>
    filterInitiativeRows(this.decisions(), this.decisionQuery(), this.decisionColumns, (row) => row.body),
  );
  readonly selectedOpenFindingIds = computed(() => {
    const open = new Set(this.openFindings().map((finding) => finding.id));

    return this.selectedFindingIds().filter((id) => open.has(id));
  });

  readonly counts = computed<Record<LearnView, number>>(() => ({
    proposals: this.openProposals().length,
    findings: this.openFindings().length,
    retrospectives: this.epics().length,
    decisions: this.decisions().filter((decision) => decision.status === 'proposed').length,
  }));

  // --- columns -------------------------------------------------------------------------------------------------

  readonly proposalColumns: FpcTableColumn<InitiativeProposalDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({
        label: proposalStatusLabel(row.status),
        tone: initiativeTableTone(proposalStatusTone(row.status)),
      }),
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-learnColProposal:Proposal`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'origin',
      label: $localize`:@@featureInitiatives-learnColOrigin:Proposed by`,
      value: (row) => proposalOriginLabel(row.origin),
      priority: 2,
    },
    {
      id: 'changes',
      label: $localize`:@@featureInitiatives-learnColChanges:Changes`,
      value: (row) => this.changesSummary(row),
      sortable: false,
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureInitiatives-learnColCreated:Created`,
      value: (row) => row.createdAt,
      priority: 3,
    },
    {
      id: 'decided',
      label: $localize`:@@featureInitiatives-learnColDecided:Decided`,
      value: (row) => row.decidedAt,
      priority: 3,
      hidden: true,
    },
  ];

  readonly findingColumns: FpcTableColumn<InitiativeFindingDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({
        label: findingStatusLabel(row.status),
        tone: row.status === 'open' ? 'warning' : row.status === 'converted' ? 'success' : 'neutral',
      }),
    },
    {
      id: 'severity',
      label: $localize`:@@featureInitiatives-fieldSeverity:Severity`,
      value: (row) => FINDING_SEVERITIES.indexOf(row.severity),
      priority: 1,
    },
    {
      id: 'body',
      label: $localize`:@@featureInitiatives-fieldFinding:Finding`,
      value: (row) => row.body,
      required: true,
      priority: 1,
    },
    {
      id: 'item',
      label: $localize`:@@featureInitiatives-learnColWorkItem:Work item`,
      value: (row) => this.keyOf(row.workItemId),
      mono: true,
      priority: 2,
    },
    {
      id: 'source',
      label: $localize`:@@featureInitiatives-colSource:Source`,
      value: (row) => findingSourceLabel(row.source),
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureInitiatives-learnColCreated:Created`,
      value: (row) => row.createdAt,
      priority: 3,
    },
  ];

  readonly retroColumns: FpcTableColumn<InitiativeWorkItemDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) =>
        row.retrospectiveVerdict
          ? {
              label: verdictLabel(row.retrospectiveVerdict),
              tone: initiativeTableTone(verdictTone(row.retrospectiveVerdict)),
            }
          : { label: $localize`:@@featureInitiatives-noRetro:No retrospective yet`, tone: 'neutral' },
    },
    {
      id: 'key',
      label: $localize`:@@featureInitiatives-learnColEpic:Epic`,
      value: (row) => row.key,
      mono: true,
      width: '6rem',
      priority: 1,
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-fieldTitle:Title`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'setBy',
      label: $localize`:@@featureInitiatives-learnColVerdictBy:Verdict set by`,
      value: (row) =>
        !row.retrospectiveVerdict
          ? ''
          : row.retrospectiveOverridden
            ? $localize`:@@featureInitiatives-learnVerdictByPerson:A person`
            : $localize`:@@featureInitiatives-learnVerdictByAgent:The retrospective`,
      priority: 2,
    },
  ];

  readonly decisionColumns: FpcTableColumn<InitiativeDecisionDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({
        label: decisionStatusLabel(row.status),
        tone: initiativeTableTone(decisionStatusTone(row.status)),
      }),
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-fieldDecision:Decision`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'item',
      label: $localize`:@@featureInitiatives-learnColWorkItem:Work item`,
      value: (row) => this.keyOf(row.workItemId),
      mono: true,
      priority: 2,
    },
    {
      id: 'iteration',
      label: $localize`:@@featureInitiatives-colIteration:Iteration`,
      value: (row) => row.iteration,
      align: 'end',
      priority: 3,
    },
    {
      id: 'created',
      label: $localize`:@@featureInitiatives-learnColCreated:Created`,
      value: (row) => row.createdAt,
      priority: 3,
    },
  ];

  // --- row menus -----------------------------------------------------------------------------------------------

  readonly proposalMenu = (): FpcMenuItem[] => [
    { id: 'review', label: $localize`:@@featureInitiatives-review:Review`, icon: 'eye' },
    agCopyIdItem(),
  ];

  readonly findingMenu = (row: InitiativeFindingDto): FpcMenuItem[] => [
    agOpenItem(),
    ...(row.status === 'open'
      ? [
          {
            id: 'convert',
            label: $localize`:@@featureInitiatives-toItem:New work item`,
            icon: 'plus-square',
            disabled: this.epics().length === 0,
            dividerBefore: true,
          },
          { id: 'dismiss', label: $localize`:@@featureInitiatives-dismiss:Dismiss`, icon: 'x-circle' },
        ]
      : row.status === 'dismissed'
        ? [
            {
              id: 'reopen',
              label: $localize`:@@featureInitiatives-reopen:Reopen`,
              icon: 'arrow-counterclockwise',
              dividerBefore: true,
            },
          ]
        : []),
    agCopyIdItem(),
  ];

  readonly retroMenu = (): FpcMenuItem[] => [
    { id: 'run', label: $localize`:@@featureInitiatives-runRetro:Run retrospective`, icon: 'stars' },
    ...RETROSPECTIVE_VERDICTS.map((verdict, index) => ({
      id: `verdict:${verdict}`,
      label: verdictLabel(verdict),
      heading: index === 0 ? $localize`:@@featureInitiatives-learnSetVerdict:Set verdict` : undefined,
      dividerBefore: index === 0,
    })),
  ];

  readonly decisionMenu = (row: InitiativeDecisionDto): FpcMenuItem[] => [
    agOpenItem(),
    ...(row.status === 'proposed'
      ? [
          { id: 'accept', label: $localize`:@@featureInitiatives-accept:Accept`, icon: 'check2', dividerBefore: true },
          { id: 'reject', label: $localize`:@@featureInitiatives-reject:Reject`, icon: 'x-lg', danger: true },
        ]
      : []),
    agCopyIdItem(),
  ];

  // --- modals --------------------------------------------------------------------------------------------------

  readonly reviewProposal = signal<InitiativeProposalDto | null>(null);
  readonly closeDroppedTickets = signal(false);
  readonly decisionNote = signal('');
  readonly openFinding = signal<InitiativeFindingDto | null>(null);
  readonly openDecision = signal<InitiativeDecisionDto | null>(null);
  readonly convertFinding = signal<InitiativeFindingDto | null>(null);
  readonly convertEpicId = signal('');
  readonly newFindingOpen = signal(false);
  readonly newFindingBody = signal('');
  readonly newFindingSeverity = signal<FindingSeverity>('minor');
  readonly newDecisionOpen = signal(false);
  readonly newDecisionTitle = signal('');
  readonly newDecisionBody = signal('');

  constructor() {
    effect(() => {
      const request = this.viewRequest();

      if (request && request.nonce !== this.appliedViewNonce) {
        this.appliedViewNonce = request.nonce;
        untracked(() => {
          this.setView(request.view);

          // "Decide open change proposals" with a single one: its review is the next thing to do.
          const open = this.openProposals();

          if (request.view === 'proposals' && open.length === 1) {
            this.openReview(open[0]);
          }
        });
      }
    });
    // Open detail modals follow live updates of their row (a decision decided elsewhere, a finding converted).
    effect(() => {
      const findings = this.findings();
      const decisions = this.decisions();

      untracked(() => {
        const finding = this.openFinding();
        const decision = this.openDecision();

        if (finding) {
          this.openFinding.set(findings.find((row) => row.id === finding.id) ?? null);
        }

        if (decision) {
          this.openDecision.set(decisions.find((row) => row.id === decision.id) ?? null);
        }
      });
    });
  }

  setView(view: LearnView): void {
    this.chosenView.set(view);
  }

  onViewChange(view: string | null): void {
    if (view && (this.views as readonly string[]).includes(view)) {
      this.setView(view as LearnView);
    }
  }

  /** Tab badge: what waits for someone (open proposals / findings, decisions to decide); none for retrospectives. */
  viewBadge(view: LearnView): number | null {
    return view === 'retrospectives' ? null : this.counts()[view] || null;
  }

  viewBadgeLabel(view: LearnView): string | null {
    const count = this.viewBadge(view);

    return count ? $localize`:@@featureInitiatives-learnBadgeWaiting:${count}:count: waiting` : null;
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  workItemTitle(workItemId: string | null): string {
    return (this.workItems()?.items ?? []).find((item) => item.id === workItemId)?.title ?? '';
  }

  /** "2 documents, 3 work items, 1 decision" (empty parts left out). */
  changesSummary(proposal: InitiativeProposalDto): string {
    const { artifacts, workItems, decisions } = proposal.changes;
    const parts = [
      artifacts.length
        ? artifacts.length === 1
          ? $localize`:@@featureInitiatives-learnOneDocument:1 document`
          : $localize`:@@featureInitiatives-learnDocuments:${artifacts.length}:count: documents`
        : '',
      workItems.length
        ? workItems.length === 1
          ? $localize`:@@featureInitiatives-learnOneWorkItem:1 work item`
          : $localize`:@@featureInitiatives-learnWorkItems:${workItems.length}:count: work items`
        : '',
      decisions.length
        ? decisions.length === 1
          ? $localize`:@@featureInitiatives-learnOneDecision:1 decision`
          : $localize`:@@featureInitiatives-learnDecisions:${decisions.length}:count: decisions`
        : '',
    ].filter(Boolean);

    return parts.join(', ');
  }

  onProposalAction(row: InitiativeProposalDto, action: string): void {
    if (action === 'review') {
      this.openReview(row);
    } else if (action === 'copy-id') {
      fpcCopyText(row.id);
    }
  }

  onFindingAction(row: InitiativeFindingDto, action: string): void {
    switch (action) {
      case 'open':
        this.openFinding.set(row);
        break;
      case 'convert':
        this.openConvert(row);
        break;
      case 'dismiss':
        this.dismiss(row);
        break;
      case 'reopen':
        this.reopen(row);
        break;
      case 'copy-id':
        fpcCopyText(row.id);
        break;
    }
  }

  onRetroAction(row: InitiativeWorkItemDto, action: string): void {
    if (action === 'run') {
      this.runRetrospective(row);
    } else if (action.startsWith('verdict:')) {
      this.overrideVerdict(row.id, action.slice('verdict:'.length) as RetrospectiveVerdict);
    }
  }

  onDecisionAction(row: InitiativeDecisionDto, action: string): void {
    switch (action) {
      case 'open':
        this.openDecision.set(row);
        break;
      case 'accept':
        this.decide(row, 'accepted');
        break;
      case 'reject':
        this.decide(row, 'rejected');
        break;
      case 'copy-id':
        fpcCopyText(row.id);
        break;
    }
  }

  runRetrospective(epic: InitiativeWorkItemDto): void {
    this.startStep.emit({ step: 'retrospective', workItemId: epic.id });
  }

  startCorrectCourse(): void {
    this.startStep.emit({ step: 'correct-course' });
  }

  openNewFinding(): void {
    this.newFindingBody.set('');
    this.newFindingSeverity.set('minor');
    this.newFindingOpen.set(true);
  }

  openNewDecision(): void {
    this.newDecisionTitle.set('');
    this.newDecisionBody.set('');
    this.newDecisionOpen.set(true);
  }

  convertFromDetail(finding: InitiativeFindingDto): void {
    this.openFinding.set(null);
    this.openConvert(finding);
  }

  decideFromDetail(decision: InitiativeDecisionDto, status: 'accepted' | 'rejected'): void {
    this.decide(decision, status);
    this.openDecision.set(null);
  }

  keyOf(workItemId: string | null): string {
    return (this.workItems()?.items ?? []).find((item) => item.id === workItemId)?.key ?? '';
  }

  /** Correct course from the selected open findings (closed ones in the selection are left out). */
  correctCourse(): void {
    const findingIds = [...this.selectedOpenFindingIds()];

    if (findingIds.length > 0) {
      this.startStep.emit({ step: 'correct-course', findingIds });
    }

    this.selectedFindingIds.set([]);
  }

  dismiss(finding: InitiativeFindingDto): void {
    this.facade.run({ type: 'updateFinding', findingId: finding.id, status: 'dismissed' });
  }

  reopen(finding: InitiativeFindingDto): void {
    this.facade.run({ type: 'updateFinding', findingId: finding.id, status: 'open' });
  }

  openConvert(finding: InitiativeFindingDto): void {
    this.convertFinding.set(finding);
    this.convertEpicId.set(
      finding.workItemId && this.epics().some((epic) => epic.id === finding.workItemId)
        ? finding.workItemId
        : (this.epics()[0]?.id ?? ''),
    );
  }

  submitConvert(): void {
    const finding = this.convertFinding();

    if (finding && this.convertEpicId()) {
      this.facade.run({ type: 'convertFinding', findingId: finding.id, epicId: this.convertEpicId() });
    }

    this.convertFinding.set(null);
  }

  submitFinding(): void {
    const body = this.newFindingBody().trim();

    if (body) {
      this.facade.run({
        type: 'createFinding',
        initiativeId: this.initiative().id,
        dto: { severity: this.newFindingSeverity(), body },
      });
    }

    this.newFindingOpen.set(false);
    this.newFindingBody.set('');
  }

  openReview(proposal: InitiativeProposalDto): void {
    this.reviewProposal.set(proposal);
    this.closeDroppedTickets.set(false);
    this.decisionNote.set('');
  }

  hasDrops(proposal: InitiativeProposalDto): boolean {
    return proposal.changes.workItems.some((op) => op.op === 'drop');
  }

  /** One work item change of a proposal, in words. */
  describeOperation(op: InitiativeProposalDto['changes']['workItems'][number]): string {
    switch (op.op) {
      case 'add': {
        const kind = workItemKindLabel(op.item.kind);

        return op.parentKey
          ? $localize`:@@featureInitiatives-learnOpAddIn:New ${kind}:kind: "${op.item.title}:title:" in ${op.parentKey}:parent:`
          : $localize`:@@featureInitiatives-learnOpAdd:New ${kind}:kind: "${op.item.title}:title:"`;
      }
      case 'update':
        return op.title
          ? $localize`:@@featureInitiatives-learnOpUpdateTitled:${op.key}:key: changes, new title "${op.title}:title:"`
          : $localize`:@@featureInitiatives-learnOpUpdate:${op.key}:key: changes`;
      case 'drop':
        return $localize`:@@featureInitiatives-learnOpDrop:${op.key}:key: is dropped`;
      case 'move':
        return op.beforeKey
          ? $localize`:@@featureInitiatives-learnOpMoveBefore:${op.key}:key: moves before ${op.beforeKey}:before:`
          : $localize`:@@featureInitiatives-learnOpMove:${op.key}:key: moves to the end`;
    }
  }

  opIcon(op: InitiativeProposalDto['changes']['workItems'][number]): string {
    switch (op.op) {
      case 'add':
        return 'plus-circle';
      case 'update':
        return 'pencil';
      case 'drop':
        return 'dash-circle';
      case 'move':
        return 'arrow-down-up';
    }
  }

  accept(proposal: InitiativeProposalDto): void {
    this.facade.run({
      type: 'acceptProposal',
      proposalId: proposal.id,
      ...(this.decisionNote().trim() ? { note: this.decisionNote().trim() } : {}),
      ...(this.closeDroppedTickets() ? { closeDroppedTickets: true } : {}),
    });
    this.reviewProposal.set(null);
  }

  reject(proposal: InitiativeProposalDto): void {
    this.facade.run({
      type: 'rejectProposal',
      proposalId: proposal.id,
      ...(this.decisionNote().trim() ? { note: this.decisionNote().trim() } : {}),
    });
    this.reviewProposal.set(null);
  }

  decide(decision: InitiativeDecisionDto, status: 'accepted' | 'rejected'): void {
    this.facade.run({ type: 'decideDecision', decisionId: decision.id, status });
  }

  submitDecision(): void {
    const title = this.newDecisionTitle().trim();

    if (title) {
      this.facade.run({
        type: 'createDecision',
        initiativeId: this.initiative().id,
        dto: { title, body: this.newDecisionBody().trim() },
      });
    }

    this.newDecisionOpen.set(false);
    this.newDecisionTitle.set('');
    this.newDecisionBody.set('');
  }

  overrideVerdict(epicId: string, verdict: RetrospectiveVerdict): void {
    this.facade.run({ type: 'overrideRetrospective', itemId: epicId, verdict });
  }
}
