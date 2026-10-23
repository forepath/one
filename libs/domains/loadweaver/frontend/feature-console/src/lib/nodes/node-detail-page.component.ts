import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleNodesFacade,
  type NodeAction,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, interval, map } from 'rxjs';

import { healthLink } from '../health/health-format';
import { formatBytes } from '../overview/console-format';
import {
  actionConfirmMessage,
  actionDangerous,
  actionIcon,
  actionLabel,
  formatCores,
  lifecycleLabel,
  nodeActions,
  nodeIcon,
  nodeTone,
  usagePercent,
} from './node-format';

const REFRESH_MS = 15_000;

/**
 * One node (3.2, 3.21): lifecycle, connection and apply state, capacity, network and system, with the lifecycle
 * actions the API offers for its state (each confirmed first). These are runtime actions, not plans.
 */
@Component({
  selector: 'loadweaver-node-detail-page',
  imports: [
    FpcPanelGridComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
  ],
  templateUrl: './node-detail-page.component.html',
  standalone: true,
})
export class LoadweaverNodeDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleNodesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly node = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly name = signal<string | null>(null);
  /** The action waiting for its confirmation. */
  readonly pending = signal<NodeAction | null>(null);

  readonly actions = computed(() => {
    const node = this.node();

    return node ? nodeActions(node, this.me()?.clusterRole) : [];
  });
  readonly resources = computed(() => {
    const node = this.node();
    const capacity = node?.capacity;

    if (!node || !capacity) return [];

    return [
      {
        id: 'cpu',
        label: this.cpuLabel,
        percent: usagePercent(node.usage?.cpuMillis, capacity.cpuMillis),
        text: `${formatCores(node.usage?.cpuMillis ?? 0)} / ${formatCores(capacity.cpuMillis)} ${this.coresLabel}`,
      },
      {
        id: 'memory',
        label: this.memoryLabel,
        percent: usagePercent(node.usage?.memoryBytes, capacity.memoryBytes),
        text: `${formatBytes(node.usage?.memoryBytes ?? 0)} / ${formatBytes(capacity.memoryBytes)}`,
      },
      {
        id: 'disk',
        label: this.diskLabel,
        percent: usagePercent(node.usage?.diskBytes, capacity.diskBytes),
        text: `${formatBytes(node.usage?.diskBytes ?? 0)} / ${formatBytes(capacity.diskBytes)}`,
      },
    ];
  });
  readonly confirmTitle = computed(() => {
    const action = this.pending();

    return action ? `${actionLabel(action)}?` : '';
  });
  readonly confirmLabel = computed(() => {
    const action = this.pending();

    return action ? actionLabel(action) : '';
  });
  readonly confirmDanger = computed(() => {
    const action = this.pending();

    return !!action && actionDangerous(action);
  });
  readonly confirmMessage = computed(() => {
    const action = this.pending();

    return action ? actionConfirmMessage(action, this.name() ?? '') : '';
  });

  readonly tone = nodeTone;
  readonly icon = nodeIcon;
  readonly lifecycleLabel = lifecycleLabel;
  readonly actionLabel = actionLabel;
  readonly actionIcon = actionIcon;
  readonly dangerous = actionDangerous;
  readonly healthLink = healthLink;

  readonly title = $localize`:@@lwConsoleNodeDetail-title:Node`;
  readonly backLabel = $localize`:@@lwConsoleNodeDetail-back:All nodes`;
  readonly healthLabel = $localize`:@@lwConsoleNodeDetail-health:Health`;
  readonly statusTitle = $localize`:@@lwConsoleNodeDetail-status:Status`;
  readonly capacityTitle = $localize`:@@lwConsoleNodeDetail-capacity:Capacity`;
  readonly networkTitle = $localize`:@@lwConsoleNodeDetail-network:Network`;
  readonly systemTitle = $localize`:@@lwConsoleNodeDetail-system:System`;
  readonly cpuLabel = $localize`:@@lwConsoleNodeDetail-cpu:CPU`;
  readonly coresLabel = $localize`:@@lwConsoleNodeDetail-cores:cores`;
  readonly memoryLabel = $localize`:@@lwConsoleNodeDetail-memory:Memory`;
  readonly diskLabel = $localize`:@@lwConsoleNodeDetail-disk:Disk`;
  readonly cancelLabel = $localize`:@@lwConsoleNodeDetail-cancel:Cancel`;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('name')),
        filter((name): name is string => !!name),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((name) => {
        this.name.set(name);
        this.facade.open(name);
      });
    // Drains take a while: follow the node while it is shown.
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const name = this.name();

        if (name) this.facade.open(name, true);
      });
  }

  ask(action: NodeAction): void {
    this.facade.clearActionError();
    this.pending.set(action);
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.pending.set(null);
  }

  confirm(): void {
    const action = this.pending();
    const name = this.name();

    if (action && name) this.facade.act(name, action);

    this.pending.set(null);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }
}
