import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  BillingCapabilitiesFacade,
  CustomerProfileFacade,
  OffersFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
} from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import { ENVIRONMENT, LocaleService } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, distinctUntilChanged, filter, map, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';
import { collectContributorNavItems } from '../contributors/contributor-ui.registry';
import type { ContributorNavItem } from '../contributors/contributor-ui.types';
import { FIRST_PARTY_CONTRIBUTOR_UI_MODULES } from '../contributors/first-party-contributor-ui.modules';

interface BootstrapPopoverInstance {
  dispose(): void;
  hide(): void;
  setContent(content: Record<string, string | Element | null | (() => string)>): void;
}

interface BootstrapPopoverConstructor {
  getOrCreateInstance(element: Element, options?: Record<string, unknown>): BootstrapPopoverInstance;
}

function getBootstrapPopover(): BootstrapPopoverConstructor | undefined {
  return (window as Window & { bootstrap?: { Popover?: BootstrapPopoverConstructor } }).bootstrap?.Popover;
}

@Component({
  selector: 'framework-billing-console-container',
  imports: [CommonModule, RouterModule, IdentityLogoutConfirmModalComponent],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class BillingConsoleContainerComponent implements OnInit, OnDestroy {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly billingCapabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly offersFacade = inject(OffersFacade);
  private readonly adminUpdatesFacade = inject(AdminUpdatesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject(ENVIRONMENT).productName;
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);

  /** True when console uses users (email/password) authentication. */
  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';

  /** True when Personal Access Tokens UI is available (users or keycloak; not api-key). */
  readonly isPatUiEnabled =
    this.authEnvironment.authentication.type === 'users' || this.authEnvironment.authentication.type === 'keycloak';

  readonly contributorCustomerNavItems = collectContributorNavItems(FIRST_PARTY_CONTRIBUTOR_UI_MODULES).customer;

  /**
   * True when on the main clients mask (not editor, deployments, etc.)
   */
  readonly isMainMask = toSignal(
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
        startWith(this.router.url),
      )
      .pipe(
        map(
          (url) =>
            url.includes('/dashboard') ||
            url.includes('/subscriptions') ||
            url.includes('/promotions') ||
            url.includes('/offers') ||
            url.includes('/invoices') ||
            url.includes('/projects') ||
            url.includes('/administration') ||
            url.includes('/users') ||
            url.includes('/webhooks') ||
            url.includes('/updates') ||
            url.includes('/settings/tokens'),
        ),
      ),
    {
      initialValue:
        this.router.url.includes('/dashboard') ||
        this.router.url.includes('/subscriptions') ||
        this.router.url.includes('/promotions') ||
        this.router.url.includes('/offers') ||
        this.router.url.includes('/invoices') ||
        this.router.url.includes('/projects') ||
        this.router.url.includes('/administration') ||
        this.router.url.includes('/users') ||
        this.router.url.includes('/webhooks') ||
        this.router.url.includes('/updates') ||
        this.router.url.includes('/settings/tokens'),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;

  /**
   * Logged-in user's customer number when a billing profile exists; otherwise null.
   */
  readonly headerCustomerNumber = toSignal(
    this.customerProfileFacade.getCustomerProfile$().pipe(
      map((profile) => {
        const customerNumber = profile?.customerNumber?.trim();

        return customerNumber ? customerNumber : null;
      }),
    ),
    { initialValue: null as string | null },
  );

  /**
   * True when the user can access the user manager (admin with users/keycloak auth).
   * This also implies that the user can access the administration console.
   */
  readonly canAccessAdministration$ = this.authenticationFacade.canAccessBillingAdministration$;
  readonly updatesAttentionBadge$ = this.adminUpdatesFacade.hasAttention$;
  readonly updatesAttentionBadge = toSignal(this.updatesAttentionBadge$, { initialValue: false });
  readonly offersPendingBadge = toSignal(this.offersFacade.getPendingBadgeCount$(), { initialValue: 0 });

  readonly datevExportEnabled = toSignal(this.billingCapabilitiesFacade.datevExportEnabled$, {
    initialValue: false,
  });

  readonly isAdminRouteActive = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
      map(
        (url) =>
          url.includes('/administration') ||
          url.includes('/users') ||
          url.includes('/webhooks') ||
          url.includes('/updates'),
      ),
    ),
    {
      initialValue:
        this.router.url.includes('/administration') ||
        this.router.url.includes('/users') ||
        this.router.url.includes('/webhooks') ||
        this.router.url.includes('/updates'),
    },
  );

  private adminPopover: BootstrapPopoverInstance | null = null;

  @ViewChild('adminNavTrigger') set adminNavTrigger(ref: ElementRef<HTMLElement> | undefined) {
    this.onAdminNavTriggerReady(ref);
  }

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  /**
   * Display label for the current user's role. Admin for api-key auth, otherwise user.role capitalized.
   */
  readonly userRoleDisplay$ = combineLatest([
    this.authenticationFacade.isAuthenticated$,
    this.authenticationFacade.authenticationType$,
    this.authenticationFacade.user$,
  ]).pipe(
    map(([isAuthenticated, authType, user]) => {
      if (!isAuthenticated) return null;

      if (authType === 'api-key') return 'Admin';

      const role = user?.role;

      return role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
    }),
  );

  /**
   * Signal indicating if we're in file-only mode (file query parameter is set)
   */
  readonly fileOnlyMode = toSignal(this.route.queryParams.pipe(map((params) => !!params['standalone'])), {
    initialValue: false,
  });

  /**
   * Signal indicating if standalone loading spinner should be shown
   */
  readonly showStandaloneLoading = this.standaloneLoadingService.isLoading;

  getRoleAriaLabel(role: string): string {
    return $localize`:@@featureContainer-ariaLabelRole:Role ${role}:role:`;
  }

  getCustomerNumberAriaLabel(customerNumber: string): string {
    return $localize`:@@featureContainer-customerNumberAria:Customer number ${customerNumber}:customerNumber:`;
  }

  /**
   * Initialize component and check authentication status
   */
  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();

    this.authenticationFacade.isAuthenticated$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.customerProfileFacade.loadCustomerProfile();
          this.offersFacade.loadOffersSummary({ silent: true });
        } else {
          this.customerProfileFacade.clearCustomerProfile();
          this.offersFacade.clearOffers();
        }
      });

    this.authenticationFacade.canAccessBillingAdministration$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((canAccess) => {
        if (canAccess) {
          this.billingCapabilitiesFacade.loadCapabilities();
          this.adminUpdatesFacade.loadStatus();
        }
      });

    // Check initial query params immediately
    const initialParams = this.route.snapshot.queryParams;
    const isStandalone = !!initialParams['standalone'];

    if (isStandalone) {
      this.standaloneLoadingService.setLoading(true);
    }

    // Watch for query parameter changes
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const isStandalone = !!params['standalone'];

      if (isStandalone) {
        this.standaloneLoadingService.setLoading(true);
      } else {
        this.standaloneLoadingService.setLoading(false);
      }
    });
  }

  /**
   * Opens logout confirmation before ending all active sessions.
   */
  onLogoutClick(): void {
    this.logoutConfirmModal?.open();
  }

  /**
   * Handles confirmed logout action
   */
  onLogoutConfirmed(result: { invalidateAllSessions: boolean }): void {
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }

  ngOnDestroy(): void {
    this.disposeAdminPopover();
  }

  onAdminNavTriggerReady(trigger: ElementRef<HTMLElement> | undefined): void {
    if (!trigger) {
      this.disposeAdminPopover();

      return;
    }

    this.setupAdminPopover(trigger.nativeElement);
  }

  private setupAdminPopover(trigger: HTMLElement): void {
    if (this.adminPopover) {
      return;
    }

    const Popover = getBootstrapPopover();

    if (!Popover) {
      return;
    }

    const buildBody = (): HTMLElement => this.buildAdminNavGrid();

    this.adminPopover = Popover.getOrCreateInstance(trigger, {
      trigger: 'click',
      placement: 'right',
      container: 'body',
      html: true,
      sanitize: false,
      customClass: 'sidebar-admin-popover',
      title: ' ',
      template: '<div class="popover sidebar-admin-popover" role="tooltip"><div class="popover-body"></div></div>',
      content: buildBody,
      popperConfig: (defaultConfig: any) => ({
        ...defaultConfig,
        placement: 'right-start',
      }),
    });

    trigger.addEventListener('show.bs.popover', () => {
      this.adminPopover?.setContent({ '.popover-body': buildBody() });
    });
  }

  private disposeAdminPopover(): void {
    this.adminPopover?.dispose();
    this.adminPopover = null;
  }

  private buildAdminNavGrid(): HTMLElement {
    const grid = document.createElement('div');

    grid.className = 'sidebar-admin-popover__grid';
    grid.setAttribute('role', 'menu');

    for (const item of this.getAdminNavItems()) {
      const link = document.createElement('a');

      link.className = 'sidebar__item';
      link.href = '#';
      link.title = item.title;
      link.setAttribute('role', 'menuitem');

      if (this.isAdminNavItemActive(item)) {
        link.classList.add('active');
      }

      const icon = document.createElement('i');

      icon.className = `bi ${item.icon} me-1`;

      const label = document.createElement('span');

      label.className = 'small';
      label.textContent = item.label;

      link.append(icon, label);

      if (item.navKey === 'updates' && this.updatesAttentionBadge()) {
        const badge = document.createElement('span');

        badge.className = 'notification-badge sidebar-admin-popover__tile-badge';
        badge.setAttribute('aria-hidden', 'true');
        link.classList.add('position-relative');
        link.appendChild(badge);
      }

      link.addEventListener('click', (event) => {
        event.preventDefault();
        void this.router.navigate(item.routerLink);
        this.adminPopover?.hide();
      });
      grid.appendChild(link);
    }

    return grid;
  }

  private getAdminNavItems(): ContributorNavItem[] {
    const items: ContributorNavItem[] = [
      {
        routerLink: ['/administration/service-types'],
        activePaths: ['/administration/service-types'],
        icon: 'bi-box',
        title: $localize`:@@featureContainer-serviceTypesTitle:Providers`,
        label: $localize`:@@featureContainer-serviceTypes:Providers`,
      },
      {
        routerLink: ['/administration/cloud-init-configs'],
        activePaths: ['/administration/cloud-init-configs'],
        icon: 'bi-sliders',
        title: $localize`:@@featureContainer-cloudInitConfigsTitle:Configs`,
        label: $localize`:@@featureContainer-cloudInitConfigs:Configs`,
      },
      {
        routerLink: ['/administration/addons'],
        activePaths: ['/administration/addons'],
        icon: 'bi-puzzle',
        title: $localize`:@@featureContainer-addonsTitle:Addons`,
        label: $localize`:@@featureContainer-addons:Addons`,
      },
      {
        routerLink: ['/administration/meters'],
        activePaths: ['/administration/meters'],
        icon: 'bi-speedometer2',
        title: $localize`:@@featureContainer-metersTitle:Meters`,
        label: $localize`:@@featureContainer-meters:Meters`,
      },
      {
        routerLink: ['/administration/service-plans'],
        activePaths: ['/administration/service-plans'],
        icon: 'bi-cart',
        title: $localize`:@@featureContainer-servicePlansTitle:Plans`,
        label: $localize`:@@featureContainer-servicePlans:Plans`,
      },
      {
        routerLink: ['/administration/subscriptions'],
        activePaths: ['/administration/subscriptions'],
        icon: 'bi-collection',
        title: $localize`:@@featureContainer-adminSubscriptionsTitle:Contracts`,
        label: $localize`:@@featureContainer-adminSubscriptions:Contracts`,
      },
      {
        routerLink: ['/administration/promotions'],
        activePaths: ['/administration/promotions'],
        icon: 'bi-tag',
        title: $localize`:@@featureContainer-adminPromotionsTitle:Promotions`,
        label: $localize`:@@featureContainer-adminPromotions:Promotions`,
      },
      {
        routerLink: ['/administration/offers'],
        activePaths: ['/administration/offers'],
        icon: 'bi-file-earmark-text',
        title: $localize`:@@featureContainer-adminOffersTitle:Offers`,
        label: $localize`:@@featureContainer-adminOffers:Offers`,
      },
      {
        routerLink: ['/updates'],
        activePaths: ['/updates'],
        icon: 'bi-arrow-repeat',
        navKey: 'updates',
        title: $localize`:@@featureContainer-updatesTitle:Updates`,
        label: $localize`:@@featureContainer-updates:Updates`,
      },
      {
        routerLink: ['/webhooks'],
        activePaths: ['/webhooks'],
        icon: 'bi-broadcast',
        title: $localize`:@@featureContainer-webhooksTitle:Webhooks`,
        label: $localize`:@@featureContainer-webhooks:Webhooks`,
      },
      {
        routerLink: ['/users'],
        activePaths: ['/users'],
        icon: 'bi-people',
        title: $localize`:@@featureContainer-userManagementTitle:User Management`,
        label: $localize`:@@featureContainer-users:Users`,
      },
      {
        routerLink: ['/administration/customer-profiles'],
        activePaths: ['/administration/customer-profiles'],
        icon: 'bi-person-badge',
        title: $localize`:@@featureContainer-adminProfilesTitle:Billing Profiles`,
        label: $localize`:@@featureContainer-adminProfiles:Customers`,
      },
      {
        routerLink: ['/administration/supplier-profiles'],
        activePaths: ['/administration/supplier-profiles'],
        icon: 'bi-truck',
        title: $localize`:@@featureContainer-adminSupplierProfilesTitle:Supplier Profiles`,
        label: $localize`:@@featureContainer-adminSupplierProfiles:Suppliers`,
      },
      {
        routerLink: ['/administration/projects'],
        activePaths: ['/administration/projects'],
        icon: 'bi-kanban-fill',
        title: $localize`:@@featureContainer-adminProjectsTitle:Projects`,
        label: $localize`:@@featureContainer-adminProjects:Projects`,
      },
      {
        routerLink: ['/administration/billing'],
        activePaths: ['/administration/billing'],
        icon: 'bi-receipt-cutoff',
        title: $localize`:@@featureContainer-adminBillingTitle:Billing`,
        label: $localize`:@@featureContainer-adminBilling:Billing`,
      },
    ];

    if (this.datevExportEnabled()) {
      items.push({
        routerLink: ['/administration/datev-exports'],
        activePaths: ['/administration/datev-exports'],
        icon: 'bi-file-earmark-spreadsheet',
        title: $localize`:@@featureContainer-adminDatevExportsTitle:DATEV Exports`,
        label: $localize`:@@featureContainer-adminDatevExports:DATEV`,
      });
    }

    items.push(...collectContributorNavItems(FIRST_PARTY_CONTRIBUTOR_UI_MODULES).admin);

    return items;
  }

  private isAdminNavItemActive(item: ContributorNavItem): boolean {
    const url = this.router.url;

    return item.activePaths.some((path) => url.includes(path));
  }
}
