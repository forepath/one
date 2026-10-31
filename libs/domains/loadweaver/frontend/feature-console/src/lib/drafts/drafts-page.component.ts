import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  LOCALE_ID,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { type Draft, DraftsService, type DraftStatus } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcListQueryState,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { dlBulkSummary, dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { DraftTrayService } from '../nav/draft-tray.component';
import { MasterDetailState } from '../section/master-detail.component';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import { savedViewBinding } from '../views/saved-views';
import { apiErrorMessage, WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import {
  DRAFT_STATUS_TONE,
  DRAFT_STATUSES,
  DRAFT_UNTITLED,
  draftOwnerLabel,
  draftProjects,
  draftStatusLabel,
  draftTitle,
  filterDrafts,
  sortDrafts,
} from './drafts';

/**
 * Activity › Drafts (3.37 gap closure): the server-side drafts (3.36) — open ones live from the app-wide draft store,
 * submitted / discarded ones on demand — with title, owner, touched projects, ops count, last change and status; a
 * row opens the draft in the detail lane (master-detail ≥ xl).
 */
@Component({
  selector: 'loadweaver-drafts-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    LoadweaverSavedViewsComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="title">
        <loadweaver-saved-views fpcPageHeaderActions scope="drafts" [binding]="views" />
      </fpc-page-header>
      @if (listError(); as message) {
        <fpc-alert [flush]="true" variant="danger" [message]="message" data-testid="drafts-error" />
      }
      @if (bulkResult(); as result) {
        <fpc-alert
          [flush]="true"
          [variant]="result.tone"
          [message]="result.message"
          [dismissible]="true"
          (closed)="bulkResult.set(null)"
          data-testid="drafts-bulk-result"
        />
      }
      <!-- One data list (3.38 D1): State · Draft (link) · facts; ⋮ row actions; bulk Discard on selection. -->
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [ariaLabel]="title"
        [columns]="columns"
        [rows]="visible()"
        [rowLink]="draftLink"
        [activeRowId]="openId()"
        paging="client"
        persistKey="lw-drafts"
        [(query)]="search"
        [searchPlaceholder]="searchLabel"
        showFilterButton
        [(filtersOpen)]="filtersOpen"
        [filtersActive]="filterState.activeCount()"
        (filtersApplied)="filterState.apply()"
        (filtersCleared)="filterState.clear()"
        [loading]="loading()"
        [selectable]="status() === 'open'"
        [(selected)]="selected"
        [rowMenu]="rowMenu"
        (rowAction)="onRowAction($event.row, $event.item.id)"
        emptyIcon="pencil-square"
        data-testid="drafts-list"
      >
        <fpc-button
          fpcDataTableToolbar
          variant="primary"
          size="sm"
          (clicked)="newDraft()"
          data-testid="drafts-new"
          iconOnly
          [ariaLabel]="newDraftLabel"
          [title]="newDraftLabel"
        >
          <i class="bi bi-plus-lg" aria-hidden="true"></i>
        </fpc-button>
        <fpc-form-field fpcDataTableFilters forId="lw-drafts-status" [label]="statusLabel">
          <fpc-form-control
            controlType="select"
            controlId="lw-drafts-status"
            size="sm"
            [ngModel]="filterState.draft().status"
            (ngModelChange)="filterState.patch({ status: $event })"
            data-testid="drafts-status"
          >
            @for (s of statuses; track s) {
              <option [value]="s">{{ statusText(s) }}</option>
            }
          </fpc-form-control>
        </fpc-form-field>
        <fpc-button
          fpcDataTableBatch
          variant="danger"
          size="sm"
          [disabled]="selectedDrafts().length === 0"
          (clicked)="confirmDiscard.set(true)"
          data-testid="drafts-bulk-discard"
          iconOnly
          [ariaLabel]="discardLabel"
          [title]="discardLabel"
        >
          <i class="bi bi-trash" aria-hidden="true"></i>
        </fpc-button>
        <span fpcDataTableEmpty>
          @if (!listError()) {
            <fpc-empty-state
              icon="pencil-square"
              size="sm"
              [title]="emptyLabel"
              [message]="emptyHint"
              data-testid="drafts-empty"
            />
          }
        </span>
        <ng-template fpcTableCell="active" let-row>
          @if (activeId() === row.id) {
            <fpc-badge tone="warning" icon="record-circle" [iconOnly]="true" [label]="activeLabel" />
          }
        </ng-template>
        <ng-template fpcTableCell="projects" let-row>
          @for (p of projectsOf(row); track p) {
            <fpc-badge color="light" size="sm" class="me-1">{{ p }}</fpc-badge>
          }
        </ng-template>
        <ng-template fpcTableCell="updated" let-row>{{ row.updatedAt | date: 'short' }}</ng-template>
      </fpc-data-table>
    </div>

    <fpc-confirm-dialog
      [(open)]="confirmDiscard"
      [title]="discardConfirmTitle"
      [message]="discardConfirmMessage()"
      [confirmLabel]="discardLabel"
      [cancelLabel]="cancelLabel"
      [danger]="true"
      (confirmed)="discardSelected()"
    />
  `,
})
export class LoadweaverDraftsPageComponent {
  private readonly store = inject(WorkspaceDraftStore);
  private readonly api = inject(DraftsService);
  private readonly router = inject(Router);
  private readonly tray = inject(DraftTrayService);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  private readonly datePipe = new DatePipe(inject(LOCALE_ID));
  /** Creation time of untitled drafts (their title fallback). */
  readonly when = (iso: string): string => this.datePipe.transform(iso, 'short') ?? iso;

  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  readonly activeId = computed(() => this.store.active()?.id ?? null);
  readonly status = signal<DraftStatus>('open');
  readonly search = signal('');
  readonly views = savedViewBinding({ status: this.status, search: this.search });
  readonly filtersOpen = signal(false);
  /** Status is an applied drawer filter (default "open"), the search is live; both in the URL (`?q=&f=`). */
  readonly filterState = fpcListQueryState({
    filters: { status: this.status },
    search: this.search,
    open: this.filtersOpen,
  });
  /** Submitted / discarded drafts (open ones come live from the store). */
  private readonly closed = signal<Draft[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Load failure of the shown list: the store's open drafts, or the submitted / discarded ones loaded here. */
  readonly listError = computed(() => (this.status() === 'open' ? this.store.loadError() : this.error()));

  readonly all = computed(() => sortDrafts(this.status() === 'open' ? this.store.drafts() : this.closed()));
  readonly visible = computed(() => filterDrafts(this.all(), this.search()));

  readonly statuses = DRAFT_STATUSES;
  readonly tone = DRAFT_STATUS_TONE;
  readonly statusText = draftStatusLabel;
  readonly projectsOf = draftProjects;
  readonly title = $localize`:@@lwConsoleDrafts-title:Drafts`;
  readonly statusLabel = $localize`:@@lwConsoleDrafts-status:Status`;
  readonly searchLabel = $localize`:@@lwConsoleDrafts-search:Search drafts`;
  readonly activeLabel = $localize`:@@lwConsoleDrafts-active:Your active draft`;
  readonly newDraftLabel = $localize`:@@lwConsoleWorkspace-newDraft:New draft`;
  readonly emptyLabel = $localize`:@@lwConsoleDrafts-empty:No drafts`;
  readonly loadingLabel = $localize`:@@lwConsoleDrafts-loading:Loading drafts`;
  readonly emptyHint = $localize`:@@lwConsoleDraft-emptyHint:Use Edit, Create or "Delete in draft" — changes collect here until you submit them as a plan.`;
  readonly discardLabel = $localize`:@@lwConsoleDrafts-discardSelected:Discard`;
  readonly discardConfirmTitle = $localize`:@@lwConsoleDrafts-discardConfirmTitle:Discard drafts?`;
  readonly cancelLabel = $localize`:@@lwConsolePlans-cancel:Cancel`;
  readonly discardConfirmMessage = computed(
    () =>
      $localize`:@@lwConsoleDrafts-discardConfirmMessage:${this.selectedDrafts().length}:count: selected open drafts will be discarded. Drafts you may not discard are reported and left as they are.`,
  );

  /** 3.38 D1: State · Draft (link) · changes · owner · projects · last change. */
  readonly columns: FpcTableColumn<Draft>[] = [
    {
      id: 'status',
      label: this.statusLabel,
      type: 'state',
      state: (draft) => ({ label: draftStatusLabel(draft.status), tone: DRAFT_STATUS_TONE[draft.status] }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleDrafts-colDraft:Draft`,
      value: (draft) => draftTitle(draft, this.when),
      required: true,
      priority: 1,
    },
    { id: 'active', label: this.activeLabel, width: '3rem', priority: 2 },
    {
      id: 'changes',
      label: $localize`:@@lwConsoleDrafts-colChanges:Changes`,
      value: (draft) => draft.ops.length,
      align: 'end',
      width: '6rem',
    },
    { id: 'owner', label: $localize`:@@lwConsoleDrafts-colOwner:Owner`, value: draftOwnerLabel, priority: 1 },
    { id: 'projects', label: $localize`:@@lwConsoleDrafts-colProjects:Projects`, priority: 3 },
    {
      id: 'updated',
      label: $localize`:@@lwConsoleDrafts-colUpdated:Last change`,
      value: (draft) => draft.updatedAt,
      priority: 2,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly confirmDiscard = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  /** Only open drafts can be discarded; the server still checks every draft (owner / project role). */
  readonly selectedDrafts = computed(() => {
    const ids = new Set(this.selected());

    return this.all().filter((draft) => ids.has(draft.id) && draft.status === 'open');
  });

  readonly draftLink = (draft: Draft): string => `/activity/drafts/${encodeURIComponent(draft.id)}`;
  readonly rowMenu = (draft: Draft): FpcMenuItem[] => [
    dlOpenItem(),
    ...(draft.status === 'open'
      ? [{ id: 'discard', label: this.discardLabel, icon: 'trash', danger: true, dividerBefore: true }]
      : []),
    dlCopyIdItem(),
  ];
  private readonly untitled = DRAFT_UNTITLED;

  constructor() {
    effect(() => {
      const status = this.status();

      if (status !== 'open') untracked(() => void this.loadClosed(status));
    });
  }

  open(draft: Draft): void {
    void this.router.navigate(['/activity/drafts', draft.id]);
  }

  onRowAction(draft: Draft, action: string): void {
    if (action === 'open') this.open(draft);
    else if (action === 'copy-id') fpcCopyText(draft.id);
    else if (action === 'discard') {
      this.selected.set([draft.id]);
      this.confirmDiscard.set(true);
    }
  }

  /** Bulk Discard: one call per draft (same endpoint + authorization as the detail page), per-draft result. */
  async discardSelected(): Promise<void> {
    const drafts = this.selectedDrafts();

    if (drafts.length === 0) return;

    const result = await fpcRunBulk(drafts, (draft) => firstValueFrom(this.api.discard(draft.id, draft.version)));

    const discarded = new Set(result.succeeded.map((draft) => draft.id));

    this.store.drafts.update((list) => list.filter((draft) => !discarded.has(draft.id)));
    this.bulkResult.set(dlBulkSummary(result, (draft) => draftTitle(draft, this.when)));
    this.selected.set([]);
  }

  async newDraft(): Promise<void> {
    const draft = await this.store.create(this.untitled);

    if (draft) {
      this.tray.open.set(true);
      void this.router.navigate(['/activity/drafts', draft.id]);
    }
  }

  private async loadClosed(status: DraftStatus): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      this.closed.set(await firstValueFrom(this.api.list(status)));
    } catch (error) {
      this.closed.set([]);
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
