import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
  SubscriptionServerInfoFacade,
  SubscriptionsFacade,
  type BackorderResponse,
  type InvoicesSummaryResponse,
  type ProjectListItem,
  type ServerInfoResponse,
  type SubscriptionResponse,
  type SubscriptionWithServerInfo,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, filter, map, take } from 'rxjs';

import { getProfileCompleteLabel } from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';

@Component({
  selector: 'framework-billing-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent implements OnInit {
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  readonly serverInfoFacade = inject(SubscriptionServerInfoFacade);
  private readonly billingDashboardSocketFacade = inject(BillingDashboardSocketFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly backordersFacade = inject(BackordersFacade);
  private readonly projectsFacade = inject(ProjectsFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly invoicesFacade = inject(InvoicesFacade);

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
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
  readonly filteredSubscriptionsWithServerInfo = computed(() =>
    filterItemsBySearch(this.subscriptionsWithServerInfo(), this.instancesSearch(), (item) =>
      this.instanceSearchHaystack(item),
    ),
  );
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
  readonly activeProjects = computed(() => this.projects().filter((project) => project.status === 'active'));
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

  profileCompleteLabel(isComplete: boolean): string {
    return getProfileCompleteLabel(isComplete);
  }

  instanceDisplayTitle(item: SubscriptionWithServerInfo): string {
    return item.subscription.number?.trim() || '—';
  }

  instanceSearchHaystack(item: SubscriptionWithServerInfo): string {
    const provider = item.serverInfo.metadata?.['provider'];

    return [
      item.subscription.number,
      this.serviceTypeLabel(item.service),
      this.serverStatusLabel(item.serverInfo),
      this.getProviderName(provider),
      this.serverLocationLabel(item.serverInfo.metadata),
      item.serverInfo.hostnameFqdn,
      item.serverInfo.publicIp,
      item.serverInfo.privateIp,
    ]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ');
  }

  onInstancesSearchChange(value: string): void {
    this.instancesSearch.set(value);
  }

  serviceTypeLabel(service: SubscriptionWithServerInfo['service']): string {
    const productName = this.environment.productName;

    if (service === 'manager') {
      return $localize`:@@featureOverview-managerService:${productName}:productName: Manager`;
    }

    if (service === 'custom') {
      return $localize`:@@featureOverview-customService:Custom application`;
    }

    return $localize`:@@featureOverview-controllerService:${productName}:productName: Controller`;
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
    this.backordersFacade.loadBackorders();
    this.projectsFacade.loadProjects();
    this.customerProfileFacade.loadCustomerProfile();
    this.invoicesFacade.loadInvoicesSummary();

    const useBillingSocket = !!this.environment.billing.websocketUrl?.trim();

    if (useBillingSocket) {
      this.billingDashboardSocketFacade.connect();
      this.destroyRef.onDestroy(() => this.billingDashboardSocketFacade.disconnect());
    } else {
      this.subscriptionsLoading$
        .pipe(
          filter((loading) => !loading),
          take(1),
        )
        .subscribe(() => this.serverInfoFacade.loadOverviewServerInfo());
    }
  }

  getProviderName(provider: unknown): string | undefined {
    switch (provider) {
      case 'hetzner':
        return 'Hetzner Cloud';
      case 'digital-ocean':
      case 'digitalocean':
        return 'DigitalOcean';
      default:
        return undefined;
    }
  }
}
