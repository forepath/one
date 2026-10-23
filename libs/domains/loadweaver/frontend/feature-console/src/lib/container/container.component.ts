import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
} from '@forepath/identity/frontend';
import {
  ConsoleAccessFacade,
  ConsoleFleetFacade,
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import { ENVIRONMENT, LocaleService } from '@forepath/loadweaver/frontend/util-configuration';
import {
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcLanguageSwitcherComponent,
  FpcNotificationIndicatorComponent,
  FpcSectionContainerComponent,
  FpcSidebarComponent,
  FpcSidebarPopoverComponent,
  FpcThemeSwitcherComponent,
  FpcTopBarComponent,
} from '@forepath/shared/frontend/ui-components';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import { combineLatest, distinctUntilChanged, filter, map, skip, startWith } from 'rxjs';

import {
  activeConsoleNavPath,
  CONSOLE_ADMIN_NAV_ITEMS,
  CONSOLE_NAV,
  type ConsoleNavContext,
  type ConsoleNavItem,
  type ConsoleNavView,
  consoleNavItemVisible,
  fleetConsoleNav,
  visibleConsoleNav,
} from '../console-nav';
import { FLEET_ADMIN_ONLY_PATHS, FLEET_UNAVAILABLE_PATHS } from '../fleet/fleet-format';
import { isGlobalAdmin } from '../guards/global-admin.guard';
import { LoadweaverSearchPaletteComponent } from '../search/search-palette.component';
import { ThemeService } from '../theme.service';

/** Routes without the console chrome (sign-in and friends). */
export const BARE_ROUTES = [
  '/login',
  '/register',
  '/request-password-reset',
  '/request-password-reset-confirmation',
  '/reset-password',
  '/confirm-email',
  '/login-2fa',
  // The wallboard kiosk (3.25): no login, full screen.
  '/kiosk',
];

/** Pages shown without the console's chrome (sign-in flows, the kiosk); the locale prefix is ignored. */
export function isBareRoute(url: string): boolean {
  const path = url.split('?')[0].replace(/^\/(de|en)(?=\/|$)/, '');

  return BARE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * The console shell (3.16): top bar (security, language, theme, logout), the sidebar for the caller's role (project
 * members don't get infrastructure views) grouped into popovers by process, admin popover in the footer.
 */
@Component({
  selector: 'loadweaver-console-container',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IdentityLogoutConfirmModalComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcLanguageSwitcherComponent,
    FpcNotificationIndicatorComponent,
    FpcSectionContainerComponent,
    FpcSidebarComponent,
    FpcSidebarPopoverComponent,
    FpcThemeSwitcherComponent,
    FpcTopBarComponent,
    LoadweaverSearchPaletteComponent,
  ],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class LoadweaverConsoleContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly fleet = inject(ConsoleFleetFacade);
  private readonly adminUpdatesFacade = inject(AdminUpdatesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject(ENVIRONMENT).application.productName;

  readonly languageSwitcherAriaLabel = $localize`:@@lwConsoleContainer-languageSwitcherAriaLabel:Select language`;
  readonly toggleDarkModeTitle = $localize`:@@lwConsoleContainer-toggleDarkMode:Toggle dark mode`;
  readonly sidebarAriaLabel = $localize`:@@lwConsoleContainer-sidebarAriaLabel:Main navigation`;
  readonly adminPopoverAriaLabel = $localize`:@@lwConsoleContainer-adminTitle:Admin`;
  readonly clusterSwitcherLabel = $localize`:@@lwConsoleContainer-clusterSwitcher:Cluster`;
  readonly fleetLevelLabel = $localize`:@@lwConsoleContainer-fleetLevel:Fleet (all clusters)`;

  /** Fleet mode (3.24): the console works on the fleet and, through its relay, on the active cluster. */
  readonly fleetMode = this.fleet.fleetMode;
  readonly activeClusterId = this.fleet.activeClusterId;
  readonly fleetClusters = toSignal(this.fleet.clusters$, { initialValue: [] as FleetCluster[] });
  /** The cluster switcher's choices (retired connections are closed). */
  private readonly activeCluster$ = toObservable(this.fleet.activeClusterId);
  readonly switchableClusters = computed(() => this.fleetClusters().filter((c) => c.state !== 'retired'));

  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';
  readonly isPatUiEnabled =
    this.authEnvironment.authentication.type === 'users' || this.authEnvironment.authentication.type === 'keycloak';

  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  readonly showSecurityAuthenticatorBadge$ = this.authenticationFacade.twoFactorStatus$.pipe(
    map((status) => status != null && !status.totpEnabled),
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Global admins (users / keycloak admins, the API key): the shared release announcements. */
  private readonly globalAdmin$ = isGlobalAdmin(this.authenticationFacade);

  private readonly navContext = toSignal(
    combineLatest([
      this.access.seesInfrastructure$,
      this.access.me$,
      this.access.isClusterAdmin$,
      this.authenticationFacade.canAccessUserManager$,
      this.globalAdmin$,
    ]).pipe(
      map(
        ([infrastructure, me, clusterAdmin, userManager, globalAdmin]): ConsoleNavContext => ({
          infrastructure,
          me,
          clusterAdmin,
          userManager,
          globalAdmin,
          patUi: this.isPatUiEnabled,
        }),
      ),
    ),
    {
      initialValue: {
        infrastructure: false,
        me: null,
        clusterAdmin: false,
        userManager: false,
        globalAdmin: false,
        patUi: this.isPatUiEnabled,
      },
    },
  );

  /** The sidebar for the caller: plain links and group popovers (infrastructure views for cluster roles only). */
  readonly nav = computed<ConsoleNavView[]>(() =>
    visibleConsoleNav(
      this.fleetMode
        ? fleetConsoleNav(CONSOLE_NAV, !!this.activeClusterId(), FLEET_UNAVAILABLE_PATHS, FLEET_ADMIN_ONLY_PATHS)
        : CONSOLE_NAV,
      this.navContext(),
    ),
  );

  /**
   * Cluster admins manage webhooks; global admins manage users and see the release announcements. In fleet mode only
   * the fleet's own admin items (users of the fleet's identity).
   */
  readonly adminNavItems = computed<ConsoleNavItem[]>(() =>
    CONSOLE_ADMIN_NAV_ITEMS.filter(
      (item) =>
        consoleNavItemVisible(item, this.navContext()) &&
        !(this.fleetMode && FLEET_UNAVAILABLE_PATHS.includes(item.path)),
    ),
  );

  /** The path of the sidebar item the current route belongs to (marks the item and its group active). */
  readonly activePath = computed(() =>
    activeConsoleNavPath(this.url(), [
      ...this.nav().flatMap((view) => (view.kind === 'link' ? [view.item] : view.items)),
      ...this.adminNavItems(),
    ]),
  );

  /** The shared updates feature has something for global admins (badge on Admin and its Updates item). */
  readonly updatesAttentionBadge$ = combineLatest([this.globalAdmin$, this.adminUpdatesFacade.hasAttention$]).pipe(
    map(([globalAdmin, attention]) => globalAdmin && !!attention),
  );

  /** The open popover (a group id or `admin`); only one at a time. */
  readonly openPopover = signal<string | null>(null);

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  showChrome(): boolean {
    return !isBareRoute(this.url());
  }

  isAdminRouteActive(): boolean {
    const active = this.activePath();

    return this.adminNavItems().some((item) => item.path === active);
  }

  isGroupActive(view: ConsoleNavView): boolean {
    const active = this.activePath();

    return view.kind === 'group' && view.items.some((item) => item.path === active);
  }

  /** Popover state from the component (trigger click, outside click, Escape); stale closes of others are ignored. */
  onPopoverOpenChange(id: string, open: boolean): void {
    if (open) this.openPopover.set(id);
    else if (this.openPopover() === id) this.openPopover.set(null);
  }

  /** Enter / Space on a trigger (the popover component only listens for clicks). */
  onPopoverTriggerKey(id: string, event: Event): void {
    event.preventDefault();
    this.openPopover.set(this.openPopover() === id ? null : id);
  }

  closePopover(): void {
    this.openPopover.set(null);
  }

  /** Locales are separate builds: switching needs a full document load. */
  onLocaleChange(localeCode: string | null): void {
    if (localeCode) window.location.href = this.localeService.getLanguageSwitchUrl(localeCode);
  }

  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();
    this.authenticationFacade.isAuthenticated$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.access.load();

          if (this.fleetMode) this.fleet.loadClusters();

          if (this.isUsersAuth) this.authenticationFacade.loadTwoFactorStatus();
        } else {
          this.access.clear();
        }
      });
    this.watchUpdatesAttention();
    this.watchActiveCluster();
  }

  /** Fleet mode: the access (fleet grant) of the newly active cluster after every switch. */
  private watchActiveCluster(): void {
    if (!this.fleetMode) return;

    combineLatest([this.activeCluster$, this.authenticationFacade.isAuthenticated$])
      .pipe(
        filter(([, isAuthenticated]) => isAuthenticated),
        map(([clusterId]) => clusterId),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.access.load());
  }

  /** The cluster switcher: a cluster opens its overview through the relay, empty goes back to the fleet. */
  onClusterSwitch(clusterId: string | null): void {
    if (clusterId) {
      this.fleet.openCluster(clusterId);
    } else {
      this.fleet.leaveCluster();
      void this.router.navigateByUrl('/fleet');
    }
  }

  private watchUpdatesAttention(): void {
    combineLatest([this.authenticationFacade.isAuthenticated$, this.globalAdmin$])
      .pipe(
        map(([isAuthenticated, globalAdmin]) => isAuthenticated && globalAdmin),
        distinctUntilChanged(),
        filter(Boolean),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.adminUpdatesFacade.loadStatus());
  }

  onLogoutClick(): void {
    this.logoutConfirmModal?.open();
  }

  onLogoutConfirmed(result: { invalidateAllSessions: boolean }): void {
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }
}
