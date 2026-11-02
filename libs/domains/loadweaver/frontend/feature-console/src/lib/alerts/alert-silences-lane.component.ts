import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertsService,
  ConsoleAccessFacade,
  ConsoleAlertsFacade,
  type AlertSilence,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcDateRangePipe,
  FpcEmptyStateComponent,
  FpcFormSwitchComponent,
  fpcListQueryState,
  fpcRunBulk,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { firstValueFrom } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlUserLabel } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { SILENCE_STATUS_TONE, silenceStatus, silenceStatusLabel } from './alert-format';
import { LoadweaverAlertSilenceModalComponent } from './alert-silence-modal.component';

/**
 * The silences lane of Observe › Alerts (3.38: Alerts | Silences are lanes, not tabs): the empty detail lane beside the
 * alert list at ≥ xl, the "Silences" lane under the list's lane tabs below xl. Search ("Search silences"), "Include
 * ended silences" in the strip's drawer (URL `?sq=&sf=`), New silence (primary, lane header), End (confirmed).
 */
@Component({
  selector: 'loadweaver-alert-silences-lane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcDateRangePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormSwitchComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    LoadweaverAlertSilenceModalComponent,
    LoadweaverLaneComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  styles: [
    `
      .lw-silence-reason {
        max-width: 16rem;
      }
    `,
  ],
  template: `
    <fpc-section-row class="flex-grow-1 min-h-0">
      <loadweaver-lane [title]="title" [flush]="true" data-testid="alert-silences-lane">
        @if (bulkResult(); as result) {
          <fpc-alert
            [flush]="true"
            [variant]="result.tone"
            [message]="result.message"
            [dismissible]="true"
            (closed)="bulkResult.set(null)"
            data-testid="silences-bulk-result"
          />
        }
        <!-- One data list (3.38 D1): State · Reason · matcher · window; ⋮ End; bulk End on selection. -->
        <fpc-data-table
          class="flex-grow-1 min-h-0"
          [ariaLabel]="title"
          [columns]="columns"
          [rows]="filtered()"
          paging="client"
          persistKey="lw-alert-silences"
          [(query)]="search"
          [searchPlaceholder]="searchLabel"
          showFilterButton
          [(filtersOpen)]="filtersOpen"
          [filtersActive]="filterState.activeCount()"
          (filtersApplied)="filterState.apply()"
          (filtersCleared)="filterState.clear()"
          [loading]="loading() && silences().length === 0"
          [error]="error()"
          selectable
          [(selected)]="selected"
          [rowMenu]="rowMenu"
          (rowAction)="onRowAction($event.row, $event.item.id)"
          emptyIcon="volume-mute"
          data-testid="silences-list"
        >
          <fpc-button
            fpcDataTableToolbar
            variant="primary"
            size="sm"
            [iconOnly]="true"
            [ariaLabel]="newSilenceLabel"
            [title]="newSilenceLabel"
            (clicked)="silenceOpen.set(true)"
            data-testid="silence-new"
          >
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
          </fpc-button>
          <fpc-form-switch
            fpcDataTableFilters
            switchId="lw-silences-expired"
            [ngModel]="filterState.draft().ended"
            (ngModelChange)="filterState.patch({ ended: $event })"
          >
            <label class="form-check-label small" for="lw-silences-expired" i18n="@@lwConsoleAlerts-includeEnded"
              >Include ended silences</label
            >
          </fpc-form-switch>
          <fpc-button
            fpcDataTableBatch
            variant="danger"
            size="sm"
            [disabled]="endable().length === 0"
            (clicked)="confirmBulkEnd.set(true)"
            data-testid="silences-bulk-end"
            iconOnly
            [ariaLabel]="endLabel"
            [title]="endLabel"
          >
            <i class="bi bi-volume-up" aria-hidden="true"></i>
          </fpc-button>
          <span fpcDataTableEmpty>
            <fpc-empty-state icon="volume-mute" size="sm" [title]="ended() ? noSilencesTitle : emptyTitle" />
          </span>
          <!-- The lane is narrow (beside the alert list): reason and window stay one short line each, so the row and
               its ⋮ fit without a sideways scroll (LW-09, round 2); the full texts are tooltips. -->
          <ng-template fpcTableCell="reason" let-row
            ><span class="lw-silence-reason d-block text-truncate" [title]="row.reason">{{
              row.reason
            }}</span></ng-template
          >
          <ng-template fpcTableCell="window" let-row
            ><span class="d-block text-nowrap" [title]="row.startsAt | fpcDateRange: row.endsAt : { withTime: true }">{{
              row.startsAt | fpcDateRange: row.endsAt
            }}</span></ng-template
          >
        </fpc-data-table>
      </loadweaver-lane>
    </fpc-section-row>

    <loadweaver-alert-silence-modal
      [open]="silenceOpen()"
      (openChange)="silenceOpen.set($event)"
      [projects]="projects()"
    />

    <fpc-confirm-dialog
      [open]="silenceToEnd() !== null"
      (openChange)="$event || silenceToEnd.set(null)"
      [title]="endSilenceTitle"
      [message]="endSilenceMessage"
      [confirmLabel]="endSilenceConfirm"
      [cancelLabel]="keepLabel"
      [danger]="true"
      (confirmed)="confirmEnd()"
    />

    <fpc-confirm-dialog
      [(open)]="confirmBulkEnd"
      [title]="endSilenceTitle"
      [message]="endSilenceMessage"
      [confirmLabel]="endSilenceConfirm"
      [cancelLabel]="keepLabel"
      [danger]="true"
      (confirmed)="endSelected()"
    />
  `,
})
export class LoadweaverAlertSilencesLaneComponent implements OnInit {
  private readonly facade = inject(ConsoleAlertsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(AlertsService);

  readonly silences = toSignal(this.facade.silences$, { initialValue: [] as AlertSilence[] });
  readonly loading = toSignal(this.facade.silencesLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.silencesError$, { initialValue: null });
  readonly ending = toSignal(this.facade.endingSilence$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly search = signal('');
  readonly ended = signal(false);
  readonly filtersOpen = signal(false);
  readonly silenceOpen = signal(false);
  readonly silenceToEnd = signal<AlertSilence | null>(null);

  /** "Include ended silences" (applied; the facade reloads) + search, in the URL under their own keys. */
  readonly filterState = fpcListQueryState({
    filters: { ended: this.ended },
    search: this.search,
    url: { search: 'sq', filters: 'sf' },
    open: this.filtersOpen,
    changed: () => this.facade.loadSilences(this.ended()),
  });
  /** Ended silences only while asked for (the facade may still hold them from an earlier load). */
  readonly shown = computed(() =>
    this.ended() ? this.silences() : this.silences().filter((s) => silenceStatus(s) !== 'ended'),
  );
  readonly filtered = computed(() =>
    filterBySearch(this.shown(), this.search(), (s) => [
      s.reason,
      s.rule,
      s.project,
      s.key,
      dlUserLabel(s.createdBy, s.createdByEmail),
      s.createdBy,
    ]),
  );

  readonly status = silenceStatus;
  readonly statusLabel = silenceStatusLabel;
  readonly statusTone = SILENCE_STATUS_TONE;
  readonly title = $localize`:@@lwConsoleAlerts-tabSilences:Silences`;
  readonly searchLabel = $localize`:@@lwConsoleAlerts-searchSilences:Search silences`;
  readonly emptyTitle = $localize`:@@lwConsoleAlerts-noCurrentSilences:No active or upcoming silences`;
  readonly noSilencesTitle = $localize`:@@lwConsoleAlerts-noSilences:No silences`;
  readonly loadingLabel = $localize`:@@lwConsoleAlerts-silencesLoading:Loading silences`;
  readonly newSilenceLabel = $localize`:@@lwConsoleAlerts-newSilence:New silence`;
  readonly endLabel = $localize`:@@lwConsoleAlerts-endSilence:End`;
  readonly endSilenceTitle = $localize`:@@lwConsoleAlerts-endSilenceTitle:End the silence now?`;
  readonly endSilenceMessage = $localize`:@@lwConsoleAlerts-endSilenceMessage:Matching alerts are sent again; the silence stays as history.`;
  readonly endSilenceConfirm = $localize`:@@lwConsoleAlerts-endSilenceConfirm:End silence`;
  readonly keepLabel = $localize`:@@lwConsoleAlerts-keep:Keep`;

  /** 3.38 D1: State · Reason · rule · project · key · window · created by. */
  readonly columns: FpcTableColumn<AlertSilence>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleAlerts-colSilenceStatus:Status`,
      type: 'state',
      state: (silence) => {
        const status = silenceStatus(silence);

        return { label: silenceStatusLabel(status), tone: SILENCE_STATUS_TONE[status] };
      },
    },
    {
      id: 'reason',
      label: $localize`:@@lwConsoleAlerts-colReason:Reason`,
      value: (silence) => silence.reason,
      required: true,
      priority: 1,
    },
    {
      id: 'rule',
      label: $localize`:@@lwConsoleAlerts-colRule:Rule`,
      value: (silence) => silence.rule ?? '',
      mono: true,
      priority: 2,
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleAlerts-projectFilter:Project`,
      value: (silence) => silence.project ?? '',
      priority: 2,
    },
    {
      id: 'key',
      label: $localize`:@@lwConsoleAlerts-colKey:Key`,
      value: (silence) => silence.key ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'window',
      label: $localize`:@@lwConsoleAlerts-colWindow:Window`,
      value: (silence) => silence.startsAt,
      priority: 1,
    },
    {
      id: 'createdBy',
      label: $localize`:@@lwConsoleAlerts-colCreatedBy:Created by`,
      value: (silence) => dlUserLabel(silence.createdBy, silence.createdByEmail),
      priority: 3,
      hidden: true,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkEnd = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  /** The selected silences that have not ended yet (the server checks each one). */
  readonly endable = computed(() => {
    const ids = new Set(this.selected());

    return this.silences().filter((silence) => ids.has(silence.id) && silenceStatus(silence) !== 'ended');
  });
  readonly rowMenu = (silence: AlertSilence): FpcMenuItem[] => [
    ...(silenceStatus(silence) !== 'ended'
      ? [{ id: 'end', label: this.endLabel, icon: 'stop-circle', danger: true }]
      : []),
    dlCopyIdItem(),
  ];

  ngOnInit(): void {
    this.facade.loadSilences(this.ended());
  }

  onRowAction(silence: AlertSilence, action: string): void {
    if (action === 'end') this.silenceToEnd.set(silence);
    else if (action === 'copy-id') fpcCopyText(silence.id);
  }

  /** Bulk End: one call per silence (same endpoint + authorization as the row action), per-silence result. */
  async endSelected(): Promise<void> {
    const silences = this.endable();

    if (silences.length === 0) return;

    const result = await fpcRunBulk(silences, (silence) => firstValueFrom(this.service.endSilence(silence.id)));

    this.bulkResult.set(dlBulkSummary(result, (silence) => silence.reason));
    this.selected.set([]);
    this.facade.loadSilences(this.ended());
  }

  confirmEnd(): void {
    const silence = this.silenceToEnd();

    if (silence) this.facade.endSilence(silence.id);

    this.silenceToEnd.set(null);
  }
}
