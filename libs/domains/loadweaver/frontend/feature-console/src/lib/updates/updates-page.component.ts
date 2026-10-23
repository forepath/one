import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  isRolloutActive,
  type MaintenanceWindowResource,
  type ReleaseChannel,
  type Rollout,
  type UpdateRelease,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAccordionComponent,
  FpcAccordionItemComponent,
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { isGlobalAdmin } from '../guards/global-admin.guard';
import { formatBytes } from '../overview/console-format';
import {
  formatVersion,
  policyLabel,
  progressPercent,
  RELEASE_STATUS_TONE,
  releaseStatusLabel,
  ROLLOUT_STATUS_TONE,
  rolloutKindLabel,
  rolloutStatusLabel,
  sourceLabel,
  windowSchedule,
  windowScope,
  UPDATES_POLL_MS,
  windowTone,
} from './update-format';

/** Polling: every 5 s while a rollout runs or a bundle imports, otherwise every 30 s. */
const IDLE_POLL_TICKS = 6;

export type UpdatesTab = 'overview' | 'releases' | 'plans' | 'windows';

const TABS: UpdatesTab[] = ['overview', 'releases', 'plans', 'windows'];

/** The value of the plan dialog's release picker that means "no new release, host updates only". */
export const HOST_ONLY = '';

/**
 * Updates (3.26): cluster / control-plane / node versions with maintenance-window state, the update policy, releases
 * per channel with bundle download and upload, update plans and maintenance windows. Cluster roles read; cluster
 * admins download, upload, plan and run updates.
 */
@Component({
  selector: 'loadweaver-updates-page',
  imports: [
    FpcPanelGridComponent,
    FpcFormFieldComponent,
    FpcFormControlComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAccordionComponent,
    FpcAccordionItemComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './updates-page.component.html',
  standalone: true,
})
export class LoadweaverUpdatesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleUpdatesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly auth = inject(AuthenticationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly releasesByChannel = toSignal(this.facade.releasesByChannel$, {
    initialValue: { stable: [], beta: [] } as Record<ReleaseChannel, UpdateRelease[]>,
  });
  readonly plannable = toSignal(this.facade.plannableReleases$, { initialValue: [] as UpdateRelease[] });
  readonly rollouts = toSignal(this.facade.rollouts$, { initialValue: [] as Rollout[] });
  readonly windows = toSignal(this.facade.windows$, { initialValue: null as MaintenanceWindowResource[] | null });
  readonly clusterResource = toSignal(this.facade.clusterResource$, { initialValue: null });
  readonly loaded = toSignal(this.facade.loaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly busy = toSignal(this.facade.busy$, { initialValue: false });
  readonly downloading = toSignal(this.facade.downloading$, { initialValue: [] as string[] });
  readonly downloadError = toSignal(this.facade.downloadError$, { initialValue: null });
  readonly upload = toSignal(this.facade.upload$, { initialValue: null });
  readonly uploadError = toSignal(this.facade.uploadError$, { initialValue: null });
  readonly uploaded = toSignal(this.facade.uploaded$, { initialValue: null });
  readonly creating = toSignal(this.facade.creating$, { initialValue: false });
  readonly createError = toSignal(this.facade.createError$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly globalAdmin = toSignal(isGlobalAdmin(this.auth), { initialValue: false });

  readonly activeTab = signal<UpdatesTab>('overview');
  readonly bundleFile = signal<File | null>(null);
  readonly planOpen = signal(false);
  planVersion = HOST_ONLY;
  planHost = false;
  planOsUpgrade = false;

  readonly activeRollout = computed(() => {
    const id = this.status()?.activeRollout;

    return (id ? this.rollouts().find((r) => r.id === id) : this.rollouts().find(isRolloutActive)) ?? null;
  });
  readonly nodesWithoutWindow = computed(
    () => (this.status()?.nodes ?? []).filter((n) => !n.window.open && !n.window.opensAt).length,
  );
  readonly uploadPercent = computed(() => {
    const upload = this.upload();

    return upload && upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0;
  });
  /** A plan for the installed release only updates hosts. */
  readonly planHostOnly = signal(true);

  readonly hostOnly = HOST_ONLY;
  readonly statusTone = ROLLOUT_STATUS_TONE;
  readonly statusLabel = rolloutStatusLabel;
  readonly releaseTone = RELEASE_STATUS_TONE;
  readonly releaseLabel = releaseStatusLabel;
  readonly kindLabel = rolloutKindLabel;
  readonly policyLabel = policyLabel;
  readonly sourceLabel = sourceLabel;
  readonly schedule = windowSchedule;
  readonly scope = windowScope;
  readonly windowTone = windowTone;
  readonly percent = progressPercent;
  readonly version = formatVersion;
  readonly bytes = formatBytes;
  readonly isActive = isRolloutActive;

  readonly title = $localize`:@@lwConsoleUpdates-title:Updates`;
  readonly refreshLabel = $localize`:@@lwConsoleUpdates-refresh:Refresh`;
  readonly announcementsLabel = $localize`:@@lwConsoleUpdates-announcements:Announcements`;
  readonly planButtonLabel = $localize`:@@lwConsoleUpdates-planButton:Plan update`;
  readonly windowNewLabel = $localize`:@@lwConsoleUpdates-windowNew:New window`;
  readonly noReleaseHint = $localize`:@@lwConsolePlanUpdate-noRelease:No release bundle is imported yet: download or upload one under Releases first.`;
  readonly tabOverview = $localize`:@@lwConsoleUpdates-tabOverview:Overview`;
  readonly tabReleases = $localize`:@@lwConsoleUpdates-tabReleases:Releases`;
  readonly tabPlans = $localize`:@@lwConsoleUpdates-tabPlans:Update plans`;
  readonly tabWindows = $localize`:@@lwConsoleUpdates-tabWindows:Maintenance windows`;
  readonly clusterVersionLabel = $localize`:@@lwConsoleUpdates-clusterVersion:Cluster release`;
  readonly controlPlaneVersionLabel = $localize`:@@lwConsoleUpdates-controlPlaneVersion:Control plane`;
  readonly latestLabel = $localize`:@@lwConsoleUpdates-latestAvailable:Newest available`;
  readonly policyTitle = $localize`:@@lwConsoleUpdates-policyTitle:Update policy`;
  readonly nodesTitle = $localize`:@@lwConsoleUpdates-nodesTitle:Nodes`;
  readonly stableTitle = $localize`:@@lwConsoleUpdates-channelStable:Stable`;
  readonly betaTitle = $localize`:@@lwConsoleUpdates-channelBeta:Beta`;
  readonly uploadTitle = $localize`:@@lwConsoleUpdates-uploadTitle:Import a bundle`;
  readonly planTitle = $localize`:@@lwConsoleUpdates-planTitle:Plan an update`;
  readonly windowsTitle = $localize`:@@lwConsoleUpdates-windowsTitle:Maintenance windows`;
  readonly nodeWindowsTitle = $localize`:@@lwConsoleUpdates-nodeWindowsTitle:Next window per node`;
  readonly componentsLabel = $localize`:@@lwConsoleUpdates-components:Components`;

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab') as UpdatesTab | null;

    if (tab && TABS.includes(tab)) this.activeTab.set(tab);

    this.facade.load();

    let ticks = 0;

    interval(UPDATES_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        ticks++;

        if (this.busy() || ticks % IDLE_POLL_TICKS === 0) this.facade.load(true);
      });
  }

  refresh(): void {
    this.facade.load();
  }

  selectTab(tab: string | null): void {
    if (!tab || !TABS.includes(tab as UpdatesTab)) return;

    this.activeTab.set(tab as UpdatesTab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  open(rollout: Rollout): void {
    void this.router.navigate(['/updates/rollouts', rollout.id]);
  }

  /** Bundles come from GitHub / the mirror; uploads only (air-gapped) can't download. */
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

  onBundleSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    this.bundleFile.set(input.files?.[0] ?? null);
    this.facade.clearUpload();
  }

  startUpload(): void {
    const file = this.bundleFile();

    if (file) this.facade.upload(file);
  }

  cancelUpload(): void {
    this.facade.cancelUpload();
  }

  /** Opens the plan dialog, preselecting a release (or the newest available one). */
  openPlan(release?: UpdateRelease): void {
    const cluster = this.status()?.clusterVersion ?? null;
    const target = release ?? this.plannable().find((r) => r.version !== cluster);

    this.planVersion = target && target.version !== cluster ? target.version : HOST_ONLY;
    this.planHost = this.planVersion === HOST_ONLY;
    this.planOsUpgrade = false;
    this.planHostOnly.set(this.planVersion === HOST_ONLY);
    this.facade.clearCreateError();
    this.planOpen.set(true);
  }

  onPlanVersionChange(version: string): void {
    this.planVersion = version;
    this.planHostOnly.set(version === HOST_ONLY);

    if (version === HOST_ONLY) this.planHost = true;
  }

  onPlanHostChange(host: boolean): void {
    this.planHost = host;

    if (!host) this.planOsUpgrade = false;
  }

  createPlan(): void {
    const hostOnly = this.planVersion === HOST_ONLY;

    this.facade.create({
      ...(hostOnly ? {} : { version: this.planVersion }),
      host: hostOnly || this.planHost,
      osUpgrade: (hostOnly || this.planHost) && this.planOsUpgrade,
    });
  }

  /** Where the policy is changed: the Cluster resource in the resources editor. */
  clusterResourceLink(edit: boolean): string[] | null {
    const name = this.clusterResource();

    if (!name) return null;

    return edit ? ['/resources', 'Cluster', name, 'edit'] : ['/resources', 'Cluster', name];
  }
}
