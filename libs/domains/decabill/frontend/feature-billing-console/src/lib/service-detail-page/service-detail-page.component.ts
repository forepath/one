import { CommonModule, DatePipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AdminBillingService,
  BillingDashboardSocketFacade,
  createDefaultMeterHistoryFilters,
  fillPeriodSeriesPoints,
  getBillingServerLocationLabel,
  integratedProvisioningServiceLabel,
  isBillingServerOff,
  isBillingServerOnline,
  isBillingServerStartable,
  isBillingServerStatusTransitional,
  isSubscriptionItemDetailEligible,
  providerLocationCatalogFromList,
  resolveServerInfoProvider,
  ServiceDetailFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  SubscriptionItemsService,
  SubscriptionServerInfoFacade,
  type MeterHistorySeries,
  type SubscriptionMeterSummary,
  type ProviderDetail,
  type ProviderLocationCatalog,
  type ServerInfoResponse,
  type ServiceDetailTabDto,
  type SubscriptionItemDetailResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import type { ApexAxisChartSeries, ApexChart, ApexDataLabels, ApexTitleSubtitle, ApexXAxis } from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  of,
  startWith,
  switchMap,
  take,
  withLatestFrom,
} from 'rxjs';

import { hideBillingModal, showBillingModal } from '../billing-modal';
import { getProvisioningStatusBadgeClass, getProvisioningStatusLabel } from '../billing-status-labels';
import { resolveServiceDetailAddonTabComponent } from './service-detail-addon-tab.registry';
import {
  DETAILS_TAB_ID,
  isDetailsTab,
  parseServiceDetailTabId,
  resolveServiceDetailTabLabel,
  sortServiceDetailTabs,
} from './service-detail-tabs';

const FILTERS_STORAGE_KEY = 'billing-console-service-detail-filters';

interface ServiceDetailFiltersStorage {
  fromDate: string;
  toDate: string;
  groupBy: 'day' | 'month';
  filtersCollapsed: boolean;
}

const BS_CHART_COLORS = [
  'var(--bs-primary)',
  'var(--bs-secondary)',
  'var(--bs-success)',
  'var(--bs-danger)',
  'var(--bs-warning)',
  'var(--bs-info)',
] as const;

type ServiceViewMode = 'admin' | 'customer';
type ServiceDetailBackTarget = 'subscriptions' | 'dashboard';
type ServiceDetailMobilePanel = 'info' | 'meters';

function isSubscriptionsListUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) {
    return false;
  }

  try {
    const path = (url.includes('://') ? new URL(url).pathname : (url.split('?')[0] ?? url)).replace(/\/+$/, '') || '/';

    return path === '/subscriptions' || path.endsWith('/subscriptions');
  } catch {
    return false;
  }
}

function isDashboardUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) {
    return false;
  }

  try {
    const path = (url.includes('://') ? new URL(url).pathname : (url.split('?')[0] ?? url)).replace(/\/+$/, '') || '/';

    return path === '/dashboard' || path.endsWith('/dashboard');
  } catch {
    return false;
  }
}

@Component({
  selector: 'framework-service-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    NgApexchartsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  providers: [DatePipe],
  templateUrl: './service-detail-page.component.html',
  styleUrls: ['./service-detail-page.component.scss'],
})
export class ServiceDetailPageComponent implements OnInit {
  private readonly titleInputRef = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly sshAccessConfirmModalOpen = signal(false);
  readonly sshAccessDisplayModalOpen = signal(false);

  readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly facade = inject(ServiceDetailFacade);
  readonly serverInfoFacade = inject(SubscriptionServerInfoFacade);
  private readonly subscriptionItemsService = inject(SubscriptionItemsService);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly socketFacade = inject(BillingDashboardSocketFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly isAdminView = signal(false);
  readonly backTarget = signal<ServiceDetailBackTarget>('dashboard');
  readonly activeTabId = signal(DETAILS_TAB_ID);
  readonly mobilePanel = signal<ServiceDetailMobilePanel>('info');
  readonly filtersCollapsed = signal(true);
  readonly filtersPanelTitle = $localize`:@@featureServiceDetail-filters:Filters`;
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly titleEditing = signal(false);
  readonly titleDraft = signal('');
  readonly sshRevealLoading = signal(false);
  readonly sshRevealError = signal<string | null>(null);
  readonly revealedSshPrivateKey = signal<string | null>(null);
  readonly sshAccessKeyCopied = signal(false);
  readonly locationCatalog = signal<ProviderLocationCatalog>(new Map());
  readonly providerDetails = toSignal(this.serviceTypesFacade.getProviderDetails$(), {
    initialValue: [] as ProviderDetail[],
  });

  readonly detail$ = this.facade.detail$;
  readonly history$ = this.facade.history$;
  readonly loadingDetail$ = this.facade.loadingDetail$;
  readonly renaming$ = this.facade.renaming$;
  readonly error$ = this.facade.error$;
  readonly displayLabel$ = this.facade.displayLabel$;
  readonly serverActionInProgressMap$ = this.serverInfoFacade.getServerActionInProgressMap$();

  readonly history = toSignal(this.facade.history$, { initialValue: null });
  readonly loadingHistory = toSignal(this.facade.loadingHistory$, { initialValue: false });
  readonly detail = toSignal(this.facade.detail$, { initialValue: null as SubscriptionItemDetailResponse | null });
  readonly metersFromSocket = toSignal(this.facade.metersFromSocket$, {
    initialValue: null as SubscriptionMeterSummary[] | null,
  });

  readonly sortedTabs = computed(() => sortServiceDetailTabs(this.detail()?.tabs));
  readonly showServiceTabs = computed(() => this.sortedTabs().length > 1);
  readonly isDetailsTabActive = computed(() => isDetailsTab(this.activeTabId()));
  readonly tabsAriaLabel = $localize`:@@featureServiceDetail-tabsAria:Service detail tabs`;
  readonly addonTabComponent = computed(() => {
    const tabId = this.activeTabId();

    if (isDetailsTab(tabId)) {
      return null;
    }

    return resolveServiceDetailAddonTabComponent(tabId);
  });
  readonly addonTabInputs = computed(() => ({
    subscriptionId: this.subscriptionId,
    itemId: this.itemId,
    adminMode: this.isAdminView(),
  }));

  readonly meterSummaryLookup = computed(() => {
    const summaries = this.metersFromSocket();

    if (!summaries?.length) {
      return new Map<string, SubscriptionMeterSummary>();
    }

    return new Map(summaries.map((summary) => [this.meterSummaryKey(summary), summary]));
  });

  readonly meterCharts = computed(() => {
    const meters = this.history()?.meters ?? [];
    const lookup = this.meterSummaryLookup();

    return meters.map((meter, index) => ({
      meter,
      summary: lookup.get(this.meterSummaryKey(meter)) ?? null,
      options: this.buildMeterChart(meter, index),
    }));
  });

  /** True while history is loading, or when at least one meter is attached. Hidden when history confirms zero meters. */
  readonly showUsageMetersSection = computed(() => {
    if (!this.isDetailsTabActive()) {
      return false;
    }

    if (this.loadingHistory()) {
      return true;
    }

    return (this.history()?.meters.length ?? 0) > 0;
  });

  mobilePanelLabel(panel: ServiceDetailMobilePanel): string {
    return panel === 'info'
      ? $localize`:@@featureServiceDetail-serviceInfoTitle:Service info`
      : $localize`:@@featureServiceDetail-usageMetersTitle:Usage meters`;
  }

  readonly renameTitleAriaLabel = $localize`:@@featureServiceDetail-renameTitleAria:Rename service`;
  readonly clearNameAriaLabel = $localize`:@@featureServiceDetail-clearNameAria:Clear display name draft`;
  readonly sshAccessButtonTitle = $localize`:@@featureOverview-sshAccessButtonTitle:Show SSH access key`;
  readonly sshAccessGrantedButtonTitle = $localize`:@@featureOverview-sshAccessGrantedButtonTitle:SSH access key already revealed`;

  readonly isServerOnline = isBillingServerOnline;
  readonly isServerOff = isBillingServerOff;
  readonly isServerStartable = isBillingServerStartable;
  readonly isServerStatusTransitional = isBillingServerStatusTransitional;

  subscriptionId = '';
  itemId = '';
  private redirected = false;
  private socketEnabled = false;

  ngOnInit(): void {
    const context = this.readServiceContext();
    const { subscriptionId, itemId, viewMode } = context;

    this.subscriptionId = subscriptionId;
    this.itemId = itemId;
    this.isAdminView.set(viewMode === 'admin');
    this.backTarget.set(this.resolveBackTarget(viewMode));
    this.activeTabId.set(context.tabId);

    if (!subscriptionId || !itemId) {
      void this.router.navigateByUrl(this.backPath());

      return;
    }

    this.restoreFilters();
    this.facade.enter(subscriptionId, itemId, viewMode === 'admin');
    this.serviceTypesFacade.loadProviderDetails();

    const restoredFrom = this.fromDate();
    const restoredTo = this.toDate();
    const restoredGroupBy = this.groupBy();
    const defaults = createDefaultMeterHistoryFilters();

    if (restoredFrom !== defaults.from || restoredTo !== defaults.to || restoredGroupBy !== defaults.groupBy) {
      this.facade.applyHistoryFilters(
        { from: restoredFrom, to: restoredTo, groupBy: restoredGroupBy },
        viewMode === 'admin',
      );
    }

    this.socketEnabled = !!this.environment.billing.websocketUrl?.trim();

    if (this.socketEnabled) {
      this.socketFacade.connect();
      this.socketFacade.subscribeSubscriptionMeters(subscriptionId);
    }

    this.destroyRef.onDestroy(() => {
      if (this.socketEnabled && subscriptionId) {
        this.socketFacade.unsubscribeSubscriptionMeters(subscriptionId);
        this.socketFacade.disconnect();
      }

      this.facade.clear();
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.readServiceContext()),
        startWith(this.readServiceContext()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((routeContext) => {
        this.subscriptionId = routeContext.subscriptionId;
        this.itemId = routeContext.itemId;
        this.isAdminView.set(routeContext.viewMode === 'admin');
        this.activeTabId.set(routeContext.tabId);

        if (
          routeContext.subscriptionId &&
          routeContext.rawTab &&
          routeContext.rawTab !== routeContext.tabId &&
          this.detail()?.tabs?.length
        ) {
          void this.router.navigate(
            this.serviceTabLink(
              routeContext.subscriptionId,
              routeContext.itemId,
              routeContext.viewMode,
              routeContext.tabId,
            ),
            { replaceUrl: true },
          );
        }
      });

    this.facade.detail$
      .pipe(
        filter((detail): detail is SubscriptionItemDetailResponse => !!detail),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((detail) => {
        const rawTab = this.readServiceContext().rawTab;
        const parsed = parseServiceDetailTabId(rawTab, detail.tabs);

        if (rawTab && rawTab !== parsed) {
          void this.router.navigate(
            this.serviceTabLink(this.subscriptionId, this.itemId, this.isAdminView() ? 'admin' : 'customer', parsed),
            { replaceUrl: true },
          );

          return;
        }

        this.activeTabId.set(parsed);
      });

    this.facade.loadingDetail$
      .pipe(
        withLatestFrom(this.facade.subscriptionId$, this.facade.detail$, this.facade.error$),
        filter(([loading, activeSubscriptionId]) => !loading && activeSubscriptionId === subscriptionId),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([, , detail, error]) => {
        if (this.redirected) {
          return;
        }

        if (error || !detail || !isSubscriptionItemDetailEligible(detail)) {
          this.redirected = true;
          void this.router.navigateByUrl(this.backPath());
        }
      });

    this.facade.detail$
      .pipe(
        map((detail) => {
          const provider = resolveServerInfoProvider(detail?.serverInfo?.metadata);
          const serviceTypeId = detail?.serviceTypeId?.trim() || undefined;

          return provider ? `${provider}::${serviceTypeId ?? ''}` : '';
        }),
        distinctUntilChanged(),
        switchMap((providerKey) => {
          if (!providerKey) {
            this.locationCatalog.set(new Map());

            return of([] as { id: string; name: string }[]);
          }

          const [provider, serviceTypeId] = providerKey.split('::');

          return this.serviceTypesService
            .getProviderLocations(provider, serviceTypeId || undefined)
            .pipe(catchError(() => of([] as { id: string; name: string }[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((locations) => {
        this.locationCatalog.set(providerLocationCatalogFromList(locations));
      });

    this.facade.filters$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((filters) => {
      this.fromDate.set(filters.from);
      this.toDate.set(filters.to);
      this.groupBy.set(filters.groupBy);
    });
  }

  setTab(tabId: string): void {
    if (!this.subscriptionId || !this.itemId || tabId === this.activeTabId()) {
      return;
    }

    void this.router.navigate(
      this.serviceTabLink(this.subscriptionId, this.itemId, this.isAdminView() ? 'admin' : 'customer', tabId),
    );
  }

  onServiceTabChange(tabId: string | null): void {
    if (!tabId) {
      return;
    }

    this.setTab(tabId);
  }

  onMobilePanelTabChange(tabId: string | null): void {
    if (tabId === 'info' || tabId === 'meters') {
      this.mobilePanel.set(tabId);
    }
  }

  tabLabel(tab: ServiceDetailTabDto): string {
    return resolveServiceDetailTabLabel(tab, $localize`:@@featureServiceDetail-tabDetails:Details`);
  }

  backPath(): string {
    if (this.isAdminView()) {
      return '/administration/subscriptions';
    }

    return this.backTarget() === 'subscriptions' ? '/subscriptions' : '/dashboard';
  }

  backLink(): string[] {
    if (this.isAdminView()) {
      return ['/administration/subscriptions'];
    }

    return this.backTarget() === 'subscriptions' ? ['/subscriptions'] : ['/dashboard'];
  }

  private resolveBackTarget(viewMode: ServiceViewMode): ServiceDetailBackTarget {
    if (viewMode === 'admin') {
      return 'subscriptions';
    }

    const fromQuery = this.route.snapshot.queryParamMap.get('from')?.trim().toLowerCase();

    if (fromQuery === 'subscriptions') {
      return 'subscriptions';
    }

    if (fromQuery === 'dashboard') {
      return 'dashboard';
    }

    const previousUrl = this.router.lastSuccessfulNavigation()?.previousNavigation?.finalUrl?.toString() ?? null;

    if (isSubscriptionsListUrl(previousUrl)) {
      return 'subscriptions';
    }

    if (isDashboardUrl(previousUrl) || !previousUrl) {
      return 'dashboard';
    }

    const referrer = typeof document !== 'undefined' ? document.referrer : '';

    if (isSubscriptionsListUrl(referrer)) {
      return 'subscriptions';
    }

    return 'dashboard';
  }

  provisioningStatusLabel(status: string | null | undefined): string {
    return getProvisioningStatusLabel(status);
  }

  provisioningStatusBadgeClass(status: string | null | undefined): string {
    return getProvisioningStatusBadgeClass(status);
  }

  serverStatusLabel(serverInfo: ServerInfoResponse): string {
    if (isBillingServerOnline(serverInfo)) {
      return $localize`:@@featureServiceDetail-serverStatusOnline:Online`;
    }

    if (isBillingServerOff(serverInfo)) {
      return $localize`:@@featureServiceDetail-serverStatusOff:Stopped`;
    }

    return $localize`:@@featureServiceDetail-serverStatusUpdating:Updating`;
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

  serverLocationLabel(
    metadata: Record<string, unknown> | undefined,
    catalog?: ProviderLocationCatalog,
  ): string | undefined {
    return getBillingServerLocationLabel(metadata, catalog);
  }

  productServiceLabel(detail: SubscriptionItemDetailResponse): string {
    const service = detail.service;

    if (service === 'agenstra-manager' || service === 'agenstra-controller' || service === 'decabill-billing') {
      return integratedProvisioningServiceLabel(service);
    }

    if (service === 'custom') {
      return $localize`:@@featureServiceDetail-customService:Custom application`;
    }

    return integratedProvisioningServiceLabel('agenstra-controller');
  }

  providerLabel(detail: SubscriptionItemDetailResponse): string | undefined {
    const providerId = resolveServerInfoProvider(detail.serverInfo?.metadata);

    if (!providerId) {
      return undefined;
    }

    const fromCatalog = this.providerDetails()
      ?.find((provider) => provider.id === providerId)
      ?.displayName?.trim();

    if (fromCatalog) {
      return fromCatalog;
    }

    if (providerId === 'hetzner') {
      return 'Hetzner Cloud';
    }

    if (providerId === 'digital-ocean') {
      return 'DigitalOcean';
    }

    return undefined;
  }

  showConsoleLink(detail: SubscriptionItemDetailResponse): boolean {
    const service = detail.service ?? 'agenstra-controller';

    return (
      (service === 'agenstra-controller' || service === 'decabill-billing') &&
      detail.serverInfo != null &&
      isBillingServerOnline(detail.serverInfo)
    );
  }

  consoleHref(serverInfo: ServerInfoResponse): string {
    return `https://${serverInfo.hostnameFqdn || serverInfo.publicIp}`;
  }

  openSshAccessConfirm(detail: SubscriptionItemDetailResponse): void {
    if (detail.sshAccessGranted) {
      return;
    }

    this.sshRevealError.set(null);
    this.sshRevealLoading.set(false);
    this.revealedSshPrivateKey.set(null);
    showBillingModal(this.sshAccessConfirmModalOpen);
  }

  confirmSshAccessReveal(): void {
    if (this.sshRevealLoading() || !this.subscriptionId || !this.itemId) {
      return;
    }

    this.sshRevealLoading.set(true);
    this.sshRevealError.set(null);

    const request$ = this.isAdminView()
      ? this.adminBillingService.getAdminSubscriptionItemSshAccessKey(this.subscriptionId, this.itemId)
      : this.subscriptionItemsService.getSshAccessKey(this.subscriptionId, this.itemId);

    request$
      .pipe(
        take(1),
        finalize(() => {
          this.sshRevealLoading.set(false);
        }),
      )
      .subscribe({
        next: (response) => {
          this.facade.markSshAccessGranted();
          this.serverInfoFacade.markSshAccessGranted(this.subscriptionId);
          this.revealedSshPrivateKey.set(response.privateKey);
          this.sshAccessKeyCopied.set(false);
          hideBillingModal(this.sshAccessConfirmModalOpen);
          showBillingModal(this.sshAccessDisplayModalOpen);
        },
        error: (error: unknown) => {
          const status =
            error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 0;
          this.sshRevealError.set(
            status === 409
              ? $localize`:@@featureOverview-sshAccessAlreadyRevealed:The SSH access key has already been revealed for this service.`
              : $localize`:@@featureOverview-sshAccessRevealFailed:Could not retrieve the SSH access key. Please try again or contact support.`,
          );

          if (status === 409) {
            this.facade.markSshAccessGranted();
            this.serverInfoFacade.markSshAccessGranted(this.subscriptionId);
          }
        },
      });
  }

  closeSshAccessDisplay(): void {
    this.revealedSshPrivateKey.set(null);
    this.sshAccessKeyCopied.set(false);
    hideBillingModal(this.sshAccessDisplayModalOpen);
  }

  async copySshPrivateKey(): Promise<void> {
    const key = this.revealedSshPrivateKey();

    if (!key || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(key);
      this.sshAccessKeyCopied.set(true);
    } catch {
      this.sshAccessKeyCopied.set(false);
    }
  }

  onTitleClick(detail: SubscriptionItemDetailResponse): void {
    this.titleDraft.set(detail.displayName?.trim() ?? resolveDisplayLabelFallback(detail));
    this.titleEditing.set(true);
    afterNextRender(
      () => {
        this.titleInputRef()?.nativeElement?.querySelector('input')?.focus() ??
          this.titleInputRef()?.nativeElement?.focus();
      },
      { injector: this.injector },
    );
  }

  onTitleClearDraft(): void {
    this.titleDraft.set('');
  }

  onTitleBlur(detail: SubscriptionItemDetailResponse): void {
    if (!this.titleEditing()) {
      return;
    }

    const trimmed = this.titleDraft().trim();
    const currentDisplayName = detail.displayName?.trim() ?? '';
    const fallbackLabel = resolveDisplayLabelFallback(detail);

    if (trimmed === currentDisplayName) {
      this.titleEditing.set(false);

      return;
    }

    // Opening edit without a custom name seeds the draft from the fallback label; ignore no-op blur.
    if (!currentDisplayName && trimmed === fallbackLabel) {
      this.titleEditing.set(false);

      return;
    }

    if (!trimmed.length) {
      this.facade.renameDisplayName(this.subscriptionId, this.itemId, null, this.isAdminView());
      this.titleEditing.set(false);

      return;
    }

    this.facade.renameDisplayName(this.subscriptionId, this.itemId, trimmed, this.isAdminView());
    this.titleEditing.set(false);
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
    this.persistFilters();
  }

  onApplyFilters(): void {
    this.filtersCollapsed.set(true);
    this.persistFilters();
    this.facade.applyHistoryFilters(
      {
        from: this.fromDate(),
        to: this.toDate(),
        groupBy: this.groupBy(),
      },
      this.isAdminView(),
    );
  }

  onResetFilters(): void {
    const defaults = createDefaultMeterHistoryFilters();

    this.fromDate.set(defaults.from);
    this.toDate.set(defaults.to);
    this.groupBy.set(defaults.groupBy);
    this.filtersCollapsed.set(true);
    this.persistFilters();
    this.facade.resetHistoryFilters(this.isAdminView());
  }

  formatMeterTotal(meter: MeterHistorySeries): string {
    const unit = meter.unitLabel ? ` ${meter.unitLabel}` : '';

    return `${meter.totalValue}${unit}`;
  }

  formatMeterBillingDetails(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';
    const parts: string[] = [];

    if (summary.effectiveIncludedUsage > 0) {
      parts.push(
        $localize`:@@featureServiceDetail-meterIncludedAllowance:${summary.effectiveIncludedUsage}${unit}:value: included`,
      );
    }

    if (summary.billableValue !== summary.aggregatedValue) {
      parts.push($localize`:@@featureServiceDetail-meterBillableValue:${summary.billableValue}${unit}:value: billable`);
    }

    return parts.join(' · ');
  }

  hasMeterBillingDetails(summary: SubscriptionMeterSummary): boolean {
    return summary.effectiveIncludedUsage > 0 || summary.billableValue !== summary.aggregatedValue;
  }

  private meterSummaryKey(meter: Pick<SubscriptionMeterSummary, 'meterId' | 'attachmentType' | 'addonId'>): string {
    return `${meter.meterId}:${meter.attachmentType}:${meter.addonId ?? ''}`;
  }

  private readServiceContext(): {
    subscriptionId: string;
    itemId: string;
    viewMode: ServiceViewMode;
    tabId: string;
    rawTab: string | null;
  } {
    let subscriptionId = '';
    let itemId = '';
    let viewMode: ServiceViewMode = 'customer';
    let rawTab: string | null = null;

    for (const route of this.route.pathFromRoot) {
      const routeSubscriptionId = route.snapshot.paramMap.get('subscriptionId');

      if (routeSubscriptionId) {
        subscriptionId = routeSubscriptionId.trim();
      }

      const routeItemId = route.snapshot.paramMap.get('itemId');

      if (routeItemId) {
        itemId = routeItemId.trim();
      }

      const routeTab = route.snapshot.paramMap.get('tab');

      if (routeTab) {
        rawTab = routeTab.trim();
      }

      const routeViewMode = route.snapshot.data['serviceViewMode'];

      if (routeViewMode === 'admin' || routeViewMode === 'customer') {
        viewMode = routeViewMode;
      }
    }

    if (viewMode === 'customer' && this.router.url.includes('/administration/subscriptions/')) {
      viewMode = 'admin';
    }

    return {
      subscriptionId,
      itemId,
      viewMode,
      tabId: parseServiceDetailTabId(rawTab, this.detail()?.tabs),
      rawTab,
    };
  }

  private serviceTabLink(subscriptionId: string, itemId: string, viewMode: ServiceViewMode, tabId: string): string[] {
    const prefix = viewMode === 'admin' ? '/administration/subscriptions' : '/subscriptions';

    return [prefix, subscriptionId, 'services', itemId, tabId];
  }

  private restoreFilters(): void {
    const defaults = createDefaultMeterHistoryFilters();

    this.fromDate.set(defaults.from);
    this.toDate.set(defaults.to);
    this.groupBy.set(defaults.groupBy);

    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const stored = JSON.parse(raw) as ServiceDetailFiltersStorage;

      if (stored.fromDate) {
        this.fromDate.set(stored.fromDate);
      }

      if (stored.toDate) {
        this.toDate.set(stored.toDate);
      }

      if (stored.groupBy) {
        this.groupBy.set(stored.groupBy);
      }

      if (stored.filtersCollapsed !== undefined) {
        this.filtersCollapsed.set(stored.filtersCollapsed);
      }
    } catch {
      // ignore invalid storage
    }
  }

  private persistFilters(): void {
    const payload: ServiceDetailFiltersStorage = {
      fromDate: this.fromDate(),
      toDate: this.toDate(),
      groupBy: this.groupBy(),
      filtersCollapsed: this.filtersCollapsed(),
    };

    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }

  private buildMeterChart(meter: MeterHistorySeries, index: number) {
    const history = this.history();
    const from = history?.from || this.fromDate();
    const to = history?.to || this.toDate();
    const groupBy = history?.groupBy || this.groupBy();
    const series = fillPeriodSeriesPoints(meter.series, from, to, groupBy, (period) => ({ period, value: 0 }));

    if (series.length === 0) {
      return null;
    }

    const axisDateFormat = groupBy === 'month' ? 'mediumDate' : 'shortDate';
    const color = BS_CHART_COLORS[index % BS_CHART_COLORS.length];
    const unitSuffix = meter.unitLabel ? ` ${meter.unitLabel}` : '';

    return {
      series: [{ name: meter.name, data: series.map((point) => point.value) }] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 240,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [color],
      stroke: { colors: [color] },
      fill: { colors: [color] },
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: {
        categories: series.map((point) => this.datePipe.transform(point.period, axisDateFormat) ?? point.period),
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
          formatter: (value: number) => `${value}${unitSuffix}`,
        },
      },
      grid: { borderColor: 'var(--bs-border-color)' },
      title: {
        text: meter.name,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }
}

function resolveDisplayLabelFallback(detail: SubscriptionItemDetailResponse): string {
  return detail.serviceTypeName?.trim() || detail.service?.trim() || '';
}
