import { CommonModule, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { type ConsoleNode, ConsoleNodesFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcEmptyStateComponent,
  type FpcKeyValueItem,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcListHeaderComponent,
  FpcProgressComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, interval, map } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import { formatCores, LIFECYCLE_TONE, lifecycleLabel, usagePercent } from './node-format';
import { LoadweaverLaneComponent } from '../section/lane.component';

const REFRESH_MS = 15_000;

/**
 * One node (3.2, 3.21): lifecycle, connection and apply state, capacity, network and system, with the lifecycle
 * actions the API offers for its state (each confirmed first). These are runtime actions, not plans.
 * Layout (3.38): no own header strip (the object header names the node); lanes Status | Network & system with
 * `fpc-key-value-list` facts and `fpc-list-header` groups (Capacity, System).
 */
@Component({
  selector: 'loadweaver-node-detail-page',
  imports: [
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverLaneComponent,
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcEmptyStateComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcListHeaderComponent,
    FpcProgressComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './node-detail-page.component.html',
  standalone: true,
})
export class LoadweaverNodeDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleNodesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  readonly node = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });

  readonly name = signal<string | null>(null);
  /** Phone lane switch (3.37): Status & capacity | Network & system. */
  readonly lane = signal<'status' | 'system'>('status');
  readonly resources = computed(() => {
    const node = this.node();
    const capacity = node?.capacity;

    // Offline (2026-10-31): the last reported usage says nothing about now — no bars; the empty state says so.
    if (!node || !capacity || !node.connected) return [];

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
  readonly lifecycleLabel = lifecycleLabel;

  readonly statusFacts = computed<FpcKeyValueItem[]>(() => {
    const n = this.node();

    if (!n) return [];

    return [
      { key: 'lifecycle', label: this.lifecycleTitle },
      ...(n.controlPlane || n.witness ? [{ key: 'roles', label: this.rolesLabel }] : []),
      { key: 'site', label: $localize`:@@lwConsoleNodeDetail-site:Site`, value: n.site },
      {
        key: 'joined',
        label: $localize`:@@lwConsoleNodeDetail-joined:Joined`,
        value: this.date(n.joinedAt, 'mediumDate'),
      },
      {
        key: 'lastSeen',
        label: $localize`:@@lwConsoleNodeDetail-lastSeen:Last seen`,
        value: this.date(n.lastSeenAt, 'medium'),
      },
      { key: 'applied', label: $localize`:@@lwConsoleNodeDetail-applied:Applied revision` },
      ...(n.applyError ? [{ key: 'applyError', label: $localize`:@@lwConsoleNodeDetail-applyError:Apply error` }] : []),
      {
        key: 'certificate',
        label: $localize`:@@lwConsoleNodeDetail-certificate:Certificate valid until`,
        value: this.date(n.certificateNotAfter, 'mediumDate'),
      },
      { key: 'labels', label: $localize`:@@lwConsoleNodeDetail-labels:Labels` },
    ];
  });
  readonly networkFacts = computed<FpcKeyValueItem[]>(() => {
    const n = this.node();

    if (!n) return [];

    return [
      {
        key: 'endpoint',
        label: $localize`:@@lwConsoleNodeDetail-endpoint:Endpoint`,
        value: n.endpointHost,
        mono: true,
      },
      {
        key: 'overlay',
        label: $localize`:@@lwConsoleNodeDetail-overlay:Overlay`,
        value: joinPresent(n.overlayV4, n.overlayV6),
        mono: true,
      },
      {
        key: 'podSubnets',
        label: $localize`:@@lwConsoleNodeDetail-podSubnets:Pod subnets`,
        value: joinPresent(n.podSubnetV4, n.podSubnetV6),
        mono: true,
      },
    ];
  });
  readonly systemFacts = computed<FpcKeyValueItem[]>(() => {
    const n = this.node();

    if (!n) return [];

    const os = n.os;

    return [
      { key: 'agent', label: $localize`:@@lwConsoleNodeDetail-agent:Agent`, value: n.agentVersion },
      ...(os
        ? [
            {
              key: 'os',
              label: $localize`:@@lwConsoleNodeDetail-os:Operating system`,
              value: `${os.id} ${os.versionId} (${os.arch})`,
            },
            { key: 'kernel', label: $localize`:@@lwConsoleNodeDetail-kernel:Kernel`, value: os.kernel, mono: true },
          ]
        : []),
    ];
  });

  readonly title = $localize`:@@lwConsoleNodeDetail-title:Node`;
  readonly lifecycleTitle = $localize`:@@lwConsoleNodeDetail-lifecycle:Lifecycle`;
  readonly rolesLabel = $localize`:@@lwConsoleNodeDetail-roles:Roles`;
  readonly networkSystemTitle = $localize`:@@lwConsoleNodeDetail-networkSystem:Network & system`;
  readonly loadingLabel = $localize`:@@lwConsoleNodeDetail-loading:Loading the node`;
  readonly statusTitle = $localize`:@@lwConsoleNodeDetail-status:Status`;
  readonly capacityTitle = $localize`:@@lwConsoleNodeDetail-capacity:Capacity`;
  readonly systemTitle = $localize`:@@lwConsoleNodeDetail-system:System`;
  readonly cpuLabel = $localize`:@@lwConsoleNodeDetail-cpu:CPU`;
  readonly coresLabel = $localize`:@@lwConsoleNodeDetail-cores:cores`;
  readonly memoryLabel = $localize`:@@lwConsoleNodeDetail-memory:Memory`;
  readonly diskLabel = $localize`:@@lwConsoleNodeDetail-disk:Disk`;

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

  /** Lifecycle as a tone badge (left = neutral). */
  lifecycleTone(node: ConsoleNode): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
    const tone = LIFECYCLE_TONE[node.lifecycle];

    return tone === 'secondary' ? 'neutral' : tone;
  }

  private date(value: string | null | undefined, format: string): string | null {
    return value ? formatDate(value, format, this.locale) : null;
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }
}

function joinPresent(...values: (string | null | undefined)[]): string | null {
  const present = values.filter((v): v is string => !!v);

  return present.length > 0 ? present.join(' ') : null;
}
