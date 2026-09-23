import { CommonModule, DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ContainerManagerFacade,
  type ContainerManagerContainer,
  type ContainerManagerHostInterface,
  type ContainerManagerHostRoute,
  type ContainerManagerNetworkEdge,
  type ContainerManagerNetworkNode,
  type ContainerManagerStatsHistoryPoint,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcLaneHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import type { ApexAxisChartSeries, ApexChart, ApexDataLabels, ApexTitleSubtitle, ApexXAxis } from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';

const BS_CHART_COLORS = ['var(--bs-primary)', 'var(--bs-info)', 'var(--bs-success)', 'var(--bs-warning)'] as const;
/** Pixels from bottom still treated as "pinned" for auto-scroll. */
const LOGS_STICK_BOTTOM_THRESHOLD_PX = 32;

interface TopologyLayoutNode {
  id: string;
  label: string;
  kind: ContainerManagerNetworkNode['kind'];
  x: number;
  y: number;
}

interface TopologyLayoutEdge {
  id: string;
  label?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TopologyPopoverModel {
  title: string;
  kindLabel: string;
  rows: Array<{ label: string; value: string }>;
}

const TOPOLOGY_NODE_RADIUS = 16;

@Component({
  selector: 'framework-container-manager-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcAlertComponent,
    FpcLaneHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcEmptyStateComponent,
  ],
  providers: [DatePipe],
  templateUrl: './container-manager-tab.component.html',
  styleUrls: ['./container-manager-tab.component.scss'],
})
export class ContainerManagerTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) subscriptionId!: string;
  @Input({ required: true }) itemId!: string;
  @Input() adminMode = false;

  private readonly facade = inject(ContainerManagerFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logsViewport = viewChild<ElementRef<HTMLPreElement>>('logsViewport');
  private readonly topologyWrap = viewChild<ElementRef<HTMLElement>>('topologyWrap');
  private readonly topologyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('topologyCanvas');

  private enteredKey = '';
  private stickLogsToBottom = true;
  private lastPinnedContainerId: string | null = null;
  private topologyTransform = { x: 0, y: 0, k: 1 };
  private topologyPanning = false;
  private topologyPointerMoved = false;
  private topologyLastPointer = { x: 0, y: 0 };
  private topologyDownPointer = { x: 0, y: 0 };
  private topologyDrawRaf = 0;
  private topologyFittedKey = '';
  private topologyResizeObserver: ResizeObserver | null = null;

  /** Mobile drawer; closed by default. Desktop always shows the sidebar via CSS. */
  readonly sidebarOpen = signal(false);
  /** Main pane: container detail (stats/logs) or network topology map. */
  readonly contentView = signal<'container' | 'network'>('container');
  readonly containerSearchPlaceholder = $localize`:@@featureContainerManager-searchPlaceholder:Search containers`;
  readonly searchQuery = signal('');
  readonly topologyHover = signal<TopologyPopoverModel | null>(null);
  readonly topologyPopoverPos = signal<{ left: number; top: number } | null>(null);

  readonly containers = toSignal(this.facade.containers$, { initialValue: [] as ContainerManagerContainer[] });
  readonly selectedContainerId = toSignal(this.facade.selectedContainerId$, { initialValue: null as string | null });
  readonly selectedContainer = toSignal(this.facade.selectedContainer$, {
    initialValue: null as ContainerManagerContainer | null,
  });
  readonly statsHistoryPoints = toSignal(this.facade.statsHistoryPoints$, {
    initialValue: [] as ContainerManagerStatsHistoryPoint[],
  });
  readonly logLines = toSignal(this.facade.logLines$, { initialValue: [] as string[] });
  readonly logsCollectedAt = toSignal(this.facade.logsCollectedAt$, { initialValue: null as string | null });
  readonly logsTruncated = toSignal(this.facade.logsTruncated$, { initialValue: false });
  readonly topologyNodes = toSignal(this.facade.topologyNodes$, {
    initialValue: [] as ContainerManagerNetworkNode[],
  });
  readonly topologyEdges = toSignal(this.facade.topologyEdges$, {
    initialValue: [] as ContainerManagerNetworkEdge[],
  });
  readonly hostInterfaces = toSignal(this.facade.hostInterfaces$, {
    initialValue: [] as ContainerManagerHostInterface[],
  });
  readonly hostRoutes = toSignal(this.facade.hostRoutes$, {
    initialValue: [] as ContainerManagerHostRoute[],
  });
  readonly loadingContainers = toSignal(this.facade.loadingContainers$, { initialValue: false });
  readonly loadingNetworks = toSignal(this.facade.loadingNetworks$, { initialValue: false });
  readonly loadingStatsHistory = toSignal(this.facade.loadingStatsHistory$, { initialValue: false });
  readonly loadingLogs = toSignal(this.facade.loadingLogs$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null as string | null });
  readonly containersCollectedAt = toSignal(this.facade.containersCollectedAt$, {
    initialValue: null as string | null,
  });
  readonly networksCollectedAt = toSignal(this.facade.networksCollectedAt$, {
    initialValue: null as string | null,
  });

  readonly filteredContainers = computed(() => {
    const term = this.searchQuery().trim().toLowerCase();
    const containers = this.containers();

    if (!term) {
      return containers;
    }

    return containers.filter((container) => {
      const haystack = [container.name, container.image, container.status, container.state]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

  readonly cpuChart = computed(() => this.buildCpuChart(this.statsHistoryPoints()));
  readonly memoryChart = computed(() => this.buildMemoryChart(this.statsHistoryPoints()));
  readonly logText = computed(() => this.logLines().join('\n'));
  readonly topologyLayout = computed(() => this.layoutTopology(this.topologyNodes(), this.topologyEdges()));
  readonly topologyLayoutEdges = computed(() => this.layoutTopologyEdges(this.topologyLayout(), this.topologyEdges()));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.facade.clear();
      this.topologyResizeObserver?.disconnect();
      this.topologyResizeObserver = null;

      if (this.topologyDrawRaf) {
        cancelAnimationFrame(this.topologyDrawRaf);
      }
    });

    afterRenderEffect(() => {
      const containerId = this.selectedContainerId();
      const text = this.logText();
      const viewport = this.logsViewport()?.nativeElement;

      if (containerId !== this.lastPinnedContainerId) {
        this.lastPinnedContainerId = containerId;
        this.stickLogsToBottom = true;
      }

      if (!this.stickLogsToBottom || !viewport || text.length === 0) {
        return;
      }

      viewport.scrollTop = viewport.scrollHeight;
    });

    effect(() => {
      const view = this.contentView();
      const nodes = this.topologyLayout();
      const edges = this.topologyLayoutEdges();
      const wrap = this.topologyWrap()?.nativeElement;
      const canvas = this.topologyCanvas()?.nativeElement;

      untracked(() => {
        if (view !== 'network' || !wrap || !canvas || nodes.length === 0) {
          return;
        }

        this.ensureTopologyResizeObserver(wrap);
        const fitKey = `${nodes.map((node) => node.id).join('|')}:${wrap.clientWidth}x${wrap.clientHeight}`;

        if (fitKey !== this.topologyFittedKey) {
          this.topologyFittedKey = fitKey;
          this.fitTopologyToView(nodes, wrap.clientWidth, wrap.clientHeight);
        }

        this.scheduleTopologyDraw(nodes, edges);
      });
    });
  }

  ngOnInit(): void {
    this.enterIfReady();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['subscriptionId'] && !changes['itemId'] && !changes['adminMode']) {
      return;
    }

    this.enterIfReady();
  }

  selectContainer(containerId: string): void {
    this.stickLogsToBottom = true;
    this.contentView.set('container');
    this.facade.selectContainerById(containerId);
    this.sidebarOpen.set(false);
  }

  openNetworkMap(): void {
    this.contentView.set('network');
    this.sidebarOpen.set(false);
    this.topologyFittedKey = '';
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  onTopologyPointerDown(event: PointerEvent): void {
    const canvas = this.topologyCanvas()?.nativeElement;

    if (!canvas) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    const point = this.topologyPointerPos(event);
    this.topologyDownPointer = point;
    this.topologyLastPointer = point;
    this.topologyPointerMoved = false;
    this.topologyPanning = true;
    this.hideTopologyPopover();
    canvas.classList.add('is-panning');
  }

  onTopologyPointerMove(event: PointerEvent): void {
    const point = this.topologyPointerPos(event);
    const moved =
      Math.abs(point.x - this.topologyDownPointer.x) > 4 || Math.abs(point.y - this.topologyDownPointer.y) > 4;

    if (moved) {
      this.topologyPointerMoved = true;
    }

    if (this.topologyPanning && this.topologyPointerMoved) {
      this.topologyTransform.x += point.x - this.topologyLastPointer.x;
      this.topologyTransform.y += point.y - this.topologyLastPointer.y;
      this.topologyLastPointer = point;
      this.hideTopologyPopover();
      this.scheduleTopologyDraw(this.topologyLayout(), this.topologyLayoutEdges());
      return;
    }

    this.topologyLastPointer = point;
    this.updateTopologyHover(point);
  }

  onTopologyPointerUp(event: PointerEvent): void {
    const canvas = this.topologyCanvas()?.nativeElement;
    this.topologyPanning = false;
    canvas?.classList.remove('is-panning');

    if (!this.topologyPointerMoved) {
      this.updateTopologyHover(this.topologyPointerPos(event));
    }
  }

  onTopologyPointerLeave(): void {
    if (!this.topologyPanning) {
      this.hideTopologyPopover();
    }
  }

  onTopologyWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = this.topologyPointerPos(event);
    const world = this.topologyScreenToWorld(point.x, point.y);
    const next = this.topologyTransform.k * (event.deltaY < 0 ? 1.12 : 0.9);

    if (!Number.isFinite(next) || next <= 0.2 || next > 6) {
      return;
    }

    this.topologyTransform.k = next;
    this.topologyTransform.x = point.x - world.x * next;
    this.topologyTransform.y = point.y - world.y * next;
    this.hideTopologyPopover();
    this.scheduleTopologyDraw(this.topologyLayout(), this.topologyLayoutEdges());
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onLogsScroll(event: Event): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    this.stickLogsToBottom = distanceFromBottom <= LOGS_STICK_BOTTOM_THRESHOLD_PX;
  }

  formatBytes(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) {
      return '—';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Math.max(0, value);
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  formatPercent(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) {
      return '—';
    }

    return `${value.toFixed(1)}%`;
  }

  containerStatusDotClass(container: ContainerManagerContainer): string {
    switch (this.containerStatusKind(container)) {
      case 'running':
        return 'bg-success';
      case 'restarting':
        return 'bg-warning';
      case 'paused':
        return 'bg-info';
      case 'stopped':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }

  containerStatusLabel(container: ContainerManagerContainer): string {
    switch (this.containerStatusKind(container)) {
      case 'running':
        return $localize`:@@featureContainerManager-statusRunning:Running`;
      case 'restarting':
        return $localize`:@@featureContainerManager-statusRestarting:Restarting`;
      case 'paused':
        return $localize`:@@featureContainerManager-statusPaused:Paused`;
      case 'stopped':
        return $localize`:@@featureContainerManager-statusStopped:Stopped`;
      default:
        return $localize`:@@featureContainerManager-statusUnknown:Unknown`;
    }
  }

  private containerStatusKind(
    container: ContainerManagerContainer,
  ): 'running' | 'restarting' | 'paused' | 'stopped' | 'unknown' {
    const state = (container.state ?? '').trim().toLowerCase();

    if (state === 'running') {
      return 'running';
    }

    if (state === 'restarting') {
      return 'restarting';
    }

    if (state === 'paused') {
      return 'paused';
    }

    if (state === 'created' || state === 'exited' || state === 'dead' || state === 'removing') {
      return 'stopped';
    }

    const status = (container.status ?? '').trim().toLowerCase();

    if (/^up\b/.test(status)) {
      return 'running';
    }

    if (/\brestart/.test(status)) {
      return 'restarting';
    }

    if (/\bpaused\b/.test(status)) {
      return 'paused';
    }

    if (/^(exited|created|dead|removal)\b/.test(status) || /\bexit/.test(status)) {
      return 'stopped';
    }

    return state || status ? 'stopped' : 'unknown';
  }

  private enterIfReady(): void {
    const subscriptionId = this.subscriptionId?.trim() ?? '';
    const itemId = this.itemId?.trim() ?? '';

    if (!subscriptionId || !itemId) {
      return;
    }

    const key = `${this.adminMode}:${subscriptionId}:${itemId}`;

    if (key === this.enteredKey) {
      return;
    }

    this.enteredKey = key;
    this.facade.enter(subscriptionId, itemId, this.adminMode);
  }

  private buildCpuChart(points: ContainerManagerStatsHistoryPoint[]) {
    if (points.length === 0) {
      return null;
    }

    const categories = points.map((point) => this.datePipe.transform(point.timestamp, 'short') ?? point.timestamp);
    const cpuColor = BS_CHART_COLORS[0];

    return {
      series: [
        {
          name: $localize`:@@featureContainerManager-cpuSeries:CPU %`,
          data: points.map((point) => point.cpuPercent ?? 0),
        },
      ] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 280,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [cpuColor],
      stroke: { colors: [cpuColor], width: 2 },
      fill: { colors: [cpuColor], opacity: 0.15 },
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: {
        categories,
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        min: 0,
        max: 100,
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
          formatter: (value: number) => `${value.toFixed(0)}%`,
        },
      },
      grid: { borderColor: 'var(--bs-border-color)' },
      legend: {
        show: false,
      },
      title: {
        text: $localize`:@@featureContainerManager-cpuHistoryTitle:CPU`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private buildMemoryChart(points: ContainerManagerStatsHistoryPoint[]) {
    if (points.length === 0) {
      return null;
    }

    const usageValues = points
      .map((point) => point.memoryUsageBytes)
      .filter((value): value is number => value != null && value >= 0);
    const limitValues = points
      .map((point) => point.memoryLimitBytes)
      .filter((value): value is number => value != null && value > 0);

    if (usageValues.length === 0 && limitValues.length === 0) {
      return null;
    }

    const maxBytes = Math.max(0, ...usageValues, ...limitValues);

    if (maxBytes <= 0) {
      return null;
    }

    const categories = points.map((point) => this.datePipe.transform(point.timestamp, 'short') ?? point.timestamp);
    const memoryColor = BS_CHART_COLORS[1];

    return {
      series: [
        {
          name: $localize`:@@featureContainerManager-memorySeries:Memory`,
          data: points.map((point) => point.memoryUsageBytes ?? 0),
        },
      ] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 280,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [memoryColor],
      stroke: { colors: [memoryColor], width: 2 },
      fill: { colors: [memoryColor], opacity: 0.15 },
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: {
        categories,
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        min: 0,
        max: maxBytes,
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
          formatter: (value: number) => this.formatBytes(value),
        },
      },
      grid: { borderColor: 'var(--bs-border-color)' },
      legend: {
        show: false,
      },
      title: {
        text: $localize`:@@featureContainerManager-memoryHistoryTitle:Memory`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
      tooltip: {
        y: {
          formatter: (value: number) => this.formatBytes(value),
        },
      },
    };
  }

  private layoutTopology(
    nodes: ContainerManagerNetworkNode[],
    edges: ContainerManagerNetworkEdge[],
  ): TopologyLayoutNode[] {
    if (nodes.length === 0) {
      return [];
    }

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const networks = nodes.filter((node) => node.kind === 'network');
    const containersByNetwork = new Map<string, string[]>();
    const dependentsByNetwork = new Map<string, string[]>();
    const hostIfacesByExit = new Map<string, string[]>();
    const uplinkIfacesByDockerIface = new Map<string, string[]>();
    const hostGwsByIface = new Map<string, string[]>();
    const internetByParent = new Map<string, string[]>();

    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);

      if (!from || !to) {
        continue;
      }

      if (from.kind === 'container' && to.kind === 'network') {
        const list = containersByNetwork.get(to.id) ?? [];
        list.push(from.id);
        containersByNetwork.set(to.id, list);
      }

      if (from.kind === 'network' && (to.kind === 'exit' || to.kind === 'route')) {
        const list = dependentsByNetwork.get(from.id) ?? [];
        list.push(to.id);
        dependentsByNetwork.set(from.id, list);
      }

      if (from.kind === 'exit' && to.kind === 'host_iface') {
        const list = hostIfacesByExit.get(from.id) ?? [];
        list.push(to.id);
        hostIfacesByExit.set(from.id, list);
      }

      if (from.kind === 'host_iface' && to.kind === 'host_iface') {
        const list = uplinkIfacesByDockerIface.get(from.id) ?? [];
        list.push(to.id);
        uplinkIfacesByDockerIface.set(from.id, list);
      }

      if (from.kind === 'host_iface' && to.kind === 'host_gateway') {
        const list = hostGwsByIface.get(from.id) ?? [];
        list.push(to.id);
        hostGwsByIface.set(from.id, list);
      }

      if ((from.kind === 'host_gateway' || from.kind === 'host_iface') && to.kind === 'internet') {
        const list = internetByParent.get(from.id) ?? [];
        list.push(to.id);
        internetByParent.set(from.id, list);
      }
    }

    const paddingX = 64;
    const paddingY = 48;
    const nodeGapX = 110;
    const layerGapY = 120;
    const forestGapX = 96;
    const placed = new Map<string, TopologyLayoutNode>();
    let cursorX = paddingX;

    const placeRow = (ids: string[], centerX: number, y: number): { left: number; right: number } => {
      const uniqueIds = [...new Set(ids)].filter((id) => byId.has(id) && !placed.has(id));

      if (uniqueIds.length === 0) {
        return { left: centerX, right: centerX };
      }

      const span = (uniqueIds.length - 1) * nodeGapX;
      const startX = centerX - span / 2;

      uniqueIds.forEach((id, index) => {
        const node = byId.get(id);

        if (!node) {
          return;
        }

        placed.set(id, {
          id: node.id,
          label: node.label,
          kind: node.kind,
          x: startX + index * nodeGapX,
          y,
        });
      });

      return { left: startX, right: startX + span };
    };

    const placeAt = (id: string, x: number, y: number): void => {
      if (placed.has(id)) {
        return;
      }

      const node = byId.get(id);

      if (!node) {
        return;
      }

      placed.set(id, {
        id: node.id,
        label: node.label,
        kind: node.kind,
        x,
        y,
      });
    };

    const yContainers = paddingY;
    const yNetwork = paddingY + layerGapY;
    const yDependents = paddingY + layerGapY * 2;
    const yHostIface = paddingY + layerGapY * 3;
    const yUplink = paddingY + layerGapY * 4;
    const yHostGateway = paddingY + layerGapY * 5;
    const yInternet = paddingY + layerGapY * 6;

    for (const network of networks) {
      const containers = containersByNetwork.get(network.id) ?? [];
      const dependents = dependentsByNetwork.get(network.id) ?? [];
      const linkedHostIfaces = dependents.flatMap((dependentId) => hostIfacesByExit.get(dependentId) ?? []);
      const branchWidth = Math.max(containers.length, dependents.length, linkedHostIfaces.length, 1) * nodeGapX;
      const centerX = cursorX + branchWidth / 2;

      const topBounds = placeRow(containers, centerX, yContainers);
      placeAt(network.id, centerX, yNetwork);
      const bottomBounds = placeRow(dependents, centerX, yDependents);
      const ifaceBounds = placeRow(linkedHostIfaces, centerX, yHostIface);

      const rightEdge = Math.max(
        topBounds.right,
        centerX,
        bottomBounds.right,
        ifaceBounds.right,
        cursorX + branchWidth,
      );
      cursorX = rightEdge + forestGapX;
    }

    const placedDockerIfaceIds = [...placed.values()]
      .filter((node) => node.kind === 'host_iface')
      .map((node) => node.id);
    const uplinkIfaceIds = [
      ...new Set(placedDockerIfaceIds.flatMap((ifaceId) => uplinkIfacesByDockerIface.get(ifaceId) ?? [])),
    ];

    // Also include default-route uplink ifaces that only have gateway edges (no docker NAT edge yet).
    for (const node of nodes) {
      if (node.kind === 'host_iface' && hostGwsByIface.has(node.id) && !placed.has(node.id)) {
        uplinkIfaceIds.push(node.id);
      }
    }

    const uniqueUplinkIds = [...new Set(uplinkIfaceIds)];
    const egressAnchors = placedDockerIfaceIds
      .map((id) => placed.get(id))
      .filter((node): node is TopologyLayoutNode => !!node);
    const egressCenterX =
      egressAnchors.length > 0 ? egressAnchors.reduce((sum, node) => sum + node.x, 0) / egressAnchors.length : paddingX;

    placeRow(uniqueUplinkIds, egressCenterX, yUplink);

    const ifaceIdsForGateway = [...placedDockerIfaceIds, ...uniqueUplinkIds.filter((id) => placed.has(id))];
    const gatewayIds = [...new Set(ifaceIdsForGateway.flatMap((ifaceId) => hostGwsByIface.get(ifaceId) ?? []))];
    const internetIds = [
      ...new Set([
        ...gatewayIds.flatMap((gwId) => internetByParent.get(gwId) ?? []),
        ...ifaceIdsForGateway.flatMap((ifaceId) => internetByParent.get(ifaceId) ?? []),
      ]),
    ];

    // Fallback: place any remaining gateway/internet nodes from the graph.
    for (const node of nodes) {
      if (node.kind === 'host_gateway' && !gatewayIds.includes(node.id)) {
        gatewayIds.push(node.id);
      }

      if (node.kind === 'internet' && !internetIds.includes(node.id)) {
        internetIds.push(node.id);
      }
    }

    if (gatewayIds.length > 0 || internetIds.length > 0) {
      const anchors = [...placed.values()].filter((node) => node.kind === 'host_iface');
      const centerX =
        anchors.length > 0 ? anchors.reduce((sum, node) => sum + node.x, 0) / anchors.length : egressCenterX;
      placeRow(gatewayIds, centerX, yHostGateway);
      placeRow(internetIds, centerX, yInternet);
    }

    const orphans = nodes.filter((node) => !placed.has(node.id));

    if (orphans.length > 0) {
      const y = networks.length > 0 ? yInternet + layerGapY : paddingY;
      placeRow(
        orphans.map((node) => node.id),
        paddingX + ((orphans.length - 1) * nodeGapX) / 2,
        y,
      );
    }

    return [...placed.values()];
  }

  private ensureTopologyResizeObserver(wrap: HTMLElement): void {
    if (this.topologyResizeObserver) {
      return;
    }

    this.topologyResizeObserver = new ResizeObserver(() => {
      const nodes = this.topologyLayout();
      const currentWrap = this.topologyWrap()?.nativeElement;

      if (currentWrap && nodes.length > 0) {
        this.fitTopologyToView(nodes, currentWrap.clientWidth, currentWrap.clientHeight);
        this.topologyFittedKey = `${nodes.map((node) => node.id).join('|')}:${currentWrap.clientWidth}x${currentWrap.clientHeight}`;
      }

      this.scheduleTopologyDraw(this.topologyLayout(), this.topologyLayoutEdges());
    });
    this.topologyResizeObserver.observe(wrap);
  }

  private scheduleTopologyDraw(nodes: TopologyLayoutNode[], edges: TopologyLayoutEdge[]): void {
    if (this.topologyDrawRaf) {
      cancelAnimationFrame(this.topologyDrawRaf);
    }

    this.topologyDrawRaf = requestAnimationFrame(() => {
      this.topologyDrawRaf = 0;
      this.drawTopology(nodes, edges);
    });
  }

  private fitTopologyToView(nodes: TopologyLayoutNode[], width: number, height: number): void {
    if (nodes.length === 0 || width <= 0 || height <= 0) {
      return;
    }

    const pad = 56;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    const contentW = Math.max(1, maxX - minX + pad * 2);
    const contentH = Math.max(1, maxY - minY + pad * 2);
    const scale = Math.min(width / contentW, height / contentH, 1.6);

    this.topologyTransform.k = scale;
    this.topologyTransform.x = width / 2 - ((minX + maxX) / 2) * scale;
    this.topologyTransform.y = height / 2 - ((minY + maxY) / 2) * scale;
  }

  private topologyPointerPos(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const canvas = this.topologyCanvas()?.nativeElement;
    const rect = canvas?.getBoundingClientRect();

    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  private topologyScreenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.topologyTransform.x) / this.topologyTransform.k,
      y: (sy - this.topologyTransform.y) / this.topologyTransform.k,
    };
  }

  private findTopologyNodeAt(sx: number, sy: number): TopologyLayoutNode | null {
    const nodes = this.topologyLayout();
    let hit: TopologyLayoutNode | null = null;
    let best = Infinity;
    const hitRadius = Math.max(12, TOPOLOGY_NODE_RADIUS * this.topologyTransform.k);

    for (const node of nodes) {
      const px = node.x * this.topologyTransform.k + this.topologyTransform.x;
      const py = node.y * this.topologyTransform.k + this.topologyTransform.y;
      const dx = px - sx;
      const dy = py - sy;
      const d2 = dx * dx + dy * dy;

      if (d2 <= hitRadius * hitRadius && d2 < best) {
        best = d2;
        hit = node;
      }
    }

    return hit;
  }

  private hideTopologyPopover(): void {
    this.topologyHover.set(null);
    this.topologyPopoverPos.set(null);
    this.topologyCanvas()?.nativeElement.classList.remove('is-hovering');
  }

  private updateTopologyHover(point: { x: number; y: number }): void {
    const hit = this.findTopologyNodeAt(point.x, point.y);
    const canvas = this.topologyCanvas()?.nativeElement;
    const wrap = this.topologyWrap()?.nativeElement;

    if (!hit || !canvas || !wrap) {
      this.hideTopologyPopover();
      return;
    }

    this.topologyHover.set(this.buildTopologyPopover(hit));
    canvas.classList.add('is-hovering');

    const pad = 12;
    const popoverWidth = 220;
    const popoverHeight = 140;
    let left = point.x + 14;
    let top = point.y + 14;

    if (left + popoverWidth + pad > wrap.clientWidth) {
      left = point.x - popoverWidth - 14;
    }

    if (top + popoverHeight + pad > wrap.clientHeight) {
      top = point.y - popoverHeight - 14;
    }

    this.topologyPopoverPos.set({
      left: Math.max(pad, Math.min(left, wrap.clientWidth - popoverWidth - pad)),
      top: Math.max(pad, Math.min(top, wrap.clientHeight - popoverHeight - pad)),
    });
  }

  private buildTopologyPopover(node: TopologyLayoutNode): TopologyPopoverModel {
    const rows: Array<{ label: string; value: string }> = [];

    if (node.kind === 'container') {
      const container = this.containers().find((item) => item.name === node.label || item.id === node.id);

      if (container) {
        rows.push({
          label: $localize`:@@featureContainerManager-topologyImage:Image`,
          value: container.image || '—',
        });
        rows.push({
          label: $localize`:@@featureContainerManager-topologyStatus:Status`,
          value: this.containerStatusLabel(container),
        });

        if (container.stats) {
          rows.push({
            label: $localize`:@@featureContainerManager-cpu:CPU`,
            value: this.formatPercent(container.stats.cpuPercent),
          });
          rows.push({
            label: $localize`:@@featureContainerManager-memory:Memory`,
            value: this.formatBytes(container.stats.memoryUsageBytes),
          });
        }
      }
    }

    if (node.kind === 'host_iface') {
      const ifaceName = node.id.startsWith('host_iface:') ? node.id.slice('host_iface:'.length) : node.label;
      const iface = this.hostInterfaces().find((item) => item.name === ifaceName);

      if (iface) {
        rows.push({
          label: $localize`:@@featureContainerManager-topologyStatus:Status`,
          value: iface.state || '—',
        });
        rows.push({
          label: $localize`:@@featureContainerManager-topologyAddresses:Addresses`,
          value: iface.addresses.length > 0 ? iface.addresses.join(', ') : '—',
        });
      }
    }

    if (node.kind === 'host_gateway' || node.kind === 'internet') {
      const relatedRoutes = this.hostRoutes().filter((route) => {
        if (node.kind === 'host_gateway') {
          const gatewayIp = node.id.startsWith('host_gw:') ? node.id.slice('host_gw:'.length) : node.label;

          return route.gateway === gatewayIp;
        }

        return route.destination === 'default' || route.destination === '0.0.0.0/0';
      });

      if (relatedRoutes.length > 0) {
        rows.push({
          label: $localize`:@@featureContainerManager-topologyRoutes:Routes`,
          value: relatedRoutes
            .map((route) => {
              const via = route.gateway ? ` via ${route.gateway}` : '';
              const dev = route.device ? ` dev ${route.device}` : '';

              return `${route.destination}${via}${dev}`;
            })
            .join('; '),
        });
      }
    }

    const connections = this.topologyEdges()
      .filter((edge) => edge.from === node.id || edge.to === node.id)
      .map((edge) => {
        const otherId = edge.from === node.id ? edge.to : edge.from;
        const other = this.topologyLayout().find((item) => item.id === otherId);
        const otherLabel = other?.label ?? otherId;
        return edge.label ? `${otherLabel} (${edge.label})` : otherLabel;
      });

    if (connections.length > 0) {
      rows.push({
        label: $localize`:@@featureContainerManager-topologyLinks:Links`,
        value: connections.join(', '),
      });
    }

    return {
      title: node.label,
      kindLabel: this.topologyKindLabel(node.kind),
      rows,
    };
  }

  private topologyKindLabel(kind: ContainerManagerNetworkNode['kind']): string {
    switch (kind) {
      case 'container':
        return $localize`:@@featureContainerManager-topologyKindContainer:Container`;
      case 'network':
        return $localize`:@@featureContainerManager-topologyKindNetwork:Network`;
      case 'exit':
        return $localize`:@@featureContainerManager-topologyKindExit:Exit`;
      case 'route':
        return $localize`:@@featureContainerManager-topologyKindRoute:Route`;
      case 'host_iface':
        return $localize`:@@featureContainerManager-topologyKindHostIface:Host interface`;
      case 'host_gateway':
        return $localize`:@@featureContainerManager-topologyKindHostGateway:Host gateway`;
      case 'internet':
        return $localize`:@@featureContainerManager-topologyKindInternet:Internet`;
      default:
        return kind;
    }
  }

  private readCssColor(variableName: string, fallback: string): string {
    const canvas = this.topologyCanvas()?.nativeElement;
    const raw = canvas ? getComputedStyle(canvas).getPropertyValue(variableName).trim() : '';

    return raw || fallback;
  }

  private drawTopology(nodes: TopologyLayoutNode[], edges: TopologyLayoutEdge[]): void {
    const canvas = this.topologyCanvas()?.nativeElement;
    const wrap = this.topologyWrap()?.nativeElement;

    if (!canvas || !wrap) {
      return;
    }

    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');

    if (!ctx || width <= 0 || height <= 0) {
      return;
    }

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(this.topologyTransform.x, this.topologyTransform.y);
    ctx.scale(this.topologyTransform.k, this.topologyTransform.k);

    const edgeColor = this.readCssColor('--bs-border-color', '#adb5bd');
    const bodyColor = this.readCssColor('--bs-body-color', '#212529');
    const bodyBg = this.readCssColor('--bs-body-bg', '#ffffff');
    const fontFamily = this.readCssColor('--bs-body-font-family', 'sans-serif');
    const colors: Record<ContainerManagerNetworkNode['kind'], string> = {
      container: this.readCssColor('--bs-primary', '#0d6efd'),
      network: this.readCssColor('--bs-info', '#0dcaf0'),
      exit: this.readCssColor('--bs-success', '#198754'),
      route: this.readCssColor('--bs-warning', '#ffc107'),
      host_iface: this.readCssColor('--bs-secondary', '#6c757d'),
      host_gateway: this.readCssColor('--bs-dark', '#212529'),
      internet: this.readCssColor('--bs-danger', '#dc3545'),
    };

    for (const edge of edges) {
      ctx.beginPath();
      ctx.moveTo(edge.x1, edge.y1);
      ctx.lineTo(edge.x2, edge.y2);
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 2 / this.topologyTransform.k;
      ctx.stroke();

      if (edge.label) {
        ctx.font = `${11 / this.topologyTransform.k}px ${fontFamily}`;
        ctx.fillStyle = bodyColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(edge.label, (edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2 - 6 / this.topologyTransform.k);
      }
    }

    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, TOPOLOGY_NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = colors[node.kind];
      ctx.fill();
      ctx.strokeStyle = bodyBg;
      ctx.lineWidth = 2 / this.topologyTransform.k;
      ctx.stroke();

      const label = node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label;
      ctx.font = `${11 / this.topologyTransform.k}px ${fontFamily}`;
      ctx.fillStyle = bodyColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, node.x, node.y + TOPOLOGY_NODE_RADIUS + 8 / this.topologyTransform.k);
    }

    ctx.restore();
  }

  private layoutTopologyEdges(nodes: TopologyLayoutNode[], edges: ContainerManagerNetworkEdge[]): TopologyLayoutEdge[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));

    return edges.flatMap((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);

      if (!from || !to) {
        return [];
      }

      return [
        {
          id: edge.id,
          label: edge.label,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
        },
      ];
    });
  }
}
