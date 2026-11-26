import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  BillingCapabilitiesFacade,
  CustomerProfileFacade,
  OffersFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, LocaleService } from '@forepath/decabill/frontend/util-configuration';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
  usesStaticCredential,
} from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { ActionCenterFacade } from '@forepath/shared/frontend/data-access-action-center';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import {
  ActionCenterPanelComponent,
  ActionCenterToggleComponent,
} from '@forepath/shared/frontend/feature-action-center';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcTopBarComponent,
  FpcLanguageSwitcherComponent,
  FpcLoadingOverlayComponent,
  FpcNotificationIndicatorComponent,
  FpcSectionContainerComponent,
  FpcSidebarComponent,
  FpcSidebarPopoverComponent,
  FpcThemeSwitcherComponent,
  fpcSidebarNavEntries,
  fpcSidebarNavGroupActive,
  type FpcSidebarNavEntry,
  type FpcSidebarNavGroup,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, distinctUntilChanged, filter, map, startWith } from 'rxjs';

import { collectContributorNavItems } from '../contributors/contributor-ui.registry';
import type { ContributorNavItem } from '../contributors/contributor-ui.types';
import { FIRST_PARTY_CONTRIBUTOR_UI_MODULES } from '../contributors/first-party-contributor-ui.modules';
import { ThemeService } from '../theme.service';

import { CONSOLE_MODE_HOME, isAppsAdminUrl, nextConsoleMode, type ConsoleMode } from './console-mode';

@Component({
  selector: 'framework-billing-console-container',
  imports: [
    CommonModule,
    RouterModule,
    IdentityLogoutConfirmModalComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcTopBarComponent,
    FpcLanguageSwitcherComponent,
    FpcLoadingOverlayComponent,
    FpcNotificationIndicatorComponent,
    FpcSectionContainerComponent,
    FpcSidebarComponent,
    FpcSidebarPopoverComponent,
    FpcThemeSwitcherComponent,
    ActionCenterPanelComponent,
    ActionCenterToggleComponent,
  ],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class BillingConsoleContainerComponent implements OnInit {
  readonly logoutLabel = $localize`:@@featureContainer-logout:Logout`;
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly billingCapabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly offersFacade = inject(OffersFacade);
  private readonly adminUpdatesFacade = inject(AdminUpdatesFacade);
  private readonly actionCenterFacade = inject(ActionCenterFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject(ENVIRONMENT).application.productName;
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);

  readonly languageSwitcherAriaLabel = $localize`:@@featureContainer-languageSwitcherAriaLabel:Select language`;
  readonly toggleDarkModeTitle = $localize`:@@featureContainer-toggleDarkMode:Toggle dark mode`;
  readonly loadingFileLabel = $localize`:@@featureContainer-loadingFile:Loading file...`;
  readonly sidebarAriaLabel = $localize`:@@featureContainer-sidebarAriaLabel:Main navigation`;
  readonly sidebarCollapseLabel = $localize`:@@featureContainer-sidebarCollapse:Collapse sidebar`;
  readonly sidebarExpandLabel = $localize`:@@featureContainer-sidebarExpand:Expand sidebar`;
  private readonly sidebar = viewChild(FpcSidebarComponent);
  /** Width of the left rail (collapsed or expanded) so the action center overlay never covers it. */
  readonly sidebarInset = computed(() => this.sidebar()?.layoutWidth() ?? '0px');
  readonly modeLabel = $localize`:@@featureContainer-mode:Mode`;
  readonly modeTitle = $localize`:@@featureContainer-modeTitle:Switch between user and admin mode`;
  /** Entries of the Mode popover: the customer pages (user) and the administration (admin). */
  readonly modeOptions: { mode: ConsoleMode; icon: string; label: string; title: string }[] = [
    {
      mode: 'user',
      icon: 'bi-person',
      label: $localize`:@@featureContainer-modeUser:User`,
      title: $localize`:@@featureContainer-modeUserTitle:User mode: plans, invoices and offers`,
    },
    {
      mode: 'admin',
      icon: 'bi-person-gear',
      label: $localize`:@@featureContainer-modeAdmin:Admin`,
      title: $localize`:@@featureContainer-modeAdminTitle:Admin mode: tenant overview and administration`,
    },
  ];

  /** True when console uses users (email/password) authentication. */
  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';

  /** True when Personal Access Tokens UI is available (users, oidc or saml; not api-key / mtls). */
  readonly isPatUiEnabled = !usesStaticCredential(this.authEnvironment.authentication.type);

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
            url.includes('/settings/tokens') ||
            url.includes('/settings/apps') ||
            isAppsAdminUrl(url) ||
            url.includes('/settings/security'),
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
        this.router.url.includes('/settings/tokens') ||
        this.router.url.includes('/settings/apps') ||
        isAppsAdminUrl(this.router.url) ||
        this.router.url.includes('/settings/security'),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;

  /**
   * Show a header badge when authenticator (TOTP) is not enrolled (users auth only).
   */
  readonly showSecurityAuthenticatorBadge$ = this.authenticationFacade.twoFactorStatus$.pipe(
    map((status) => status != null && !status.totpEnabled),
  );

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
   * True when the user can access the user manager (admin with users, oidc or saml auth).
   * This also implies that the user can access the administration console.
   */
  readonly canAccessAdministration$ = this.authenticationFacade.canAccessBillingAdministration$;
  /**
   * The action center (to-dos, top-bar bulb + right sidebar) for admins and managers, in both console modes:
   * choosing a to-do switches into the mode of its page.
   */
  readonly actionCenterAvailable = toSignal(this.authenticationFacade.canAccessBillingAdministration$, {
    initialValue: false,
  });
  readonly actionCenterOpen = toSignal(this.actionCenterFacade.panelOpen$, { initialValue: false });
  /** Admins only: settings and identity apps (managers share the rest of the administration). */
  readonly canAccessAdminOnlyAdministration = toSignal(this.authenticationFacade.canAccessAdminOnlyAdministration$, {
    initialValue: false,
  });
  readonly updatesAttentionBadge$ = this.adminUpdatesFacade.hasAttention$;
  readonly offersPendingBadge = toSignal(this.offersFacade.getPendingBadgeCount$(), { initialValue: 0 });

  readonly datevExportEnabled = toSignal(this.billingCapabilitiesFacade.datevExportEnabled$, {
    initialValue: false,
  });

  readonly accountingEnabled = toSignal(this.billingCapabilitiesFacade.accountingEnabled$, {
    initialValue: false,
  });

  /**
   * Sidebar mode: `user` (customer pages) or `admin` (administration, admins and managers only). Follows the page
   * (administration pages switch to admin, customer pages to user, account pages keep the mode) and starts in the
   * highest available mode at login.
   */
  readonly consoleMode = signal<ConsoleMode>('user');
  /** Home of the current mode: the logo and the Mode switch lead there. */
  readonly modeHome = computed(() => CONSOLE_MODE_HOME[this.consoleMode()]);

  modePopoverOpen = false;

  readonly accountPopoverAriaLabel = $localize`:@@featureContainer-accountTitle:Account`;

  /** Account popover (above Admin): the user's own security settings, tokens and authorized apps. */
  readonly accountNavItems: ContributorNavItem[] = [
    ...(this.isUsersAuth
      ? [
          {
            routerLink: ['/settings/security'],
            activePaths: ['/settings/security'],
            icon: 'bi-shield-lock',
            navKey: 'security',
            title: $localize`:@@featureContainer-securityTitle:Security`,
            label: $localize`:@@featureContainer-security:Security`,
          },
        ]
      : []),
    ...(this.isPatUiEnabled
      ? [
          {
            routerLink: ['/settings/tokens'],
            activePaths: ['/settings/tokens'],
            icon: 'bi-key',
            navKey: 'tokens',
            title: $localize`:@@featureContainer-tokensTitle:Access Tokens`,
            label: $localize`:@@featureContainer-tokens:Tokens`,
          },
          {
            routerLink: ['/settings/apps'],
            activePaths: ['/settings/apps'],
            icon: 'bi-plug',
            navKey: 'apps',
            title: $localize`:@@featureContainer-authorizedAppsTitle:Authorized apps`,
            label: $localize`:@@featureContainer-authorizedApps:Apps`,
          },
        ]
      : []),
  ];

  readonly showAccountNav$ = this.authenticationFacade.isAuthenticated$.pipe(
    map((authenticated) => authenticated && this.accountNavItems.length > 0),
  );

  readonly isAccountRouteActive = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
      map((url) => this.isAccountNavUrl(url)),
    ),
    { initialValue: this.isAccountNavUrl(this.router.url) },
  );

  accountPopoverOpen = false;

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  /**
   * Display label for the current user's role. Admin for api-key / mtls auth, otherwise user.role capitalized.
   */
  readonly userRoleDisplay$ = combineLatest([
    this.authenticationFacade.isAuthenticated$,
    this.authenticationFacade.authenticationType$,
    this.authenticationFacade.user$,
  ]).pipe(
    map(([isAuthenticated, authType, user]) => {
      if (!isAuthenticated) return null;

      if (usesStaticCredential(authType)) return 'Admin';

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
   * Locales are served as separate builds, so switching requires a full document load.
   */
  onLocaleChange(localeCode: string | null): void {
    if (!localeCode) {
      return;
    }

    window.location.href = this.localeService.getLanguageSwitchUrl(localeCode);
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

          if (this.isUsersAuth) {
            this.authenticationFacade.loadTwoFactorStatus();
          }

          this.offersFacade.loadOffersSummary({ silent: true });
        } else {
          this.customerProfileFacade.clearCustomerProfile();
          this.offersFacade.clearOffers();
        }
      });

    // Console mode follows the page and the role (see `nextConsoleMode`).
    let hadAdminAccess = false;

    combineLatest([
      this.authenticationFacade.canAccessBillingAdministration$.pipe(distinctUntilChanged()),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
        // The shell is created during the first navigation, when `router.url` is still `/`: start from the current
        // URL only once a navigation has completed (otherwise `/` would count as a user page).
        startWith(...(this.router.navigated ? [this.router.url] : [])),
      ),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([canAccessAdmin, url]) => {
        this.consoleMode.set(nextConsoleMode({ url, canAccessAdmin, hadAdminAccess, current: this.consoleMode() }));
        hadAdminAccess = canAccessAdmin;
      });

    this.authenticationFacade.canAccessBillingAdministration$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((canAccess) => {
        if (canAccess) {
          this.billingCapabilitiesFacade.loadCapabilities();
          this.adminUpdatesFacade.loadStatus();
        }
      });

    // Live to-dos while the signed-in user may administrate; disconnect on sign-out or role loss.
    this.authenticationFacade.canAccessBillingAdministration$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((canAccess) => {
        if (canAccess) {
          this.actionCenterFacade.connect();
        } else {
          this.actionCenterFacade.disconnect();
        }
      });
    this.destroyRef.onDestroy(() => this.actionCenterFacade.disconnect());

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

  /**
   * Admin sidebar (admin mode): Overview, then one tile per area that opens a popover with its pages; recomputed when
   * the DATEV / accounting capabilities or the role flip. Areas with a single visible page show that page directly.
   */
  readonly adminNavEntries = computed<FpcSidebarNavEntry<ContributorNavItem>[]>(() => {
    const isFullAdmin = this.canAccessAdminOnlyAdministration();
    const items: ContributorNavItem[] = [
      {
        routerLink: ['/administration/overview'],
        activePaths: ['/administration/overview'],
        icon: 'bi-grid',
        title: $localize`:@@featureContainer-adminOverviewTitle:Overview`,
        label: $localize`:@@featureContainer-adminOverview:Overview`,
      },
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
        title: $localize`:@@featureContainer-addonsTitle:Add-ons`,
        label: $localize`:@@featureContainer-addons:Add-ons`,
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
        title: $localize`:@@featureContainer-adminSubscriptionsTitle:Subscriptions`,
        label: $localize`:@@featureContainer-adminSubscriptions:Subscriptions`,
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
      ...(isFullAdmin
        ? [
            {
              routerLink: ['/apps'],
              activePaths: ['/apps'],
              icon: 'bi-app-indicator',
              title: $localize`:@@featureContainer-appsTitle:App management`,
              label: $localize`:@@featureContainer-apps:Apps`,
            },
          ]
        : []),
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
        routerLink: ['/administration/inventory'],
        activePaths: ['/administration/inventory'],
        icon: 'bi-box-seam',
        title: $localize`:@@featureContainer-adminInventoryTitle:Inventory`,
        label: $localize`:@@featureContainer-adminInventory:Inventory`,
      },
      {
        routerLink: ['/administration/billing'],
        activePaths: ['/administration/billing'],
        icon: 'bi-receipt-cutoff',
        title: $localize`:@@featureContainer-adminBillingTitle:Billing`,
        label: $localize`:@@featureContainer-adminBilling:Billing`,
      },
      {
        routerLink: ['/administration/file-explorer'],
        activePaths: ['/administration/file-explorer'],
        icon: 'bi-folder2-open',
        title: $localize`:@@featureContainer-adminFileExplorerTitle:File Explorer`,
        label: $localize`:@@featureContainer-adminFileExplorer:Files`,
      },
      {
        routerLink: ['/administration/spooler'],
        activePaths: ['/administration/spooler'],
        icon: 'bi-printer',
        title: $localize`:@@featureContainer-adminSpoolerTitle:Spooler: printouts and document sends`,
        label: $localize`:@@featureContainer-adminSpooler:Spooler`,
      },
      ...(isFullAdmin
        ? [
            {
              routerLink: ['/administration/settings'],
              activePaths: ['/administration/settings'],
              icon: 'bi-sliders',
              title: $localize`:@@featureContainer-adminSettingsTitle:Settings`,
              label: $localize`:@@featureContainer-adminSettings:Settings`,
            },
          ]
        : []),
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

    if (this.accountingEnabled()) {
      items.push({
        routerLink: ['/administration/accounting'],
        activePaths: ['/administration/accounting'],
        icon: 'bi-journal-bookmark',
        title: $localize`:@@featureContainer-adminAccountingTitle:Accounting`,
        label: $localize`:@@featureContainer-adminAccounting:Accounting`,
      });
    }

    const byPath = new Map(items.map((item) => [item.routerLink.join('/'), item]));
    const pick = (...paths: string[]) =>
      paths.map((path) => byPath.get(path)).filter((item): item is ContributorNavItem => item !== undefined);
    const groups: FpcSidebarNavGroup<ContributorNavItem>[] = [
      {
        key: 'overview',
        icon: 'bi-grid',
        label: '',
        title: '',
        items: pick('/administration/overview'),
      },
      {
        key: 'sales',
        icon: 'bi-briefcase',
        title: $localize`:@@featureContainer-navGroupSalesTitle:Sales: customers, subscriptions, offers and promotions`,
        label: $localize`:@@featureContainer-navGroupSales:Sales`,
        items: pick(
          '/administration/customer-profiles',
          '/administration/subscriptions',
          '/administration/offers',
          '/administration/promotions',
        ),
      },
      {
        key: 'finance',
        icon: 'bi-bank',
        title: $localize`:@@featureContainer-navGroupFinanceTitle:Finance: billing, accounting and DATEV`,
        label: $localize`:@@featureContainer-navGroupFinance:Finance`,
        items: pick('/administration/billing', '/administration/accounting', '/administration/datev-exports'),
      },
      {
        key: 'operations',
        icon: 'bi-clipboard-data',
        title: $localize`:@@featureContainer-navGroupOperationsTitle:Operations: projects, suppliers, inventory, files and spooler`,
        label: $localize`:@@featureContainer-navGroupOperations:Operations`,
        items: pick(
          '/administration/projects',
          '/administration/supplier-profiles',
          '/administration/inventory',
          '/administration/file-explorer',
          '/administration/spooler',
        ),
      },
      {
        key: 'catalog',
        icon: 'bi-boxes',
        title: $localize`:@@featureContainer-navGroupCatalogTitle:Catalog: plans, providers, configs, add-ons and meters`,
        label: $localize`:@@featureContainer-navGroupCatalog:Catalog`,
        items: pick(
          '/administration/service-plans',
          '/administration/service-types',
          '/administration/cloud-init-configs',
          '/administration/addons',
          '/administration/meters',
        ),
      },
      {
        key: 'extensions',
        icon: 'bi-plugin',
        title: $localize`:@@featureContainer-navGroupExtensionsTitle:Extensions`,
        label: $localize`:@@featureContainer-navGroupExtensions:Extensions`,
        items: collectContributorNavItems(FIRST_PARTY_CONTRIBUTOR_UI_MODULES).admin,
      },
      {
        key: 'system',
        icon: 'bi-gear',
        title: $localize`:@@featureContainer-navGroupSystemTitle:System: users, apps, webhooks, updates and settings`,
        label: $localize`:@@featureContainer-navGroupSystem:System`,
        items: pick('/users', '/apps', '/webhooks', '/updates', '/administration/settings'),
      },
    ];

    return fpcSidebarNavEntries(groups);
  });

  /** Key of the admin area whose popover is open (one at a time). */
  readonly openNavGroup = signal<string | null>(null);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  setNavGroupOpen(key: string, open: boolean): void {
    this.openNavGroup.update((current) => (open ? key : current === key ? null : current));
  }

  /** The area tile is active while one of its pages is open. */
  isNavGroupActive(group: FpcSidebarNavGroup<ContributorNavItem>): boolean {
    return fpcSidebarNavGroupActive(group, this.currentUrl());
  }

  navGroupHasKey(group: FpcSidebarNavGroup<ContributorNavItem>, navKey: string): boolean {
    return group.items.some((item) => item.navKey === navKey);
  }

  /** Switch the sidebar mode by opening that mode's home page (the mode follows the page). */
  selectMode(mode: ConsoleMode): void {
    this.modePopoverOpen = false;

    if (mode === this.consoleMode()) return;

    void this.router.navigate(CONSOLE_MODE_HOME[mode]);
  }

  private isAccountNavUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0] ?? url;

    return this.accountNavItems.some((item) =>
      item.activePaths.some((active) => path === active || path.startsWith(`${active}/`)),
    );
  }
}
