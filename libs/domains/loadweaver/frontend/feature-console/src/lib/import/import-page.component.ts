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
  type VolumeHandling,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import {
  CONFLICT_TONE,
  formatBytes,
  initialSelections,
  needsHostname,
  selectionsBody,
  STATUS_TONE,
  STEP_TONE,
} from './import-format';

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
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
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
  readonly wipeFormerIdentity = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflictTone = CONFLICT_TONE;
  readonly statusTone = STATUS_TONE;
  readonly stepTone = STEP_TONE;
  readonly formatBytes = formatBytes;
  readonly needsHostname = needsHostname;

  readonly title = computed(() => $localize`:@@lwConsoleImport-title:Import ${this.node()}:node:`);
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
      next: (plan) => void this.router.navigate(['/plans', plan.id]),
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
      next: (result) => (result.nodeLeft ? void this.router.navigate(['/imports']) : this.load()),
      error: (error: unknown) =>
        this.error.set(
          apiErrorMessage(error, $localize`:@@lwConsoleImport-discardError:The import could not be discarded.`),
        ),
    });
  }
}
