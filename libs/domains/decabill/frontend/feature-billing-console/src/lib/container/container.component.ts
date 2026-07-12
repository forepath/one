import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { ENVIRONMENT, LocaleService } from '@forepath/shared/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { combineLatest, filter, map, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

interface BootstrapPopoverInstance {
  dispose(): void;
  hide(): void;
  setContent(content: Record<string, string | Element | null | (() => string)>): void;
}

interface BootstrapPopoverConstructor {
  getOrCreateInstance(element: Element, options?: Record<string, unknown>): BootstrapPopoverInstance;
}

interface AdminNavItem {
  activePaths: string[];
  icon: string;
  label: string;
  routerLink: string[];
  title: string;
}

function getBootstrapPopover(): BootstrapPopoverConstructor | undefined {
  return (window as Window & { bootstrap?: { Popover?: BootstrapPopoverConstructor } }).bootstrap?.Popover;
}

@Component({
  selector: 'framework-billing-console-container',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class BillingConsoleContainerComponent implements OnInit, OnDestroy {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly billingCapabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject(ENVIRONMENT).productName;

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
            url.includes('/invoices') ||
            url.includes('/projects') ||
            url.includes('/administration') ||
            url.includes('/users'),
        ),
      ),
    {
      initialValue:
        this.router.url.includes('/dashboard') ||
        this.router.url.includes('/subscriptions') ||
        this.router.url.includes('/promotions') ||
        this.router.url.includes('/invoices') ||
        this.router.url.includes('/projects') ||
        this.router.url.includes('/administration') ||
        this.router.url.includes('/users'),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;

  /**
   * True when the user can access the user manager (admin with users/keycloak auth).
   * This also implies that the user can access the administration console.
   */
  readonly canAccessAdministration$ = this.authenticationFacade.canAccessBillingAdministration$;

  readonly datevExportEnabled = toSignal(this.billingCapabilitiesFacade.datevExportEnabled$, {
    initialValue: false,
  });

  readonly isAdminRouteActive = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
      map((url) => url.includes('/administration') || url.includes('/users')),
    ),
    {
      initialValue: this.router.url.includes('/administration') || this.router.url.includes('/users'),
    },
  );

  private adminPopover: BootstrapPopoverInstance | null = null;

  @ViewChild('adminNavTrigger') set adminNavTrigger(ref: ElementRef<HTMLElement> | undefined) {
    this.onAdminNavTriggerReady(ref);
  }

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

  /**
   * Initialize component and check authentication status
   */
  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();

    this.authenticationFacade.canAccessBillingAdministration$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((canAccess) => {
        if (canAccess) {
          this.billingCapabilitiesFacade.loadCapabilities();
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
   * Handles logout action
   */
  onLogout(): void {
    this.authenticationFacade.logout();
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
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void this.router.navigate(item.routerLink);
        this.adminPopover?.hide();
      });
      grid.appendChild(link);
    }

    return grid;
  }

  private getAdminNavItems(): AdminNavItem[] {
    const items: AdminNavItem[] = [
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
        routerLink: ['/users'],
        activePaths: ['/users'],
        icon: 'bi-people',
        title: $localize`:@@featureContainer-userManagementTitle:User Management`,
        label: $localize`:@@featureContainer-users:Users`,
      },
      {
        routerLink: ['/administration/customer-profiles'],
        activePaths: ['/administration/customer-profiles'],
        icon: 'bi-person-vcard',
        title: $localize`:@@featureContainer-adminProfilesTitle:Billing Profiles`,
        label: $localize`:@@featureContainer-adminProfiles:Profiles`,
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

    return items;
  }

  private isAdminNavItemActive(item: AdminNavItem): boolean {
    const url = this.router.url;

    return item.activePaths.some((path) => url.includes(path));
  }
}
