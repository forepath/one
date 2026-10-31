import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  ImportService,
  type DiscoveredItem,
  type ImportDetail,
  type ImportItemSelection,
  type ImportSelectionView,
  type ImportStepState,
  type JoinPlanStep,
  type VolumeHandling,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcEmptyStateComponent,
  FpcSearchFieldComponent,
  FpcSectionRowComponent,
  FpcListHeaderComponent,
  FpcFormFieldComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import {
  CONFLICT_TONE,
  formatBytes,
  initialSelections,
  needsHostname,
  selectionsBody,
  STATUS_TONE,
  STEP_TONE,
  importConflictLabel,
  importStatusLabel,
  importStepLabel,
} from './import-format';
import { filterBySearch, NO_MATCHES_HINT, NO_MATCHES_TITLE } from '../list-search';
import { LoadweaverLaneComponent } from '../section/lane.component';

/**
 * The import wizard of a pending node (3.21): what discovery found, per item import / migrate / ignore with its target
 * project, hostnames for HTTP ports and what happens to its data; the join plan built from it (conflicts resolved or
 * refused with reasons, the former installation, ordered steps); then one plan to review and apply like any other.
 * While the join plan runs, its steps show their progress.
 */
@Component({
  selector: 'loadweaver-import-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcEmptyStateComponent,
    FpcSearchFieldComponent,
    FpcSectionRowComponent,
    FpcListHeaderComponent,
    FpcFormFieldComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverLaneComponent,
  ],
  templateUrl: './import-page.component.html',
  standalone: true,
})
export class LoadweaverImportPageComponent implements OnInit {
  private readonly service = inject(ImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly node = signal('');
  readonly detail = signal<ImportDetail | null>(null);
  readonly selections = signal<ImportItemSelection[]>([]);
  readonly preview = signal<ImportSelectionView | null>(null);
  /** The join plan's steps with their run state (decision 2: a feed as a table). */
  readonly stepRows = computed<(JoinPlanStep & { state: ImportStepState | null })[]>(() => {
    const p = this.preview();

    return p ? p.joinPlan.steps.map((step) => ({ ...step, state: p.steps[step.id] ?? null })) : [];
  });
  readonly stepsLabel = $localize`:@@lwConsoleImport-steps:Steps`;
  readonly stepColumns: FpcTableColumn<JoinPlanStep & { state: ImportStepState | null }>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleImport-colStepState:Status`,
      type: 'state',
      state: (step) =>
        step.state
          ? { label: importStepLabel(step.state.status), tone: STEP_TONE[step.state.status] }
          : { label: importStepLabel('pending'), tone: STEP_TONE.pending },
    },
    {
      id: 'step',
      label: $localize`:@@lwConsoleImport-colStep:Step`,
      value: (step) => step.description,
      required: true,
      priority: 1,
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleImport-colMessage:Message`,
      value: (step) => step.state?.message ?? '',
      priority: 2,
    },
  ];
  readonly wipeFormerIdentity = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflictTone = CONFLICT_TONE;
  readonly statusTone = STATUS_TONE;
  readonly stepTone = STEP_TONE;
  readonly statusLabel = importStatusLabel;
  readonly conflictLabel = importConflictLabel;
  readonly stepLabel = importStepLabel;
  readonly formatBytes = formatBytes;
  readonly needsHostname = needsHostname;

  readonly title = computed(() => $localize`:@@lwConsoleImport-title:Import ${this.node()}:node:`);
  /** Workbench: the host's items (main lane) and the join plan inspector; one lane at a time on phones. */
  readonly lane = signal<'items' | 'plan'>('items');
  readonly search = signal('');
  readonly filteredItems = computed(() =>
    filterBySearch(this.detail()?.items ?? [], this.search(), (item) => [item.name, item.kind, item.services]),
  );
  readonly itemsTitle = $localize`:@@lwConsoleImport-itemsTitle:What runs on the host`;
  readonly planTitle = $localize`:@@lwConsoleImport-planTitle:Join plan`;
  readonly searchLabel = $localize`:@@lwConsoleImport-itemSearch:Search workloads`;
  readonly hostTitle = $localize`:@@lwConsoleImport-hostTitle:Host`;
  readonly variablesTitle = $localize`:@@lwConsoleImport-variablesTitle:Secrets that stayed on the host`;
  readonly planSectionTitle = $localize`:@@lwConsoleImport-planSection:Plan and steps`;
  readonly noItemsLabel = $localize`:@@lwConsoleImport-noItems:Nothing found on the host`;
  readonly loadingLabel = $localize`:@@lwConsoleImport-loading:Loading the import`;
  readonly noMatchesTitle = NO_MATCHES_TITLE;
  readonly noMatchesHint = NO_MATCHES_HINT;
  readonly discoverLabel = $localize`:@@lwConsoleImport-discoverAgain:Discover again`;
  readonly discardLabel = $localize`:@@lwConsoleImport-discard:Discard`;
  readonly editable = computed(() => {
    const status = this.preview()?.status;

    return this.detail()?.lifecycle === 'pending' && (!status || status === 'draft' || status === 'discarded');
  });
  readonly sensitiveVariables = computed(() =>
    (this.detail()?.discovery.report.composeProjects ?? []).flatMap((p) => [
      ...(p.envFile?.variables ?? []).filter((v) => v.sensitive).map((v) => ({ project: p.name, name: v.name })),
      ...p.configFiles.flatMap((f) => (f.redacted ?? []).map((r) => ({ project: p.name, name: r.variable }))),
    ]),
  );
  readonly formerOtherCluster = computed(() => {
    const former = this.detail()?.discovery.report.former;

    return !!former && this.preview()?.joinPlan.former?.kind !== 'same-cluster';
  });

  ngOnInit(): void {
    this.node.set(this.route.snapshot.paramMap.get('node') ?? '');
    this.load();
  }

  load(): void {
    this.service.get(this.node()).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.preview.set(detail.selection);
        this.wipeFormerIdentity.set(!!detail.selection?.selections.wipeFormerIdentity);
        this.selections.set(initialSelections(detail.items, detail.selection?.selections ?? null));
      },
      error: (error: unknown) =>
        this.error.set(apiErrorMessage(error, $localize`:@@lwConsoleImport-loadError:The import could not be loaded.`)),
    });
  }

  selectionOf(item: DiscoveredItem): ImportItemSelection {
    return this.selections().find((s) => s.item === item.id) ?? { item: item.id, choice: 'ignore' };
  }

  update(item: DiscoveredItem, patch: Partial<ImportItemSelection>): void {
    this.selections.update((list) => list.map((s) => (s.item === item.id ? { ...s, ...patch } : s)));
  }

  setHostname(item: DiscoveredItem, port: number, host: string): void {
    this.update(item, { http: { ...(this.selectionOf(item).http ?? {}), [String(port)]: host.trim() } });
  }

  setVolume(item: DiscoveredItem, key: string, handling: VolumeHandling): void {
    this.update(item, { volumes: { ...(this.selectionOf(item).volumes ?? {}), [key]: handling } });
  }

  setVariable(project: string, name: string, value: string): void {
    this.selections.update((list) =>
      list.map((s) =>
        s.item === `compose:${project}` ? { ...s, variables: { ...(s.variables ?? {}), [name]: value } } : s,
      ),
    );
  }

  variableOf(project: string, name: string): string {
    return this.selections().find((s) => s.item === `compose:${project}`)?.variables?.[name] ?? '';
  }

  /** Saves the selection and shows the join plan the control plane built from it. */
  buildPlan(): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.saveSelection(this.node(), selectionsBody(this.selections(), this.wipeFormerIdentity())).subscribe({
      next: (view) => {
        this.preview.set(view);
        this.busy.set(false);
      },
      error: (error: unknown) => {
        this.error.set(
          apiErrorMessage(error, $localize`:@@lwConsoleImport-saveError:The selection could not be saved.`),
        );
        this.busy.set(false);
      },
    });
  }

  /** One plan from the join plan: reviewed, approved and applied on the plan page. */
  createPlan(): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.createPlan(this.node()).subscribe({
      next: (plan) => void this.router.navigate(['/activity/plans', plan.id]),
      error: (error: unknown) => {
        this.error.set(apiErrorMessage(error, $localize`:@@lwConsoleImport-planError:The plan could not be created.`));
        this.busy.set(false);
      },
    });
  }

  discover(): void {
    this.service.discover(this.node()).subscribe({
      next: () => setTimeout(() => this.load(), 3_000),
      error: (error: unknown) =>
        this.error.set(
          apiErrorMessage(error, $localize`:@@lwConsoleImport-discoverError:The node could not discover again.`),
        ),
    });
  }

  discard(): void {
    this.service.discard(this.node()).subscribe({
      next: (result) => (result.nodeLeft ? void this.router.navigate(['/operate/imports']) : this.load()),
      error: (error: unknown) =>
        this.error.set(
          apiErrorMessage(error, $localize`:@@lwConsoleImport-discardError:The import could not be discarded.`),
        ),
    });
  }
}
