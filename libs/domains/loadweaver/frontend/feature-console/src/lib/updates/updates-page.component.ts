import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  type MaintenanceWindowResource,
  type ReleaseChannel,
  type Rollout,
  type UpdateRelease,
  type UpdatesNodeStatus,
  type UpdatesStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcProgressComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { LoadweaverCreateKindButtonComponent } from '../nav/create-kind-button.component';
import { CREATE_HINT } from '../nav/create-kinds';
import { dlCopyIdItem, dlOpenItem, dlUserLabel } from '../section/data-list';
import { formatBytes } from '../overview/console-format';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { MasterDetailState } from '../section/master-detail.component';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import {
  formatVersion,
  progressPercent,
  RELEASE_STATUS_TONE,
  releaseStatusLabel,
  ROLLOUT_STATUS_TONE,
  rolloutKindLabel,
  rolloutStatusLabel,
  sourceLabel,
  UPDATES_POLL_MS,
  windowSchedule,
  windowScope,
  windowTone,
} from './update-format';
import { LoadweaverUpdatesPlanner } from './updates-planner';
import { ResourceModalService } from '../objects/resource-modal.service';

export { HOST_ONLY } from './updates-planner';

/** Polling: every 5 s while a rollout runs or a bundle imports, otherwise every 30 s. */
const IDLE_POLL_TICKS = 6;

/** The phone lane tabs (≥ md the lanes sit side by side). */
export type UpdatesLane = 'releases' | 'plans' | 'windows';

const LANES: UpdatesLane[] = ['releases', 'plans', 'windows'];

/**
 * Updates (3.26; 3.38: one level of lanes) — the list of the Updates master-detail shell: Releases (update policy,
 * releases per channel with bundle download and upload) | Update plans | Maintenance windows (windows and every node's
 * versions and next window). The shell's `summary` above is the page head (`LoadweaverUpdatesSummaryComponent`); an
 * open update plan (`rollouts/:id`) narrows this to the Update plans lane beside the detail (`fill` shell). Old
 * `?tab=releases|plans|windows` links pick the phone lane. Embedded in a node's Updates tab (`LW_SECTION_SCOPE`,
 * `q=<node>`): no Releases lane; plans touching the node and the node's windows (client-side: the API has no node
 * filter), no URL writes.
 */
@Component({
  selector: 'loadweaver-updates-page',
  imports: [
    LoadweaverCreateKindButtonComponent,
    LoadweaverSavedViewsComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcProgressComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    LoadweaverLaneComponent,
  ],
  templateUrl: './updates-page.component.html',
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  standalone: true,
})
export class LoadweaverUpdatesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleUpdatesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly resourceModal = inject(ResourceModalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  /** The plan dialog (rendered by the page head); absent when embedded. */
  readonly planner = inject(LoadweaverUpdatesPlanner, { optional: true });
  readonly scope = injectSectionScope();
  /** The node the embedding object fixes (`q`), else null. */
  readonly scopeNode = this.scope ? (sectionQuery(this.route, this.scope).get('q') ?? null) : null;

  readonly status = toSignal(this.facade.status$, { initialValue: null as UpdatesStatus | null });
  readonly releasesByChannel = toSignal(this.facade.releasesByChannel$, {
    initialValue: { stable: [], beta: [] } as Record<ReleaseChannel, UpdateRelease[]>,
  });
  readonly rollouts = toSignal(this.facade.rollouts$, { initialValue: [] as Rollout[] });
  readonly windows = toSignal(this.facade.windows$, { initialValue: null as MaintenanceWindowResource[] | null });
  /** Lane searches (3.37 lane grammar): releases, update plans (`search`), maintenance windows. */
  readonly releaseSearch = signal('');
  readonly search = signal('');
  readonly windowSearch = signal('');
  /** "Views ▾" (3.37): saved lane searches, per user. */
  readonly views = savedViewBinding({
    releaseSearch: this.releaseSearch,
    search: this.search,
    windowSearch: this.windowSearch,
  });
  /** The update plan open in the shell's detail lane (`rollouts/:id`). */
  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  readonly activeLane = signal<UpdatesLane>(this.scope ? 'plans' : 'releases');

  readonly shownReleases = computed(() => {
    const byChannel = this.releasesByChannel();
    const fields = (r: UpdateRelease) => [r.version, sourceLabel(r.source), releaseStatusLabel(r.status), r.importedBy];

    return {
      stable: filterBySearch(byChannel.stable, this.releaseSearch(), fields),
      beta: filterBySearch(byChannel.beta, this.releaseSearch(), fields),
    };
  });
  /** The plans of this view: all, or those touching the embedding node. */
  readonly scopedRollouts = computed(() =>
    this.scopeNode === null
      ? this.rollouts()
      : this.rollouts().filter((r) => r.steps.some((step) => step.node === this.scopeNode)),
  );
  readonly shownRollouts = computed(() =>
    filterBySearch(this.scopedRollouts(), this.search(), (r) => [
      r.fromVersion,
      r.toVersion,
      dlUserLabel(r.createdBy, r.createdByEmail),
      r.createdBy,
      rolloutStatusLabel(r.status),
      rolloutKindLabel(r.kind),
    ]),
  );
  /** The nodes of this view: all, or the embedding node. */
  readonly nodes = computed(() =>
    (this.status()?.nodes ?? []).filter((n) => this.scopeNode === null || n.name === this.scopeNode),
  );
  /** The windows of this view: all, or the embedding node's. */
  readonly scopedWindows = computed(() => {
    const windows = this.windows();

    if (windows === null || this.scopeNode === null) return windows;

    const names = new Set(this.nodes().flatMap((n) => n.window.windows));

    return windows.filter((w) => names.has(w.metadata.name));
  });
  readonly shownWindows = computed(() =>
    filterBySearch(this.scopedWindows() ?? [], this.windowSearch(), (w) => [
      w.metadata.name,
      w.spec.description,
      windowSchedule(w.spec),
      windowScope(w.spec),
    ]),
  );
  readonly shownNodes = computed(() =>
    filterBySearch(this.nodes(), this.windowSearch(), (n) => [n.name, n.site, n.window.windows, n.release]),
  );
  readonly policyFacts = computed<FpcKeyValueItem[]>(() => {
    const policy = this.status()?.policy;

    if (!policy) return [];

    return [
      {
        key: 'channel',
        label: $localize`:@@lwConsoleUpdates-channel:Channel`,
        value: policy.channel === 'beta' ? this.betaTitle : this.stableTitle,
      },
      {
        key: 'source',
        label: $localize`:@@lwConsoleUpdates-source:Bundles from`,
        value: sourceLabel(policy.source),
        hint: policy.mirrorUrl ?? null,
      },
      {
        key: 'os',
        label: $localize`:@@lwConsoleUpdates-osUpdates:OS updates`,
        value: policy.osUpdates
          ? $localize`:@@lwConsoleUpdates-osUpdatesOn:Included in automatic patches`
          : $localize`:@@lwConsoleUpdates-osUpdatesOff:Not included`,
      },
      {
        key: 'gates',
        label: $localize`:@@lwConsoleUpdates-gates:Health gates`,
        value: $localize`:@@lwConsoleUpdates-gatesValue:settle ${policy.settleSeconds}:settle: s, step timeout ${policy.stepTimeoutMinutes}:timeout: min`,
      },
    ];
  });
  readonly loaded = toSignal(this.facade.loaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly busy = toSignal(this.facade.busy$, { initialValue: false });
  readonly downloading = toSignal(this.facade.downloading$, { initialValue: [] as string[] });
  readonly downloadError = toSignal(this.facade.downloadError$, { initialValue: null });
  readonly upload = toSignal(this.facade.upload$, { initialValue: null });
  readonly uploadError = toSignal(this.facade.uploadError$, { initialValue: null });
  readonly uploaded = toSignal(this.facade.uploaded$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });

  readonly bundleFile = signal<File | null>(null);
  readonly uploadOpen = signal(false);

  readonly nodesWithoutWindow = computed(() => this.nodes().filter((n) => !n.window.open && !n.window.opensAt).length);
  readonly uploadPercent = computed(() => {
    const upload = this.upload();

    return upload && upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0;
  });

  readonly statusTone = ROLLOUT_STATUS_TONE;
  readonly statusLabel = rolloutStatusLabel;
  readonly releaseTone = RELEASE_STATUS_TONE;
  readonly releaseLabel = releaseStatusLabel;
  readonly kindLabel = rolloutKindLabel;
  readonly sourceLabel = sourceLabel;
  readonly schedule = windowSchedule;
  readonly windowScope = windowScope;
  readonly windowTone = windowTone;
  readonly percent = progressPercent;
  readonly version = formatVersion;
  readonly bytes = formatBytes;

  readonly title = $localize`:@@lwConsoleUpdates-title:Updates`;
  readonly windowEditLabel = $localize`:@@lwConsoleUpdates-windowEdit:Edit`;
  readonly downloadLabel = $localize`:@@lwConsoleUpdates-download:Download`;
  readonly planReleaseLabel = $localize`:@@lwConsoleUpdates-planRelease:Plan update`;
  readonly uploadTitle = $localize`:@@lwConsoleUpdates-uploadTitle:Import a bundle`;
  readonly releaseSearchLabel = $localize`:@@lwConsoleUpdates-search:Search releases`;
  readonly planSearchLabel = $localize`:@@lwConsoleUpdates-searchPlans:Search update plans`;
  readonly windowSearchLabel = $localize`:@@lwConsoleUpdates-searchWindows:Search maintenance windows`;
  readonly loadingLabel = $localize`:@@lwConsoleUpdates-loading:Loading updates`;
  readonly closeLabel = $localize`:@@lwConsoleUpdates-close:Close`;
  readonly tabReleases = $localize`:@@lwConsoleUpdates-tabReleases:Releases`;
  readonly tabPlans = $localize`:@@lwConsoleUpdates-tabPlans:Update plans`;
  readonly tabWindows = $localize`:@@lwConsoleUpdates-tabWindows:Maintenance windows`;
  readonly noWindowsMessage = `${$localize`:@@lwConsoleUpdates-noWindowsMessage:Without a window, updates that disturb nodes only run as approved emergency updates.`} ${CREATE_HINT}`;
  readonly policyTitle = $localize`:@@lwConsoleUpdates-policyTitle:Update policy`;
  readonly nodesTitle = $localize`:@@lwConsoleUpdates-nodesTitle:Nodes`;
  readonly stableTitle = $localize`:@@lwConsoleUpdates-channelStable:Stable`;
  readonly betaTitle = $localize`:@@lwConsoleUpdates-channelBeta:Beta`;
  readonly componentsLabel = $localize`:@@lwConsoleUpdates-components:Components`;
  readonly signedLabel = $localize`:@@lwConsoleUpdates-signed:Signed`;
  readonly unsignedLabel = $localize`:@@lwConsoleUpdates-unsigned:Unsigned`;
  readonly runningLabel = $localize`:@@lwConsoleUpdates-running:Running`;
  readonly emergencyLabel = $localize`:@@lwConsoleUpdates-emergencyBadge:Emergency`;
  readonly automaticLabel = $localize`:@@lwConsoleUpdates-automaticBadge:Automatic`;
  readonly controlPlaneLabel = $localize`:@@lwConsoleUpdates-controlPlaneBadge:Control plane`;
  readonly rebootRequiredLabel = $localize`:@@lwConsoleUpdates-rebootRequired:Reboot required`;
  readonly agentOnlyLabel = $localize`:@@lwConsoleUpdates-agentOnly:Agent without component updates`;

  /** Releases: one table grouped by channel (3.38 D1). */
  readonly releaseRows = computed(() => [...this.shownReleases().stable, ...this.shownReleases().beta]);
  readonly releaseId = (r: UpdateRelease): string => r.version;
  readonly releaseChannel = (r: UpdateRelease): string => r.channel;
  readonly channelLabel = (key: string): string => (key === 'beta' ? this.betaTitle : this.stableTitle);
  readonly notesOf = (r: UpdateRelease): string[] => [...r.notes, ...(r.announcement?.changelog ?? [])];
  readonly expandedRelease = signal<string | null>(null);
  readonly componentId = (c: UpdateRelease['components'][number]): string => c.name;
  readonly componentColumns: FpcTableColumn<UpdateRelease['components'][number]>[] = [
    { id: 'name', label: this.componentsLabel, value: (c) => c.name, mono: true, required: true, priority: 1 },
    { id: 'kind', label: $localize`:@@lwConsoleUpdates-colKind:Kind`, value: (c) => c.kind, priority: 2 },
    {
      id: 'version',
      label: $localize`:@@lwConsoleUpdates-colVersion:Version`,
      value: (c) => c.version,
      mono: true,
      priority: 1,
    },
  ];
  readonly releaseColumns: FpcTableColumn<UpdateRelease>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleUpdates-colStatus:Status`,
      type: 'state',
      state: (r) => ({ label: releaseStatusLabel(r.status), tone: RELEASE_STATUS_TONE[r.status] }),
    },
    {
      id: 'version',
      label: $localize`:@@lwConsoleUpdates-colVersion:Version`,
      value: (r) => r.version,
      required: true,
      priority: 1,
    },
    { id: 'flags', label: $localize`:@@lwConsoleUpdates-colFlags:Flags`, width: '5rem', priority: 1 },
    {
      id: 'source',
      label: $localize`:@@lwConsoleUpdates-colSource:Source`,
      value: (r) => sourceLabel(r.source),
      priority: 3,
    },
    {
      id: 'published',
      label: $localize`:@@lwConsoleUpdates-published:Published`,
      value: (r) => r.announcement?.publishedAt ?? '',
      priority: 2,
    },
    {
      id: 'imported',
      label: $localize`:@@lwConsoleUpdates-imported:Imported`,
      value: (r) => r.importedAt ?? '',
      priority: 3,
    },
    {
      id: 'importedBy',
      label: $localize`:@@lwConsoleUpdates-colImportedBy:Imported by`,
      value: (r) => r.importedBy ?? '',
      priority: 3,
      hidden: true,
    },
    { id: 'error', label: $localize`:@@lwConsoleUpdates-colError:Error`, priority: 2 },
  ];
  readonly releaseMenu = (r: UpdateRelease): FpcMenuItem[] => [
    ...(this.mayDownload(r) ? [{ id: 'download', label: this.downloadLabel, icon: 'cloud-download' }] : []),
    ...(this.isClusterAdmin() && this.planner && r.status === 'available'
      ? [{ id: 'plan', label: this.planReleaseLabel, icon: 'calendar-plus' }]
      : []),
    { id: 'details', label: this.detailsLabel, icon: 'chevron-expand' },
  ];
  readonly detailsLabel = $localize`:@@lwConsoleUpdates-details:Notes and components`;

  /** Update plans (rollouts): State · Update (link) · flags · kind · created · by · progress. */
  readonly rolloutColumns: FpcTableColumn<Rollout>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleUpdates-colStatus:Status`,
      type: 'state',
      state: (r) => ({ label: rolloutStatusLabel(r.status), tone: ROLLOUT_STATUS_TONE[r.status] }),
    },
    {
      id: 'update',
      label: $localize`:@@lwConsoleUpdates-colUpdate:Update`,
      value: (r) => `${formatVersion(r.fromVersion)} → ${r.toVersion}`,
      required: true,
      priority: 1,
    },
    { id: 'flags', label: $localize`:@@lwConsoleUpdates-colFlags:Flags`, width: '6rem', priority: 2 },
    {
      id: 'kind',
      label: $localize`:@@lwConsoleUpdates-colKind:Kind`,
      value: (r) => rolloutKindLabel(r.kind),
      priority: 3,
    },
    { id: 'created', label: $localize`:@@lwConsoleUpdates-colCreated:Created`, value: (r) => r.createdAt, priority: 1 },
    {
      id: 'createdBy',
      label: $localize`:@@lwConsoleUpdates-colCreatedBy:Created by`,
      value: (r) => dlUserLabel(r.createdBy, r.createdByEmail),
      priority: 3,
    },
    {
      id: 'progress',
      label: $localize`:@@lwConsoleUpdates-colProgress:Progress`,
      value: (r) => progressPercent(r),
      width: '9rem',
      priority: 2,
    },
  ];
  readonly rolloutLink = (r: Rollout): string => `/delivery/updates/rollouts/${encodeURIComponent(r.id)}`;
  readonly rolloutMenu = (): FpcMenuItem[] => [dlOpenItem(), dlCopyIdItem()];

  /** Maintenance windows | nodes (tabs in the Windows lane, decision 4). */
  readonly windowsTab = signal<'windows' | 'nodes'>('windows');
  readonly windowId = (w: MaintenanceWindowResource): string => w.metadata.name;
  readonly windowLink = (w: MaintenanceWindowResource): string =>
    `/resources/maintenancewindow/-/${encodeURIComponent(w.metadata.name)}`;
  readonly windowColumns: FpcTableColumn<MaintenanceWindowResource>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleUpdates-colWindow:Window`,
      value: (w) => w.metadata.name,
      required: true,
      priority: 1,
    },
    {
      id: 'schedule',
      label: $localize`:@@lwConsoleUpdates-colSchedule:Schedule`,
      value: (w) => windowSchedule(w.spec),
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleUpdates-colScope:Applies to`,
      value: (w) => windowScope(w.spec),
      priority: 2,
    },
    {
      id: 'description',
      label: $localize`:@@lwConsoleUpdates-colDescription:Description`,
      value: (w) => w.spec.description ?? '',
      priority: 3,
    },
  ];
  readonly windowMenu = (): FpcMenuItem[] => [
    dlOpenItem(),
    ...(this.isClusterAdmin() ? [{ id: 'edit', label: this.windowEditLabel, icon: 'pencil' }] : []),
  ];
  readonly nodeId = (n: UpdatesNodeStatus): string => n.name;
  readonly nodeColumns: FpcTableColumn<UpdatesNodeStatus>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleUpdates-colWindowState:Window`,
      type: 'state',
      state: (n) =>
        !n.connected
          ? { label: $localize`:@@lwConsoleUpdates-disconnected:Disconnected`, tone: 'danger' }
          : n.window.open
            ? { label: $localize`:@@lwConsoleUpdates-windowOpen:Window open`, tone: 'success', icon: 'calendar-check' }
            : n.window.opensAt
              ? { label: $localize`:@@lwConsoleUpdates-windowNext:Next window`, tone: 'info', icon: 'calendar-week' }
              : {
                  label: $localize`:@@lwConsoleUpdates-windowNone:No maintenance window`,
                  tone: 'neutral',
                  icon: 'calendar-x',
                },
    },
    { id: 'name', label: this.nodesTitle, value: (n) => n.name, required: true, priority: 1 },
    { id: 'flags', label: $localize`:@@lwConsoleUpdates-colFlags:Flags`, width: '6rem', priority: 2 },
    { id: 'site', label: $localize`:@@lwConsoleUpdates-colSite:Site`, value: (n) => n.site, priority: 3 },
    {
      id: 'release',
      label: $localize`:@@lwConsoleUpdates-release:Release`,
      value: (n) => formatVersion(n.release),
      mono: true,
      priority: 2,
    },
    {
      id: 'target',
      label: $localize`:@@lwConsoleUpdates-colTarget:Target`,
      value: (n) => n.target ?? '',
      mono: true,
      priority: 2,
    },
    {
      id: 'agent',
      label: $localize`:@@lwConsoleUpdates-agent:Agent`,
      value: (n) => formatVersion(n.agentVersion),
      mono: true,
      priority: 3,
    },
    {
      id: 'window',
      label: $localize`:@@lwConsoleUpdates-colNextWindow:Maintenance window`,
      value: (n) => n.window.opensAt ?? '',
      priority: 1,
    },
    { id: 'os', label: $localize`:@@lwConsoleUpdates-colOs:OS`, value: (n) => n.os ?? '', priority: 3, hidden: true },
    {
      id: 'kernel',
      label: $localize`:@@lwConsoleUpdates-colKernel:Kernel`,
      value: (n) => n.kernel ?? '',
      mono: true,
      priority: 3,
      hidden: true,
    },
    {
      id: 'overrides',
      label: $localize`:@@lwConsoleUpdates-overrides:Overrides`,
      value: (n) => n.overrides.join(', '),
      priority: 3,
      hidden: true,
    },
  ];

  ngOnInit(): void {
    // Old `?tab=releases|plans|windows` links pick the lane shown on phones (read only, never written).
    const tab = sectionQuery(this.route, this.scope).get('tab') as UpdatesLane | null;

    if (!this.scope && tab && LANES.includes(tab)) this.activeLane.set(tab);

    this.facade.load();

    let ticks = 0;

    interval(UPDATES_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        ticks++;

        if (this.busy() || ticks % IDLE_POLL_TICKS === 0) this.facade.load(true);
      });
  }

  selectLane(lane: string | null): void {
    if (lane && LANES.includes(lane as UpdatesLane)) this.activeLane.set(lane as UpdatesLane);
  }

  open(rollout: Rollout): void {
    void this.router.navigate(['/delivery/updates/rollouts', rollout.id]);
  }

  /** Bundles come from GitHub / the mirror; uploads only (air-gapped) can't download. */
  toggleRelease(release: UpdateRelease): void {
    this.expandedRelease.set(this.expandedRelease() === release.version ? null : release.version);
  }

  onReleaseAction(release: UpdateRelease, action: string): void {
    if (action === 'download') this.download(release);
    else if (action === 'plan') this.openPlan(release);
    else if (action === 'details') this.toggleRelease(release);
  }

  onRolloutAction(rollout: Rollout, action: string): void {
    if (action === 'open') this.open(rollout);
    else if (action === 'copy-id') fpcCopyText(rollout.id);
  }

  onWindowAction(window: MaintenanceWindowResource, action: string): void {
    const route = ['/resources', 'maintenancewindow', '-', window.metadata.name];

    if (action === 'open') void this.router.navigate(route);
    else if (action === 'edit')
      this.resourceModal.openEdit({ kind: 'MaintenanceWindow', name: window.metadata.name, project: null });
  }

  mayDownload(release: UpdateRelease): boolean {
    return (
      this.isClusterAdmin() &&
      this.status()?.policy.source !== 'upload' &&
      (release.status === 'announced' || release.status === 'failed')
    );
  }

  download(release: UpdateRelease): void {
    this.facade.download(release.version);
  }

  openPlan(release?: UpdateRelease): void {
    this.planner?.start(release);
  }

  openUpload(): void {
    this.uploadOpen.set(true);
  }

  onBundleSelected(files: FileList | null): void {
    this.bundleFile.set(files?.[0] ?? null);
    this.facade.clearUpload();
  }

  startUpload(): void {
    const file = this.bundleFile();

    if (file) this.facade.upload(file);
  }

  cancelUpload(): void {
    this.facade.cancelUpload();
  }
}
