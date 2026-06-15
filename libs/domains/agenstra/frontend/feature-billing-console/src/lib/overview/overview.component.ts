import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  SubscriptionServerInfoFacade,
  SubscriptionsFacade,
} from '@forepath/agenstra/frontend/data-access-billing-console';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, filter, map, take } from 'rxjs';

@Component({
  selector: 'framework-billing-overview',
  standalone: true,
  imports: [CommonModule, RouterLink],
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
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly invoicesFacade = inject(InvoicesFacade);

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
  readonly invoicesSummary$ = this.invoicesFacade.getInvoicesSummary$();
  readonly invoicesSummaryLoading$ = this.invoicesFacade.getInvoicesSummaryLoading$();
  readonly subscriptionsLoading$ = this.subscriptionsFacade.getSubscriptionsLoading$();
  readonly subscriptionsError$ = this.subscriptionsFacade.getSubscriptionsError$();
  readonly activeSubscriptions$ = this.subscriptionsFacade.getActiveSubscriptions$();

  readonly subscriptionsWithServerInfo$ = this.serverInfoFacade.getSubscriptionsWithServerInfo$();
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
  readonly backordersLoading$ = this.backordersFacade.getBackordersLoading$();
  readonly backordersError$ = this.backordersFacade.getBackordersError$();

  readonly customerProfile$ = this.customerProfileFacade.getCustomerProfile$();
  readonly customerProfileLoading$ = this.customerProfileFacade.getCustomerProfileLoading$();
  readonly isCustomerProfileComplete$ = this.customerProfileFacade.isCustomerProfileComplete$();

  readonly isServerOnline = isBillingServerOnline;
  readonly isServerOff = isBillingServerOff;
  readonly isServerStartable = isBillingServerStartable;
  readonly isServerStatusTransitional = isBillingServerStatusTransitional;
  readonly serverLocationLabel = getBillingServerLocationLabel;

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.backordersFacade.loadBackorders();
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
