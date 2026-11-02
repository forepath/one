import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  BackordersFacade,
  BillingDashboardSocketFacade,
  CustomerProfileFacade,
  getBillingServerLocationLabel,
  InvoicesFacade,
  isBillingServerOff,
  isBillingServerOnline,
  isBillingServerStartable,
  isBillingServerStatusTransitional,
  ProjectsFacade,
  resolveServiceDisplayLabel,
  SubscriptionItemsService,
  SubscriptionServerInfoFacade,
  SubscriptionsFacade,
  type BackorderResponse,
  type InvoicesSummaryResponse,
  type ProjectListItem,
  type ServerInfoResponse,
  type SubscriptionResponse,
  type SubscriptionWithServerInfo,
  integratedProvisioningServiceLabel,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcModalComponent,
  FpcModalFooterDirective,
  type FpcBadgeTone,
} from '@forepath/shared/frontend/ui-components';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/decabill/frontend/util-configuration';
import { combineLatest, distinctUntilChanged, filter, finalize, firstValueFrom, map, pairwise, take } from 'rxjs';

import {
  getProfileCompleteLabel,
  getProvisioningStatusBadgeTone,
  getProvisioningStatusLabel,
} from '../billing-status-labels';
import { hideBillingModal, showBillingModal } from '../billing-modal';
import { DB_DL_CANCEL, dbBulkSummary, dbCopyIdItem, dbOpenItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { provisioningState } from '../shared/table-states';

@Component({
  selector: 'framework-billing-overview',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent implements OnInit {
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  readonly serverInfoFacade = inject(SubscriptionServerInfoFacade);
  private readonly subscriptionItemsService = inject(SubscriptionItemsService);
  private readonly router = inject(Router);
  private readonly billingDashboardSocketFacade = inject(BillingDashboardSocketFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly backordersFacade = inject(BackordersFacade);
  private readonly projectsFacade = inject(ProjectsFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly invoicesFacade = inject(InvoicesFacade);

  readonly sshAccessConfirmModalOpen = signal(false);
  readonly sshAccessDisplayModalOpen = signal(false);

  sshRevealTarget: SubscriptionWithServerInfo | null = null;
  revealedSshPrivateKey: string | null = null;
  sshRevealLoading = false;
  sshRevealError: string | null = null;
  sshAccessKeyCopied = false;

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
  readonly subscriptionsSummary = toSignal(this.subscriptionsFacade.getSubscriptionsSummary$(), {
    initialValue: null,
  });
  readonly subscriptionsSummaryLoading$ = this.subscriptionsFacade.getSubscriptionsSummaryLoading$();
  readonly invoicesSummary$ = this.invoicesFacade.getInvoicesSummary$();
  readonly invoicesSummary = toSignal(this.invoicesFacade.getInvoicesSummary$(), {
    initialValue: null as InvoicesSummaryResponse | null,
  });
  readonly invoicesSummaryLoading$ = this.invoicesFacade.getInvoicesSummaryLoading$();
  readonly subscriptionsLoading$ = this.subscriptionsFacade.getSubscriptionsLoading$();
  readonly subscriptionsError$ = this.subscriptionsFacade.getSubscriptionsError$();
  readonly activeSubscriptions$ = this.subscriptionsFacade.getActiveSubscriptions$();
  readonly activeSubscriptions = toSignal(this.subscriptionsFacade.getActiveSubscriptions$(), {
    initialValue: [] as SubscriptionResponse[],
  });

  readonly subscriptionsWithServerInfo$ = this.serverInfoFacade.getSubscriptionsWithServerInfo$();
  readonly subscriptionsWithServerInfo = toSignal(this.serverInfoFacade.getSubscriptionsWithServerInfo$(), {
    initialValue: [] as SubscriptionWithServerInfo[],
  });
  readonly subscriptionsHasMore = toSignal(this.subscriptionsFacade.getHasMore$(), { initialValue: false });
  /**
   * X-12: the instances table pages over subscriptions (the rows are the page's live instances). A first page without
   * any instance shows the empty state only, no pager / size select; once instances show, more pages page as before.
   */
  readonly instancesHasNext = computed(
    () => this.subscriptionsHasMore() && (this.paging.page() > 1 || this.subscriptionsWithServerInfo().length > 0),
  );
  /** Search + page + page size → `GET /subscriptions?limit&offset&search` (replace-page; the API has no total). */
  readonly paging = dbServerPaging((query) =>
    this.subscriptionsFacade.loadSubscriptions({
      search: query.search,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
  );

  readonly cloudInstancesLabel = $localize`:@@featureOverview-cloudInstances:Cloud instances`;
  readonly sshGrantedLabel = $localize`:@@featureOverview-sshAccessGrantedBadge:SSH access granted`;
  readonly startLabel = $localize`:@@featureOverview-serverStartButtonTitle:Start server`;
  readonly stopLabel = $localize`:@@featureOverview-serverStopButtonTitle:Stop server`;
  readonly restartLabel = $localize`:@@featureOverview-serverRestartButtonTitle:Restart server`;
  readonly openConsoleLabel = $localize`:@@featureOverview-openConsoleButtonTitle:Open console`;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly bulkStopTitle = $localize`:@@featureOverview-bulkStopTitle:Stop servers?`;

  readonly instanceRowId = (item: SubscriptionWithServerInfo): string => `${item.subscription.id}:${item.itemId}`;
  readonly instanceLink = (item: SubscriptionWithServerInfo): string | null =>
    item.itemId && this.isInstanceReady(item)
      ? `/subscriptions/${encodeURIComponent(item.subscription.id)}/services/${encodeURIComponent(item.itemId)}?from=dashboard`
      : null;

  /** Cloud instances: State · Instance · service · server type / location · hostname · IPs. */
  readonly instanceColumns: FpcTableColumn<SubscriptionWithServerInfo>[] = [
    {
      id: 'state',
      label: $localize`:@@featureOverview-colState:State`,
      type: 'state',
      state: (item) => this.instanceState(item),
    },
    {
      id: 'name',
      label: $localize`:@@featureOverview-colInstance:Instance`,
      value: (item) => this.instanceDisplayTitle(item),
      required: true,
      priority: 1,
    },
    {
      id: 'service',
      label: $localize`:@@featureOverview-colService:Service`,
      value: (item) => this.serviceTypeLabel(item.service),
      priority: 1,
    },
    {
      id: 'server',
      label: $localize`:@@featureOverview-colServer:Server`,
      value: (item) =>
        [item.serviceTypeName, item.serverInfo ? this.serverLocationLabel(item.serverInfo.metadata) : null]
          .filter((part): part is string => !!part)
          .join(' · '),
      priority: 2,
    },
    {
      id: 'hostname',
      label: $localize`:@@featureOverview-colHostname:Hostname`,
      value: (item) => item.serverInfo?.hostnameFqdn ?? '',
      priority: 2,
    },
    {
      id: 'publicIp',
      label: $localize`:@@featureOverview-colPublicIp:Public IP`,
      value: (item) => item.serverInfo?.publicIp ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'privateIp',
      label: $localize`:@@featureOverview-colPrivateIp:Private IP`,
      value: (item) => item.serverInfo?.privateIp ?? '',
      mono: true,
      priority: 3,
      hidden: true,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkStop = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  private readonly selectedInstances = computed(() => {
    const ids = new Set(this.selected());

    return this.subscriptionsWithServerInfo().filter((item) => ids.has(this.instanceRowId(item)));
  });
  readonly bulkStopMessage = computed(
    () =>
      $localize`:@@featureOverview-bulkStopMessage:${this.bulkTargets('stop').length}:count: selected servers will be stopped. Servers you may not stop are reported and left as they are.`,
  );

  readonly instanceMenu = (item: SubscriptionWithServerInfo): FpcMenuItem[] => {
    const menu: FpcMenuItem[] = [];

    if (this.instanceLink(item)) menu.push(dbOpenItem());

    if (this.canRunServerAction(item, 'start')) menu.push({ id: 'start', label: this.startLabel, icon: 'play-fill' });

    if (this.canRunServerAction(item, 'stop')) menu.push({ id: 'stop', label: this.stopLabel, icon: 'stop-fill' });

    if (this.canRunServerAction(item, 'restart')) {
      menu.push({ id: 'restart', label: this.restartLabel, icon: 'arrow-clockwise' });
    }

    if (this.isInstanceReady(item)) {
      menu.push({
        id: 'ssh',
        label: item.sshAccessGranted ? this.sshAccessGrantedButtonTitle : this.sshAccessButtonTitle,
        icon: 'key',
        disabled: item.sshAccessGranted,
        dividerBefore: true,
      });

      if (item.service === 'agenstra-controller' || item.service === 'decabill-billing') {
        menu.push({
          id: 'console',
          label: this.openConsoleLabel,
          icon: 'box-arrow-up-right',
          disabled: !this.isServerOnline(item.serverInfo!),
        });
      }
    }

    menu.push(dbCopyIdItem());

    return menu;
  };
  readonly overviewServerInfoLoading$ = combineLatest([
    this.serverInfoFacade.getOverviewServerInfoLoading$(),
    this.billingDashboardSocketFacade.getStreamPending$(),
  ]).pipe(
    map(([restLoading, socketPending]) =>
      resolveApiWebsocketUrl(this.environment.billing.urls.websocket, 'default') ? socketPending : restLoading,
    ),
    takeUntilDestroyed(this.destroyRef),
  );
  readonly overviewServerInfoError$ = this.serverInfoFacade.getOverviewServerInfoError$();
  readonly serverActionInProgressMap$ = this.serverInfoFacade.getServerActionInProgressMap$();

  readonly backorders$ = this.backordersFacade.getBackorders$();
  readonly pendingBackorders$ = this.backordersFacade.getPendingBackorders$();
  readonly pendingBackorders = toSignal(this.backordersFacade.getPendingBackorders$(), {
    initialValue: [] as BackorderResponse[],
  });
  readonly backordersLoading$ = this.backordersFacade.getBackordersLoading$();
  readonly backordersError$ = this.backordersFacade.getBackordersError$();

  readonly projects = toSignal(this.projectsFacade.projects$, {
    initialValue: [] as ProjectListItem[],
  });
  readonly projectsCatalogSummary = toSignal(this.projectsFacade.catalogSummary$, { initialValue: null });
  readonly projectsCatalogSummaryLoading$ = this.projectsFacade.catalogSummaryLoading$;
  readonly projectsLoading$ = this.projectsFacade.loading$;
  readonly projectsError$ = this.projectsFacade.error$;

  readonly customerProfile$ = this.customerProfileFacade.getCustomerProfile$();
  readonly customerProfileLoading$ = this.customerProfileFacade.getCustomerProfileLoading$();
  readonly isCustomerProfileComplete$ = this.customerProfileFacade.isCustomerProfileComplete$();
  readonly isCustomerProfileComplete = toSignal(this.customerProfileFacade.isCustomerProfileComplete$(), {
    initialValue: false,
  });

  readonly isServerOnline = isBillingServerOnline;
  readonly isServerOff = isBillingServerOff;
  readonly isServerStartable = isBillingServerStartable;
  readonly isServerStatusTransitional = isBillingServerStatusTransitional;
  readonly serverLocationLabel = getBillingServerLocationLabel;
  readonly pageTitle = $localize`:@@featureOverview-title:Overview`;
  readonly searchInstancesPlaceholder = $localize`:@@featureOverview-searchInstances:Search cloud instances`;
  readonly activePlansLabel = $localize`:@@featureOverview-activePlans:Active plans`;
  readonly activeProjectsLabel = $localize`:@@featureOverview-projects:Active projects`;
  readonly backordersLabel = $localize`:@@featureOverview-backorders:Backorders`;
  readonly openOverdueInvoicesLabel = $localize`:@@featureOverview-openOverdueCount:Open and overdue invoices`;
  readonly billingProfileLabel = $localize`:@@featureOverview-customerProfile:Billing profile`;
  readonly sshAccessButtonTitle = $localize`:@@featureOverview-sshAccessButtonTitle:Show SSH access key`;
  readonly sshAccessGrantedButtonTitle = $localize`:@@featureOverview-sshAccessGrantedButtonTitle:SSH access key already revealed`;

  profileCompleteLabel(isComplete: boolean): string {
    return getProfileCompleteLabel(isComplete);
  }

  provisioningStatusLabel(status: SubscriptionWithServerInfo['provisioningStatus']): string {
    return getProvisioningStatusLabel(status);
  }

  provisioningStatusBadgeTone(status: SubscriptionWithServerInfo['provisioningStatus']): FpcBadgeTone {
    return getProvisioningStatusBadgeTone(status);
  }

  isProvisioningPending(item: SubscriptionWithServerInfo): boolean {
    return item.provisioningStatus === 'pending';
  }

  isProvisioningFailed(item: SubscriptionWithServerInfo): boolean {
    return item.provisioningStatus === 'failed';
  }

  isInstanceReady(item: SubscriptionWithServerInfo): boolean {
    return item.provisioningStatus === 'active' && item.serverInfo != null;
  }

  instanceDisplayTitle(item: SubscriptionWithServerInfo): string {
    return resolveServiceDisplayLabel({
      displayName: item.displayName,
      serviceTypeName: item.serviceTypeName,
      service: item.service,
    });
  }

  serviceTypeLabel(service: SubscriptionWithServerInfo['service']): string {
    if (service === 'agenstra-manager' || service === 'agenstra-controller' || service === 'decabill-billing') {
      return integratedProvisioningServiceLabel(service);
    }

    if (service === 'custom') {
      return $localize`:@@featureOverview-customService:Custom application`;
    }

    return integratedProvisioningServiceLabel('agenstra-controller');
  }

  serverStatusLabel(serverInfo: ServerInfoResponse): string {
    if (isBillingServerOnline(serverInfo)) {
      return $localize`:@@featureOverview-serverStatusOnline:Online`;
    }

    if (isBillingServerOff(serverInfo)) {
      return $localize`:@@featureOverview-serverStatusOff:Stopped`;
    }

    return $localize`:@@featureOverview-serverStatusUpdatingLabel:Updating`;
  }

  serverStatusBadgeTone(serverInfo: ServerInfoResponse): FpcBadgeTone {
    if (isBillingServerOnline(serverInfo)) {
      return 'success';
    }

    if (isBillingServerOff(serverInfo)) {
      return 'danger';
    }

    return 'info';
  }

  serverStatusIconClass(serverInfo: ServerInfoResponse): string {
    if (isBillingServerOnline(serverInfo)) {
      return 'bi-play-fill';
    }

    if (isBillingServerOff(serverInfo)) {
      return 'bi-stop-fill';
    }

    return 'bi-hourglass-split';
  }

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptionsSummary();
    this.backordersFacade.loadBackorders();
    this.projectsFacade.loadProjects();
    this.projectsFacade.loadCatalogSummary();
    this.customerProfileFacade.loadCustomerProfile();
    this.invoicesFacade.loadInvoicesSummary();

    const useBillingSocket = !!resolveApiWebsocketUrl(this.environment.billing.urls.websocket, 'default');

    if (useBillingSocket) {
      this.billingDashboardSocketFacade.connect();
      this.destroyRef.onDestroy(() => this.billingDashboardSocketFacade.disconnect());
    }

    // Server info for the loaded page: after every subscriptions page load (replace-page paging).
    this.subscriptionsLoading$
      .pipe(
        distinctUntilChanged(),
        pairwise(),
        filter(([before, now]) => before && !now),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.serverInfoFacade.loadOverviewServerInfo());
  }

  instanceSshGranted(item: SubscriptionWithServerInfo): boolean {
    return item.sshAccessGranted;
  }

  onInstanceAction(item: SubscriptionWithServerInfo, action: string): void {
    if (action === 'open') {
      const link = this.instanceLink(item);

      if (link) void this.router.navigateByUrl(link);
    } else if (action === 'start') this.serverInfoFacade.startServer(item.subscription.id, item.itemId);
    else if (action === 'stop') this.serverInfoFacade.stopServer(item.subscription.id, item.itemId);
    else if (action === 'restart') this.serverInfoFacade.restartServer(item.subscription.id, item.itemId);
    else if (action === 'ssh') this.openSshAccessConfirm(item);
    else if (action === 'console' && item.serverInfo) {
      globalThis.open?.(`https://${item.serverInfo.hostnameFqdn || item.serverInfo.publicIp}`, '_blank', 'noopener');
    } else if (action === 'copy-id') fpcCopyText(item.subscription.id);
  }

  /** Selected instances on which a server action is allowed (ready, not transitional, matching power state). */
  bulkTargets(action: 'start' | 'stop' | 'restart'): SubscriptionWithServerInfo[] {
    return this.selectedInstances().filter((item) => this.canRunServerAction(item, action));
  }

  /** Bulk start / stop / restart: one call per server (`POST …/items/:id/server/<action>`), per-item result. */
  async runServerBulk(action: 'start' | 'stop' | 'restart'): Promise<void> {
    const targets = this.bulkTargets(action);

    if (targets.length === 0) return;

    const call = (item: SubscriptionWithServerInfo) =>
      action === 'start'
        ? this.subscriptionItemsService.startServer(item.subscription.id, item.itemId)
        : action === 'stop'
          ? this.subscriptionItemsService.stopServer(item.subscription.id, item.itemId)
          : this.subscriptionItemsService.restartServer(item.subscription.id, item.itemId);
    const result = await fpcRunBulk(targets, (item) => firstValueFrom(call(item)));

    this.bulkResult.set(dbBulkSummary(result, (item) => this.instanceDisplayTitle(item)));
    this.selected.set([]);
    this.serverInfoFacade.loadOverviewServerInfo();
  }

  private canRunServerAction(item: SubscriptionWithServerInfo, action: 'start' | 'stop' | 'restart'): boolean {
    const info = item.serverInfo;

    if (!item.itemId || !this.isInstanceReady(item) || !info || this.isServerStatusTransitional(info)) return false;

    return action === 'start' ? this.isServerStartable(info) : this.isServerOnline(info);
  }

  private instanceState(item: SubscriptionWithServerInfo): FpcTableState {
    if (this.isProvisioningPending(item) || this.isProvisioningFailed(item) || !item.serverInfo) {
      return provisioningState(item.provisioningStatus);
    }

    const info = item.serverInfo;

    return {
      label: this.serverStatusLabel(info),
      tone: this.serverStatusBadgeTone(info),
      icon: this.serverStatusIconClass(info).replace(/^bi-/, ''),
    };
  }

  openSshAccessConfirm(item: SubscriptionWithServerInfo): void {
    if (item.sshAccessGranted) {
      return;
    }

    this.sshRevealTarget = item;
    this.sshRevealError = null;
    this.sshRevealLoading = false;
    this.revealedSshPrivateKey = null;
    showBillingModal(this.sshAccessConfirmModalOpen);
  }

  confirmSshAccessReveal(): void {
    const target = this.sshRevealTarget;

    if (!target || this.sshRevealLoading) {
      return;
    }

    this.sshRevealLoading = true;
    this.sshRevealError = null;

    this.subscriptionItemsService
      .getSshAccessKey(target.subscription.id, target.itemId)
      .pipe(
        take(1),
        finalize(() => {
          this.sshRevealLoading = false;
        }),
      )
      .subscribe({
        next: (response) => {
          this.serverInfoFacade.markSshAccessGranted(target.subscription.id);
          this.revealedSshPrivateKey = response.privateKey;
          this.sshAccessKeyCopied = false;
          hideBillingModal(this.sshAccessConfirmModalOpen);
          showBillingModal(this.sshAccessDisplayModalOpen);
        },
        error: (error: unknown) => {
          const status =
            error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 0;
          this.sshRevealError =
            status === 409
              ? $localize`:@@featureOverview-sshAccessAlreadyRevealed:The SSH access key has already been revealed for this service.`
              : $localize`:@@featureOverview-sshAccessRevealFailed:Could not retrieve the SSH access key. Please try again or contact support.`;

          if (status === 409) {
            this.serverInfoFacade.markSshAccessGranted(target.subscription.id);
          }
        },
      });
  }

  closeSshAccessDisplay(): void {
    this.revealedSshPrivateKey = null;
    this.sshRevealTarget = null;
    this.sshAccessKeyCopied = false;
    hideBillingModal(this.sshAccessDisplayModalOpen);
  }

  async copySshPrivateKey(): Promise<void> {
    const key = this.revealedSshPrivateKey;

    if (!key || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(key);
      this.sshAccessKeyCopied = true;
    } catch {
      this.sshAccessKeyCopied = false;
    }
  }
}
