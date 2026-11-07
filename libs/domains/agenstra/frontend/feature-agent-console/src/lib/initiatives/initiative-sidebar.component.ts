import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  InitiativesFacade,
  type InitiativeDto,
  type InitiativeWorkItemDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { WORK_ITEM_STATUSES, type NextAction } from '@forepath/agenstra/shared/util-initiative-method';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { agOpenItem } from '../shared/data-list';

import { filterInitiativeRows } from './initiative-table-search';

import type { InitiativeTab } from './initiatives-board.component';
import { initiativeTableTone, workItemKindLabel, workItemStatusLabel, workItemStatusTone } from './initiative-labels';
import type { InitiativeStartRequest } from './initiative-runs.component';

interface NextRow {
  id: string;
  index: number;
  action: NextAction;
}

/**
 * Right column of an initiative (next to every tab, like the activity column of ticket / page / plan details):
 * intent, "What's next", progress and the work items outline, so they stay in view while working through a step.
 */
@Component({
  selector: 'framework-initiative-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
  ],
  styles: [
    `
      /* Sections like the lanes / detail columns of the app: a flush lane header strip, then the content. Tables sit
         directly under their header (full width; cells keep the shared edge inset), facts and text get the same
         inner padding. Sections are divided by the header strips' top edge. */
      :host {
        display: block;
      }
      .initiative-sidebar__section > fpc-lane-header {
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }
      .initiative-sidebar__section + .initiative-sidebar__section > fpc-lane-header {
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }
      .initiative-sidebar__body {
        padding: 0.75rem 1rem;
      }
      .initiative-sidebar__intent {
        white-space: pre-wrap;
        word-break: break-word;
        display: -webkit-box;
        -webkit-line-clamp: 6;
        line-clamp: 6;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .initiative-sidebar__reason {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
      }
    `,
  ],
  template: `
    <section class="initiative-sidebar__section">
      <fpc-lane-header flush>
        <span fpcLaneHeaderTitle i18n="@@featureInitiatives-intentHeading">Intent</span>
        <fpc-button
          fpcLaneHeaderActions
          variant="dark"
          iconOnly
          [ariaLabel]="editIntentTitle"
          [title]="editIntentTitle"
          (clicked)="openIntent()"
          data-testid="initiative-intent-edit"
        >
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </fpc-button>
      </fpc-lane-header>
      <div class="initiative-sidebar__body">
        @if (initiative().intent.trim()) {
          <p class="small mb-0 initiative-sidebar__intent" [title]="initiative().intent">{{ initiative().intent }}</p>
        } @else {
          <p class="small text-body-secondary mb-0" i18n="@@featureInitiatives-sidebarNoIntent">
            No intent yet. Describe what should be true when this is done.
          </p>
        }
      </div>
    </section>

    <section class="initiative-sidebar__section">
      <fpc-lane-header flush>
        <span fpcLaneHeaderTitle i18n="@@featureInitiatives-nextHeading">What's next</span>
      </fpc-lane-header>
      @if (overview(); as data) {
        @if (data.nextActions.length === 0) {
          <div class="initiative-sidebar__body">
            <fpc-alert
              variant="success"
              i18n-message="@@featureInitiatives-sidebarNothingNext"
              message="Nothing is waiting. Start any guided step or move to the next phase."
            />
          </div>
        } @else {
          <fpc-data-table
            nested
            [ariaLabel]="nextLabel"
            [columns]="nextColumns"
            [rows]="nextRows()"
            [searchable]="false"
            [showColumnChooser]="false"
            [clientSort]="false"
            [rowMenu]="nextMenu"
            (rowAction)="onNextAction($event.row)"
            (rowActivate)="onNextAction($event)"
            data-testid="initiative-next"
          >
            <ng-template fpcTableCell="next" let-row>
              <div class="fw-semibold">{{ row.action.title }}</div>
              <small class="text-body-secondary initiative-sidebar__reason" [title]="row.action.reason">{{
                row.action.reason
              }}</small>
            </ng-template>
          </fpc-data-table>
        }
      } @else {
        <div class="initiative-sidebar__body">
          <fpc-empty-state size="sm" loading />
        </div>
      }
    </section>

    @if (overview(); as data) {
      <section class="initiative-sidebar__section">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle i18n="@@featureInitiatives-sidebarProgressHeading">Progress</span>
        </fpc-lane-header>
        <div class="initiative-sidebar__body">
          <fpc-key-value-list [items]="progressItems()" />
        </div>
      </section>
    }

    <section class="initiative-sidebar__section">
      <fpc-lane-header flush>
        <span fpcLaneHeaderTitle i18n="@@featureInitiatives-tabWork">Work items</span>
      </fpc-lane-header>
      <fpc-data-table
        nested
        [ariaLabel]="workLabel"
        [columns]="workColumns"
        [rows]="visibleWorkRows()"
        [(query)]="workQuery"
        [groupBy]="groupByEpic"
        [groupLabel]="epicGroupLabel"
        paging="client"
        [pageSize]="25"
        persistKey="agenstra-initiative-sidebar-work"
        [searchPlaceholder]="workSearchPlaceholder"
        [showColumnChooser]="false"
        [clientSort]="false"
        [rowMenu]="workMenu"
        (rowAction)="openWorkItem.emit($event.row.id)"
        (rowActivate)="openWorkItem.emit($event.id)"
        emptyIcon="diagram-3"
        data-testid="initiative-sidebar-work"
      >
        <span fpcDataTableEmpty>
          <fpc-empty-state
            size="sm"
            icon="diagram-3"
            message="No work items yet"
            i18n-message="@@featureInitiatives-sidebarNoWork"
          />
        </span>
        <ng-template fpcTableCell="title" let-row>
          <span class="d-block text-truncate" [title]="row.title">{{ row.title }}</span>
          @if (row.blockedBy.length && row.status === 'draft') {
            <small class="text-warning d-block text-truncate"
              ><span i18n="@@featureInitiatives-waitingFor">Waiting for</span> {{ row.blockedBy.join(', ') }}</small
            >
          }
        </ng-template>
      </fpc-data-table>
    </section>

    <fpc-modal [(open)]="intentOpen" title="Intent" i18n-title="@@featureInitiatives-intentHeading" size="lg">
      @if (intentChangedMeanwhile()) {
        <fpc-alert
          class="d-block mb-3"
          variant="warning"
          i18n-message="@@featureInitiatives-intentChanged"
          message="Someone changed the intent meanwhile; saving is refused until you load the latest version."
        />
      }
      <fpc-form-control
        controlType="textarea"
        controlId="initiativeIntentEdit"
        [rows]="10"
        placeholder="What should be true when this is done, what must not change, what is out of scope?"
        i18n-placeholder="@@featureInitiatives-intentPlaceholder"
        [ngModel]="intentDraft()"
        (ngModelChange)="intentDraft.set($event)"
        data-testid="initiative-intent"
      />
      <div *fpcModalFooter>
        <fpc-button
          variant="primary"
          [disabled]="!intentDirty() || pending()"
          (clicked)="saveIntent()"
          data-testid="initiative-intent-save"
          i18n="@@featureInitiatives-save"
          >Save</fpc-button
        >
      </div>
    </fpc-modal>
  `,
})
export class InitiativeSidebarComponent {
  readonly initiative = input.required<InitiativeDto>();
  readonly startStep = output<InitiativeStartRequest>();
  readonly navigate = output<InitiativeTab>();
  /** Transfer an epic: the board opens the transfer modal of the Work items tab. */
  readonly openTransfer = output<string | null>();
  /** Open proposals / findings: the board opens Learn & adjust on that view. */
  readonly openLearn = output<'proposals' | 'findings'>();
  /** A work item was chosen (the board opens it in the Work items tab). */
  readonly openWorkItem = output<string>();

  private readonly facade = inject(InitiativesFacade);

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly workItems = toSignal(this.facade.workItems$, { initialValue: null });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });

  readonly editIntentTitle = $localize`:@@featureInitiatives-sidebarEditIntent:Edit intent`;
  readonly nextLabel = $localize`:@@featureInitiatives-nextHeading:What's next`;
  readonly workLabel = $localize`:@@featureInitiatives-tabWork:Work items`;
  readonly workSearchPlaceholder = $localize`:@@featureInitiatives-sidebarSearchWork:Search work items`;

  readonly nextColumns: FpcTableColumn<NextRow>[] = [
    { id: 'next', label: $localize`:@@featureInitiatives-sidebarColNext:Next step`, required: true, priority: 1 },
  ];
  readonly nextRows = computed<NextRow[]>(() =>
    (this.overview()?.nextActions ?? []).map((action, index) => ({ id: `next-${index}`, index, action })),
  );
  readonly nextMenu = (row: NextRow): FpcMenuItem[] => [
    { id: 'do', label: this.actionLabel(row.action), icon: this.actionIcon(row.action) },
  ];

  readonly workColumns: FpcTableColumn<InitiativeWorkItemDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({
        label: workItemStatusLabel(row.status),
        tone: initiativeTableTone(workItemStatusTone(row.status)),
      }),
    },
    {
      id: 'key',
      label: $localize`:@@featureInitiatives-sidebarColKey:Key`,
      value: (row) => row.key,
      mono: true,
      priority: 1,
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-sidebarColTitle:Title`,
      value: (row) => `${row.title} ${workItemKindLabel(row.kind)}`,
      required: true,
      priority: 1,
    },
  ];
  /** Build order: epics by sort order, each followed by its items. */
  readonly workRows = computed<InitiativeWorkItemDto[]>(() => {
    const items = this.workItems()?.items ?? [];
    const bySort = (a: InitiativeWorkItemDto, b: InitiativeWorkItemDto) => a.sortOrder - b.sortOrder;

    return items
      .filter((item) => item.kind === 'epic')
      .sort(bySort)
      .flatMap((epic) => [epic, ...items.filter((item) => item.parentId === epic.id).sort(bySort)]);
  });
  readonly workQuery = signal('');
  readonly visibleWorkRows = computed(() => filterInitiativeRows(this.workRows(), this.workQuery(), this.workColumns));
  readonly groupByEpic = (row: InitiativeWorkItemDto): string => (row.kind === 'epic' ? row.id : (row.parentId ?? ''));
  readonly epicGroupLabel = (epicId: string): string => {
    const epic = this.workItems()?.items.find((item) => item.id === epicId);

    return epic ? `${epic.key} ${epic.title}` : '';
  };
  readonly workMenu = (): FpcMenuItem[] => [agOpenItem()];

  readonly progressItems = computed<FpcKeyValueItem[]>(() => {
    const counts = this.overview()?.counts;

    if (!counts) {
      return [];
    }

    const byStatus = WORK_ITEM_STATUSES.filter((status) => (counts.itemsByStatus[status] ?? 0) > 0).map(
      (status): FpcKeyValueItem => ({
        key: `status-${status}`,
        label: workItemStatusLabel(status),
        value: counts.itemsByStatus[status] ?? 0,
      }),
    );

    return [
      {
        key: 'documents',
        label: $localize`:@@featureInitiatives-sidebarDocuments:Documents accepted`,
        value: $localize`:@@featureInitiatives-sidebarOfTotal:${counts.acceptedArtifacts}:accepted: of ${counts.artifacts}:total:`,
      },
      { key: 'epics', label: $localize`:@@featureInitiatives-countEpics:Epics`, value: counts.epics },
      {
        key: 'items',
        label: $localize`:@@featureInitiatives-countItems:Stories, spikes and bugs`,
        value: counts.items,
      },
      ...byStatus,
      { key: 'runs', label: $localize`:@@featureInitiatives-countRuns:Active steps`, value: counts.activeRuns },
      {
        key: 'proposals',
        label: $localize`:@@featureInitiatives-countProposals:Open proposals`,
        value: counts.openProposals,
      },
      {
        key: 'findings',
        label: $localize`:@@featureInitiatives-countFindings:Open findings`,
        value: counts.openFindings,
      },
      {
        key: 'decisions',
        label: $localize`:@@featureInitiatives-countDecisions:Decisions to decide`,
        value: counts.proposedDecisions,
      },
      {
        key: 'unknowns',
        label: $localize`:@@featureInitiatives-countUnknowns:Open questions`,
        value: counts.openUnknowns,
      },
    ];
  });

  // --- intent (conditional on the version the editor started from) ------------------------------------------------

  readonly intentOpen = signal(false);
  readonly intentDraft = signal('');
  private readonly intentBase = signal<{ id: string; version: number; intent: string } | null>(null);
  readonly intentDirty = computed(() => this.intentDraft() !== (this.intentBase()?.intent ?? ''));
  readonly intentChangedMeanwhile = computed(() => {
    const base = this.intentBase();

    return (
      this.intentOpen() &&
      !!base &&
      base.version !== this.initiative().version &&
      base.intent !== this.initiative().intent
    );
  });

  openIntent(): void {
    const initiative = this.initiative();

    this.intentBase.set({ id: initiative.id, version: initiative.version, intent: initiative.intent });
    this.intentDraft.set(initiative.intent);
    this.intentOpen.set(true);
  }

  saveIntent(): void {
    const base = this.intentBase();

    if (!base) {
      return;
    }

    this.facade.run({
      type: 'updateInitiative',
      id: base.id,
      dto: {
        // Unchanged by others: write on the current version; otherwise on the base (the server refuses with 409).
        expectedVersion: this.initiative().intent === base.intent ? this.initiative().version : base.version,
        intent: this.intentDraft(),
      },
    });
    this.intentOpen.set(false);
  }

  // --- what's next ---------------------------------------------------------------------------------------------

  actionLabel(action: NextAction): string {
    switch (action.kind) {
      case 'transfer':
      case 'build':
        return $localize`:@@featureInitiatives-actionTransfer:Open work items`;
      case 'proposals':
      case 'findings':
        return $localize`:@@featureInitiatives-actionLearn:Open Learn & adjust`;
      default:
        return $localize`:@@featureInitiatives-sidebarStartStep:Start the step`;
    }
  }

  actionIcon(action: NextAction): string {
    return action.kind === 'step' ? 'stars' : 'box-arrow-in-right';
  }

  onNextAction(row: NextRow): void {
    const action = row.action;

    if (action.kind === 'step' && action.step) {
      this.startStep.emit({ step: action.step, workItemId: action.epicId });
    } else if (action.kind === 'transfer') {
      this.openTransfer.emit(action.epicId ?? null);
    } else if (action.kind === 'build') {
      this.navigate.emit('work');
    } else if (action.kind === 'proposals' || action.kind === 'findings') {
      this.openLearn.emit(action.kind);
    } else {
      this.navigate.emit('learn');
    }
  }
}
