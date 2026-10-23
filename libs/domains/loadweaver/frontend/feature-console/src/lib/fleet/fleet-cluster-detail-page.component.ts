import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  apiErrorMessage,
  ConsoleFleetFacade,
  FLEET_ROLES,
  FleetService,
  isFleetClusterId,
  type FleetCloudStatus,
  type FleetCluster,
  type FleetGrant,
  type FleetRole,
  type FleetUser,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, map, take } from 'rxjs';

import { isGlobalAdmin } from '../guards/global-admin.guard';
import {
  FLEET_OPERATION_TONE,
  fleetConnectionIcon,
  fleetConnectionLabel,
  fleetConnectionTone,
  fleetOperationProgress,
  fleetOperationStatusLabel,
  fleetRoleLabel,
  fleetStepTone,
} from './fleet-format';

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * One fleet cluster (3.24): the connection and its health, the Loadweaver Cloud teardown / read-only grace and the
 * final backup (fleet admins), and the grants (fleet admins): per user, cluster-wide or one project, viewer /
 * operator / admin.
 */
@Component({
  selector: 'loadweaver-fleet-cluster-detail-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
  ],
  templateUrl: './fleet-cluster-detail-page.component.html',
  standalone: true,
})
export class LoadweaverFleetClusterDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly service = inject(FleetService);
  private readonly auth = inject(AuthenticationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly clusterId = signal<string>('');
  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly clustersLoaded = toSignal(this.facade.clustersLoaded$, { initialValue: false });
  readonly clustersError = toSignal(this.facade.clustersError$, { initialValue: null });
  readonly grants = toSignal(this.facade.grants$, { initialValue: [] as FleetGrant[] });
  readonly grantsLoading = toSignal(this.facade.grantsLoading$, { initialValue: false });
  readonly grantsError = toSignal(this.facade.grantsError$, { initialValue: null });
  readonly grantSaving = toSignal(this.facade.grantSaving$, { initialValue: false });
  readonly grantError = toSignal(this.facade.grantError$, { initialValue: null });
  readonly cloudStatus = toSignal(this.facade.cloudStatus$, { initialValue: {} as Record<string, FleetCloudStatus> });
  readonly cloudErrors = toSignal(this.facade.cloudErrors$, { initialValue: {} as Record<string, string> });
  readonly polling = toSignal(this.facade.polling$, { initialValue: [] as string[] });
  readonly admin = toSignal(isGlobalAdmin(this.auth), { initialValue: false });

  readonly cluster = computed(() => this.clusters().find((c) => c.id === this.clusterId()) ?? null);
  readonly cloud = computed(() => {
    const reference = this.cluster()?.reference;

    return reference ? (this.cloudStatus()[reference] ?? null) : null;
  });
  readonly cloudError = computed(() => {
    const reference = this.cluster()?.reference;

    return reference ? (this.cloudErrors()[reference] ?? null) : null;
  });

  /** Known fleet users by id (emails in the grant list); empty when the user API isn't available. */
  readonly users = signal<Record<string, string>>({});

  readonly grantOpen = signal(false);
  readonly revoking = signal<FleetGrant | null>(null);
  readonly grantFormError = signal<string | null>(null);
  readonly userResults = signal<FleetUser[]>([]);
  readonly userSearchError = signal<string | null>(null);
  readonly searching = signal(false);
  userQuery = '';
  grantUserId = '';
  grantProject = '';
  grantRole: FleetRole = 'viewer';

  readonly roles = FLEET_ROLES;
  readonly roleLabel = fleetRoleLabel;
  readonly connectionTone = fleetConnectionTone;
  readonly connectionIcon = fleetConnectionIcon;
  readonly connectionLabel = fleetConnectionLabel;
  readonly operationTone = FLEET_OPERATION_TONE;
  readonly operationStatusLabel = fleetOperationStatusLabel;
  readonly operationProgress = fleetOperationProgress;
  readonly stepTone = fleetStepTone;

  readonly backLabel = $localize`:@@lwConsoleFleetCluster-back:Back to the clusters`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetCluster-refresh:Refresh`;
  readonly grantTitle = $localize`:@@lwConsoleFleetCluster-grantTitle:Grant access`;
  readonly revokeTitle = $localize`:@@lwConsoleFleetCluster-revokeTitle:Remove the grant?`;
  readonly revokeMessage = $localize`:@@lwConsoleFleetCluster-revokeMessage:The user loses this access to the cluster through the fleet.`;
  readonly revokeConfirm = $localize`:@@lwConsoleFleetCluster-revokeConfirm:Remove`;
  readonly cancelLabel = $localize`:@@lwConsoleFleetCluster-cancel:Cancel`;
  readonly titleFallback = $localize`:@@lwConsoleFleetCluster-title:Cluster`;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.clusterId.set(params.get('id') ?? '');
      this.refresh();
    });
    this.facade.grantSaved$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.grantOpen.set(false));
    // Grants, Cloud status and user emails are for fleet admins.
    isGlobalAdmin(this.auth)
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.loadAdminData();
        this.service
          .users('', 100)
          .pipe(map((users) => Object.fromEntries(users.map((u) => [u.id, u.email]))))
          .subscribe({ next: (byId) => this.users.set(byId), error: () => undefined });
      });
  }

  refresh(): void {
    this.facade.loadClusters();

    if (this.admin()) this.loadAdminData();
  }

  private loadAdminData(): void {
    const id = this.clusterId();

    if (!isFleetClusterId(id)) return;

    this.facade.loadGrants(id);
    // The reference is known once the clusters are loaded.
    this.facade.clusters$
      .pipe(
        map((clusters) => clusters.find((c) => c.id === id)?.reference ?? null),
        filter((reference): reference is string => !!reference),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((reference) => this.facade.loadCloudStatus(reference));
  }

  title(): string {
    return this.cluster()?.name ?? this.titleFallback;
  }

  poll(): void {
    if (this.cluster()) this.facade.pollCluster(this.clusterId());
  }

  open(): void {
    this.facade.openCluster(this.clusterId());
  }

  userLabel(userId: string): string {
    return this.users()[userId] ?? userId;
  }

  openGrant(grant?: FleetGrant): void {
    this.grantUserId = grant?.userId ?? '';
    this.grantProject = grant?.project ?? '';
    this.grantRole = grant?.role ?? 'viewer';
    this.userQuery = grant ? this.userLabel(grant.userId) : '';
    this.userResults.set([]);
    this.userSearchError.set(null);
    this.grantFormError.set(null);
    this.grantOpen.set(true);
  }

  searchUsers(): void {
    this.searching.set(true);
    this.userSearchError.set(null);
    this.service.users(this.userQuery).subscribe({
      next: (users) => {
        this.searching.set(false);
        this.userResults.set(users);

        if (users.length === 1) this.grantUserId = users[0].id;
      },
      error: (error: unknown) => {
        this.searching.set(false);
        this.userResults.set([]);
        this.userSearchError.set(
          `${$localize`:@@lwConsoleFleetCluster-userSearchFailed:The user search is not available; enter the user id.`} (${apiErrorMessage(error, '')})`,
        );
      },
    });
  }

  saveGrant(): void {
    this.grantFormError.set(null);

    const userId = this.grantUserId.trim();
    const project = this.grantProject.trim();

    if (!isFleetClusterId(userId)) {
      this.grantFormError.set($localize`:@@lwConsoleFleetCluster-userRequired:Choose a user (or enter the user id).`);

      return;
    }

    if (project && !PROJECT.test(project)) {
      this.grantFormError.set(
        $localize`:@@lwConsoleFleetCluster-projectInvalid:Project: a project name of the cluster.`,
      );

      return;
    }

    this.facade.putGrant(this.clusterId(), { userId, role: this.grantRole, ...(project ? { project } : {}) });
  }

  askRevoke(grant: FleetGrant): void {
    this.revoking.set(grant);
  }

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revoking.set(null);
  }

  confirmRevoke(): void {
    const grant = this.revoking();

    if (grant) this.facade.deleteGrant(this.clusterId(), grant.id);

    this.revoking.set(null);
  }
}
