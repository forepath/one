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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { type Draft, type DraftOp, DraftsService } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  fpcFormatDateTime,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcListHeaderComponent,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom, map } from 'rxjs';

import { filterBySearch } from '../list-search';
import { DraftTrayService, previewRisks } from '../nav/draft-tray.component';
import { kindDisplayName } from '../resources/resource-format';
import { resourceObjectRoute } from '../objects/object-route';
import { apiErrorMessage, WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import { DL_COPY_ID } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { DRAFT_STATUS_TONE, draftOwnerLabel, draftProjects, draftStatusLabel, draftTitle } from './drafts';

/**
 * One draft (Activity › Drafts detail lane, `/activity/drafts/:id`): facts, its ops (each links its object page),
 * and — while open — Open in the tray, Preview (dry run), Submit as plan and Discard (asks first). The actions make it
 * the active draft of the app-wide store (the tray / Spec tabs then work on it). Submitted drafts link their plan.
 */
@Component({
  selector: 'loadweaver-draft-detail-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcDatePipe,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcKeyValueListComponent,
    FpcDataTableComponent,
    FpcListHeaderComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="displayTitle()">
        <!-- Back sits left above the title, below xl only (3.38 R8). -->
        <a
          fpcPageHeaderBreadcrumbs
          class="fpc-md__back small text-decoration-none align-items-center"
          routerLink="/activity/drafts"
          data-testid="draft-back"
        >
          <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ backLabel }}
        </a>
        @if (draft(); as d) {
          <fpc-badge fpcPageHeaderContext [tone]="statusTone[d.status]" data-testid="draft-status">{{
            statusText(d.status)
          }}</fpc-badge>
        }
        <ng-container ngProjectAs="[fpcPageHeaderActions]">
          @if (draft(); as d) {
            @if (d.status === 'open') {
              <fpc-button
                fpcPageHeaderActions
                variant="dark"
                size="sm"
                [disabled]="store.busy()"
                (clicked)="openInTray()"
                data-testid="draft-open-tray"
                iconOnly
                [ariaLabel]="openTrayLabel"
                [title]="openTrayLabel"
              >
                <i class="bi bi-pencil-square" aria-hidden="true"></i>
              </fpc-button>
              <fpc-button
                fpcPageHeaderActions
                variant="dark"
                size="sm"
                [disabled]="d.ops.length === 0 || store.busy()"
                (clicked)="preview()"
                data-testid="draft-preview"
                iconOnly
                [ariaLabel]="previewLabel"
                [title]="previewLabel"
              >
                <i class="bi bi-eye" aria-hidden="true"></i>
              </fpc-button>
            }
            <!-- Copy ID and the destructive discard in More (3.38 R8, LW-06); the primary stays rightmost. -->
            <fpc-dropdown #moreMenu alignment="end" appendTo="body" data-testid="draft-more">
              <fpc-button
                fpcDropdownTrigger
                variant="dark"
                size="sm"
                [iconOnly]="true"
                ariaHaspopup="menu"
                [ariaExpanded]="moreMenu.open()"
                [ariaLabel]="moreLabel"
                [title]="moreLabel"
              >
                <i class="bi bi-three-dots" aria-hidden="true"></i>
              </fpc-button>
              <fpc-dropdown-item icon="clipboard" (selected)="copyId(d)" data-testid="draft-copy-id">{{
                copyIdLabel
              }}</fpc-dropdown-item>
              @if (d.status === 'open') {
                <fpc-dropdown-item
                  icon="trash"
                  [danger]="true"
                  [disabled]="store.busy()"
                  (selected)="discardOpen.set(true)"
                  data-testid="draft-discard"
                  >{{ discardLabel }}</fpc-dropdown-item
                >
              }
            </fpc-dropdown>
            @if (d.status === 'open') {
              <fpc-button
                fpcPageHeaderActions
                variant="primary"
                size="sm"
                [disabled]="d.ops.length === 0 || store.busy()"
                (clicked)="submit()"
                data-testid="draft-submit"
                iconOnly
                [ariaLabel]="submitLabel"
                [title]="submitLabel"
              >
                <i class="bi bi-send" aria-hidden="true"></i>
              </fpc-button>
            }
          }
        </ng-container>
      </fpc-page-header>

      @if (error() ?? store.error(); as message) {
        <fpc-alert [flush]="true" variant="warning" [message]="message" [dismissible]="true" (closed)="dismiss()" />
      }
      @if (loading()) {
        <fpc-empty-state [loading]="true" [title]="loadingLabel" />
      } @else if (draft(); as d) {
        <!-- One lane (3.38): facts, the preview summary, then the changes under a list header. -->
        <fpc-section-row class="flex-grow-1 min-h-0">
          <loadweaver-lane [title]="detailsTitle" [flush]="true" data-testid="draft-lane">
            @if (d.planId) {
              <fpc-button
                lwLaneActions
                variant="dark"
                size="sm"
                iconOnly
                [routerLink]="['/activity/plans', d.planId]"
                [ariaLabel]="planLabel"
                [title]="planLabel"
                data-testid="draft-plan-link"
              >
                <i class="bi bi-file-diff" aria-hidden="true"></i>
              </fpc-button>
            }
            <!-- One facts column: its edges line up with the changes table below (LW-14). -->
            <fpc-key-value-list class="px-3" [items]="facts()" data-testid="draft-facts" />

            @if (isActive() && store.preview(); as pv) {
              <fpc-list-header [title]="previewLabel" [sticky]="false">
                <a fpcListHeaderActions class="small" routerLink="/observe/topology" [queryParams]="{ draft: d.id }">{{
                  showOnMapLabel
                }}</a>
              </fpc-list-header>
              <div
                class="d-flex flex-wrap align-items-center gap-1 px-3 py-2 small"
                data-testid="draft-preview-summary"
              >
                <fpc-badge color="light" size="sm">{{ pv.plan.changes.length }} {{ changesLabel }}</fpc-badge>
                @if (pv.plan.workloadChanges.length) {
                  <fpc-badge tone="info">{{ pv.plan.workloadChanges.length }} {{ movesLabel }}</fpc-badge>
                }
                @if (pv.plan.warnings.length) {
                  <fpc-badge tone="warning">{{ pv.plan.warnings.length }} {{ warningsLabel }}</fpc-badge>
                }
                @if (pv.plan.diagnostics.length) {
                  <fpc-badge tone="danger">{{ pv.plan.diagnostics.length }} {{ issuesLabel }}</fpc-badge>
                }
                @for (entry of risks(); track entry.project) {
                  <fpc-badge tone="warning">{{ entry.project }}: {{ entry.reasons }}</fpc-badge>
                }
                @if (store.conflicts().length) {
                  <fpc-badge tone="danger">{{ store.conflicts().length }} {{ conflictsLabel }}</fpc-badge>
                }
              </div>
            }

            <fpc-list-header [title]="opsTitle" />
            <!-- The changes as a nested table (3.38 D1 / decision 2): State (op) · Resource (link) · project · by · at. -->
            <fpc-data-table
              nested
              [ariaLabel]="opsTitle"
              [columns]="opColumns"
              [rows]="filteredOps()"
              [rowId]="opId"
              [rowLink]="opLink"
              [(query)]="opsSearch"
              [searchPlaceholder]="searchOpsLabel"
              paging="client"
              persistKey="lw-draft-ops"
              emptyIcon="pencil-square"
              data-testid="draft-ops"
            >
              <span fpcDataTableEmpty>
                <fpc-empty-state icon="pencil-square" size="sm" [title]="emptyOpsLabel" />
              </span>
              <ng-template fpcTableCell="at" let-row
                ><span class="text-nowrap">{{ row.at | fpcDate: 'datetime' }}</span></ng-template
              >
            </fpc-data-table>
          </loadweaver-lane>
        </fpc-section-row>
      } @else {
        <fpc-empty-state icon="pencil-square" [title]="notFoundLabel" data-testid="draft-not-found" />
      }
    </div>

    <fpc-confirm-dialog
      [open]="discardOpen()"
      (openChange)="discardOpen.set($event)"
      [title]="discardTitle"
      [message]="displayTitle()"
      [confirmLabel]="discardLabel"
      [danger]="true"
      (confirmed)="discard()"
    />
  `,
})
export class LoadweaverDraftDetailPageComponent {
  readonly store = inject(WorkspaceDraftStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly api = inject(DraftsService);
  private readonly router = inject(Router);
  private readonly tray = inject(DraftTrayService);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: null,
  });

  /** A submitted / discarded draft (or one not in the live list yet), fetched by id. */
  private readonly fetched = signal<Draft | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly discardOpen = signal(false);

  readonly draft = computed<Draft | null>(() => {
    const id = this.id();

    return this.store.drafts().find((d) => d.id === id) ?? (this.fetched()?.id === id ? this.fetched() : null);
  });
  readonly isActive = computed(() => !!this.draft() && this.store.active()?.id === this.draft()?.id);
  readonly risks = computed(() => previewRisks(this.store.preview()?.plan.risk));
  readonly displayTitle = computed(() => {
    const d = this.draft();

    return d ? draftTitle(d, (iso) => fpcFormatDateTime(iso, this.locale) || iso) : this.title;
  });
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const d = this.draft();

    if (!d) return [];

    return [
      { key: 'owner', label: this.ownerLabel, value: draftOwnerLabel(d) },
      { key: 'projects', label: this.projectsLabel, value: draftProjects(d).join(', ') || null },
      { key: 'ops', label: this.opsTitle, value: d.ops.length },
      { key: 'created', label: this.createdLabel, value: fpcFormatDateTime(d.createdAt, this.locale) },
      { key: 'updated', label: this.updatedLabel, value: fpcFormatDateTime(d.updatedAt, this.locale) },
    ];
  });

  readonly title = $localize`:@@lwConsoleDrafts-detailTitle:Draft`;
  readonly detailsTitle = $localize`:@@lwConsoleObject-details:Details`;
  readonly loadingLabel = $localize`:@@lwConsoleDrafts-loadingDraft:Loading the draft`;
  readonly statusTone = DRAFT_STATUS_TONE;
  readonly statusText = draftStatusLabel;
  readonly backLabel = $localize`:@@lwConsoleDrafts-back:Back to the drafts`;
  readonly openTrayLabel = $localize`:@@lwConsoleDrafts-openTray:Open in tray`;
  readonly previewLabel = $localize`:@@lwConsoleWorkspace-preview:Preview`;
  readonly submitLabel = $localize`:@@lwConsoleWorkspace-submit:Submit as plan`;
  readonly discardLabel = $localize`:@@lwConsoleWorkspace-discard:Discard draft`;
  readonly discardTitle = $localize`:@@lwConsoleDrafts-discardTitle:Discard this draft?`;
  readonly statusLabel = $localize`:@@lwConsoleDrafts-status:Status`;
  readonly ownerLabel = $localize`:@@lwConsoleDrafts-owner:Owner`;
  readonly projectsLabel = $localize`:@@lwConsoleDrafts-projects:Projects`;
  readonly createdLabel = $localize`:@@lwConsoleDrafts-created:Created`;
  readonly updatedLabel = $localize`:@@lwConsoleDrafts-updated:Updated`;
  readonly opsTitle = $localize`:@@lwConsoleDrafts-ops:Changes`;
  readonly planLabel = $localize`:@@lwConsoleDrafts-plan:Open the plan`;
  readonly notFoundLabel = $localize`:@@lwConsoleDrafts-notFound:Draft not found`;
  readonly emptyOpsLabel = $localize`:@@lwConsoleDraft-empty:No changes yet`;
  readonly changesLabel = $localize`:@@lwConsoleDraft-changes:changes`;
  readonly movesLabel = $localize`:@@lwConsoleDraft-moves:workload moves`;
  readonly warningsLabel = $localize`:@@lwConsoleDraft-warnings:warnings`;
  readonly issuesLabel = $localize`:@@lwConsoleDraft-issues:issues`;
  readonly conflictsLabel = $localize`:@@lwConsoleDrafts-conflicts:conflicts`;
  readonly showOnMapLabel = $localize`:@@lwConsoleDraft-showOnMap:Show on map`;
  readonly deleteLabel = $localize`:@@lwConsoleDraft-opDelete:Delete`;
  readonly upsertLabel = $localize`:@@lwConsoleDraft-opUpsert:Change`;

  readonly copyIdLabel = DL_COPY_ID;
  readonly moreLabel = $localize`:@@lwConsoleContents-more:More`;
  readonly opId = (op: DraftOp): string => `${op.kind}/${op.project ?? ''}/${op.name}`;
  readonly opLink = (op: DraftOp): string => {
    const [root, ...rest] = this.opRoute(op);

    return [root, ...rest.map((part) => encodeURIComponent(part))].join('/');
  };
  /** "Search changes" over the draft's operations (LW-14 round 2): kind (id and readable), project, name, author. */
  readonly opsSearch = signal('');
  readonly filteredOps = computed(() =>
    filterBySearch(this.draft()?.ops ?? [], this.opsSearch(), (op) => [
      op.kind,
      kindDisplayName(op.kind),
      op.project,
      op.name,
      op.by,
      op.op === 'delete' ? this.deleteLabel : this.upsertLabel,
    ]),
  );
  readonly searchOpsLabel = $localize`:@@lwConsolePlanDetail-searchChanges:Search changes`;
  /** 3.38 D1: State (op) · Resource · project · by · at. */
  readonly opColumns: FpcTableColumn<DraftOp>[] = [
    {
      id: 'op',
      label: $localize`:@@lwConsoleDrafts-colOp:Change`,
      type: 'state',
      state: (op) =>
        op.op === 'delete'
          ? { label: this.deleteLabel, tone: 'danger', icon: 'trash' }
          : { label: this.upsertLabel, tone: 'info', icon: 'pencil' },
    },
    {
      id: 'resource',
      label: $localize`:@@lwConsoleDrafts-colResource:Resource`,
      value: (op) => `${kindDisplayName(op.kind)} ${op.project ? op.project + '/' : ''}${op.name}`,
      required: true,
      priority: 1,
    },
    { id: 'by', label: $localize`:@@lwConsoleDrafts-colBy:By`, value: (op) => op.by, priority: 2 },
    { id: 'at', label: $localize`:@@lwConsoleDrafts-colAt:When`, value: (op) => op.at, priority: 1 },
  ];

  constructor() {
    effect(() => {
      const id = this.id();

      if (id) untracked(() => void this.fetch(id));
    });
  }

  opRoute(op: DraftOp): string[] {
    return [...resourceObjectRoute({ kind: op.kind, name: op.name, project: op.project })];
  }

  copyId(draft: Draft): void {
    fpcCopyText(draft.id);
  }

  async openInTray(): Promise<void> {
    if (await this.activate()) this.tray.open.set(true);
  }

  async preview(): Promise<void> {
    if (await this.activate()) await this.store.runPreview();
  }

  async submit(): Promise<void> {
    if (!(await this.activate())) return;

    const plan = await this.store.submit();

    if (plan) void this.router.navigate(['/activity/plans', plan.id]);
  }

  async discard(): Promise<void> {
    this.discardOpen.set(false);

    if (!(await this.activate())) return;

    if (await this.store.discard()) void this.router.navigate(['/activity/drafts']);
  }

  dismiss(): void {
    this.error.set(null);
    this.store.dismissError();
  }

  /** Makes this draft the app-wide active one (no-op when it already is). */
  private async activate(): Promise<boolean> {
    const d = this.draft();

    if (!d || d.status !== 'open') return false;
    if (this.store.active()?.id !== d.id) await this.store.open(d.id);

    return this.store.active()?.id === d.id;
  }

  private async fetch(id: string): Promise<void> {
    if (this.store.drafts().some((d) => d.id === id)) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      this.fetched.set(await firstValueFrom(this.api.get(id)));
    } catch (error) {
      this.fetched.set(null);
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
