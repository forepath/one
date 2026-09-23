import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, skip, take } from 'rxjs';

import {
  getProfileCompleteLabel,
  getProvisioningStatusBadgeClass,
  getProvisioningStatusLabel,
} from '../billing-status-labels';
import { hideBillingModal, showBillingModal } from '../billing-modal';

@Component({
  selector: 'framework-billing-overview',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
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
  readonly instancesSearch = signal('');
  readonly instancesSearch$ = toObservable(this.instancesSearch);
  readonly overviewServerInfoLoading$ = combineLatest([
    this.serverInfoFacade.getOverviewServerInfoLoading$(),
    this.billingDashboardSocketFacade.getStreamPending$(),
  ]).pipe(
    map(([restLoading, socketPending]) =>
      this.environment.billing.websocketUrl?.trim() ? socketPending : restLoading,
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

  provisioningStatusBadgeClass(status: SubscriptionWithServerInfo['provisioningStatus']): string {
    return getProvisioningStatusBadgeClass(status);
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

  serverStatusBadgeClass(serverInfo: ServerInfoResponse): string {
    if (isBillingServerOnline(serverInfo)) {
      return 'billing-admin__chip--status-paid';
    }

    if (isBillingServerOff(serverInfo)) {
      return 'billing-admin__chip--status-overdue';
    }

    return 'billing-admin__chip--status-partially-paid';
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
    this.subscriptionsFacade.loadSubscriptions();
    this.subscriptionsFacade.loadSubscriptionsSummary();
    this.backordersFacade.loadBackorders();
    this.projectsFacade.loadProjects();
    this.projectsFacade.loadCatalogSummary();
    this.customerProfileFacade.loadCustomerProfile();
    this.invoicesFacade.loadInvoicesSummary();

    this.instancesSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.subscriptionsFacade.loadSubscriptions({ search: search.trim() || undefined });
      });

    const useBillingSocket = !!this.environment.billing.websocketUrl?.trim();

    if (useBillingSocket) {
      this.billingDashboardSocketFacade.connect();
      this.destroyRef.onDestroy(() => this.billingDashboardSocketFacade.disconnect());
    }

    this.subscriptionsLoading$
      .pipe(
        filter((loading) => !loading),
        take(1),
      )
      .subscribe(() => this.serverInfoFacade.loadOverviewServerInfo());
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
