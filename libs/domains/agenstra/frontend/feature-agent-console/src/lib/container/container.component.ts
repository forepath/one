import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  ViewChild,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  NotificationsFacade,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { LocaleService } from '@forepath/agenstra/frontend/util-configuration';
import {
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
import { combineLatest, distinctUntilChanged, filter, map, pairwise, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

import {
  CONSOLE_MODE_HOME,
  isMainSidebarUrl,
  isToolWindowUrl,
  nextConsoleMode,
  type ConsoleMode,
} from './container-nav-urls';

interface AdminNavItem {
  activePaths: string[];
  /** Admins only (hidden for managers; the route and API are admin-only as well). */
  adminOnly?: boolean;
  icon: string;
  label: string;
  navKey?: string;
  routerLink: string[];
  title: string;
}

@Component({
  selector: 'framework-agent-console-container',
  imports: [
    CommonModule,
    RouterModule,
    IdentityLogoutConfirmModalComponent,
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
export class AgentConsoleContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  protected readonly notificationsFacade = inject(NotificationsFacade);
  private readonly adminUpdatesFacade = inject(AdminUpdatesFacade);
  private readonly actionCenterFacade = inject(ActionCenterFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly loadingOverlayService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);

  constructor() {
    // Show overlay before the first paint of Workspaces/Environments on tool-window pop-outs.
    if (this.isToolWindowUrl(this.router.url)) {
      this.loadingOverlayService.setLoading(true);
    }

    // index.html #app-boot-loader survives Angular bootstrap; remove it only after this
    // container (and any tool-window overlay) has painted so there is no blank gap.
    afterNextRender(() => {
      document.getElementById('app-boot-loader')?.remove();
    });
  }

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
  /** Entries of the Mode popover: the workspace pages (user) and the administration (admin). */
  readonly modeOptions: { mode: ConsoleMode; icon: string; label: string; title: string }[] = [
    {
      mode: 'user',
      icon: 'bi-person',
      label: $localize`:@@featureContainer-modeUser:User`,
      title: $localize`:@@featureContainer-modeUserTitle:User mode: workspaces, tickets and agents`,
    },
    {
      mode: 'admin',
      icon: 'bi-person-gear',
      label: $localize`:@@featureContainer-modeAdmin:Admin`,
      title: $localize`:@@featureContainer-modeAdminTitle:Admin mode: instance overview and administration`,
    },
  ];

  /** True when console uses users (email/password) authentication. */
  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';

  /** True when Personal Access Tokens UI is available (users, oidc or saml; not api-key / mtls). */
  readonly isPatUiEnabled = !usesStaticCredential(this.authEnvironment.authentication.type);

  /**
   * True when on the main clients mask (not editor, VNC, etc.)
   */
  readonly isMainMask = toSignal(
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
        startWith(this.router.url),
      )
      .pipe(map((url) => this.shouldShowMainSidebar(url))),
    {
      initialValue: this.shouldShowMainSidebar(this.router.url),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  readonly spacesAttentionBadge$ = this.notificationsFacade.spacesAttentionBadge$;

  /**
   * Show a header badge when authenticator (TOTP) is not enrolled (users auth only).
   */
  readonly showSecurityAuthenticatorBadge$ = this.authenticationFacade.twoFactorStatus$.pipe(
    map((status) => status != null && !status.totpEnabled),
  );
  readonly updatesAttentionBadge$ = this.adminUpdatesFacade.hasAttention$;

  /** Selected space (client); tickets need a client context in the UI. */
  readonly activeClientId$ = this.clientsFacade.activeClientId$;

  /** Sidebar Tickets link: `/tickets` until a workspace is chosen, then `/tickets/:clientId`. */
  readonly ticketsSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/tickets', id] : ['/tickets']))),
    { initialValue: ['/tickets'] },
  );

  readonly knowledgeSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/knowledge', id] : ['/knowledge']))),
    { initialValue: ['/knowledge'] },
  );

  readonly plansSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/plans', id] : ['/plans']))),
    { initialValue: ['/plans'] },
  );

  readonly tasksSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/tasks', id] : ['/tasks']))),
    { initialValue: ['/tasks'] },
  );

  readonly deploymentsSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/pipelines', id] : ['/pipelines']))),
    { initialValue: ['/pipelines'] },
  );

  readonly graphsSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/graphs', id] : ['/graphs']))),
    { initialValue: ['/graphs'] },
  );

  /**
   * True when the user can access the user manager (admin with users, oidc or saml auth).
   */
  readonly canAccessUserManager$ = this.authenticationFacade.canAccessUserManager$;
  /**
   * The action center (to-dos, top-bar bulb + right sidebar) for admins and managers, in both console modes:
   * choosing a to-do switches into the mode of its page.
   */
  readonly actionCenterAvailable = toSignal(this.authenticationFacade.canAccessUserManager$, { initialValue: false });
  readonly actionCenterOpen = toSignal(this.actionCenterFacade.panelOpen$, { initialValue: false });

  /**
   * Sidebar mode: `user` (workspace pages) or `admin` (administration, admins and managers only). Follows the page
   * (admin pages switch to admin, user pages to user, shared pages such as Audit keep the mode) and starts in the
   * highest available mode at login.
   */
  readonly consoleMode = signal<ConsoleMode>('user');
  /** Home of the current mode: the logo and the Mode switch lead there. */
  readonly modeHome = computed(() => CONSOLE_MODE_HOME[this.consoleMode()]);

  modePopoverOpen = false;

  readonly accountPopoverAriaLabel = $localize`:@@featureContainer-accountTitle:Account`;

  /** Account popover (above Admin): the user's own security settings, tokens and authorized apps. */
  readonly accountNavItems: AdminNavItem[] = [
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
            title: $localize`:@@featureContainer-tokensTitle:Personal access tokens`,
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

  /** Admin sidebar items (admin mode): overview, agent setup, then the platform pages. */
  readonly adminNavItems: AdminNavItem[] = [
    {
      routerLink: ['/overview'],
      activePaths: ['/overview'],
      icon: 'bi-grid',
      title: $localize`:@@featureContainer-adminOverviewTitle:Overview`,
      label: $localize`:@@featureContainer-adminOverview:Overview`,
    },
    {
      routerLink: ['/agent-config'],
      activePaths: ['/agent-config', '/opencode-config'],
      icon: 'bi-cpu',
      title: $localize`:@@featureContainer-agentConfigTitle:Agent configuration`,
      label: $localize`:@@featureContainer-agentConfig:Agent config`,
    },
    {
      routerLink: ['/connections'],
      activePaths: ['/connections'],
      icon: 'bi-plug',
      title: $localize`:@@featureContainer-connectionsTitle:Connections (CI/CD, Atlassian)`,
      label: $localize`:@@featureContainer-connections:Connections`,
    },
    {
      routerLink: ['/users'],
      activePaths: ['/users'],
      icon: 'bi-people',
      title: $localize`:@@featureContainer-userManagementTitle:User management`,
      label: $localize`:@@featureContainer-users:Users`,
    },
    {
      routerLink: ['/apps'],
      activePaths: ['/apps'],
      adminOnly: true,
      icon: 'bi-app-indicator',
      title: $localize`:@@featureContainer-appsTitle:App management`,
      label: $localize`:@@featureContainer-apps:Apps`,
    },
    {
      routerLink: ['/webhooks'],
      activePaths: ['/webhooks'],
      icon: 'bi-broadcast',
      title: $localize`:@@featureContainer-webhooksTitle:Webhooks`,
      label: $localize`:@@featureContainer-webhooks:Webhooks`,
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
      routerLink: ['/system-settings'],
      activePaths: ['/system-settings'],
      adminOnly: true,
      icon: 'bi-sliders',
      title: $localize`:@@featureContainer-systemSettingsTitle:Settings`,
      label: $localize`:@@featureContainer-systemSettings:Settings`,
    },
  ];

  /**
   * Admin sidebar (admin mode) for the current role: Overview, then one tile per area that opens a popover with its
   * pages (managers do not see admin-only pages; an area with a single visible page shows that page directly).
   */
  readonly adminNavEntries$ = this.authenticationFacade.canAccessAdminOnlyAdministration$.pipe(
    map((isFullAdmin): FpcSidebarNavEntry<AdminNavItem>[] => {
      const visible = this.adminNavItems.filter((item) => isFullAdmin || !item.adminOnly);
      const byPath = new Map(visible.map((item) => [item.routerLink.join('/'), item]));
      const pick = (...paths: string[]) =>
        paths.map((path) => byPath.get(path)).filter((item): item is AdminNavItem => item !== undefined);

      return fpcSidebarNavEntries<AdminNavItem>([
        { key: 'overview', icon: 'bi-grid', label: '', title: '', items: pick('/overview') },
        {
          key: 'agents',
          icon: 'bi-robot',
          title: $localize`:@@featureContainer-navGroupAgentsTitle:Agents: agent configuration and connections`,
          label: $localize`:@@featureContainer-navGroupAgents:Agents`,
          items: pick('/agent-config', '/connections'),
        },
        {
          key: 'system',
          icon: 'bi-gear',
          title: $localize`:@@featureContainer-navGroupSystemTitle:System: users, apps, webhooks, updates and settings`,
          label: $localize`:@@featureContainer-navGroupSystem:System`,
          items: pick('/users', '/apps', '/webhooks', '/updates', '/system-settings'),
        },
      ]);
    }),
  );

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
  isNavGroupActive(group: FpcSidebarNavGroup<AdminNavItem>): boolean {
    return fpcSidebarNavGroupActive(group, this.currentUrl());
  }

  navGroupHasKey(group: FpcSidebarNavGroup<AdminNavItem>, navKey: string): boolean {
    return group.items.some((item) => item.navKey === navKey);
  }

  readonly logoutLabel = $localize`:@@featureContainer-logout:Logout`;

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
   * True on editor / VNC tool window routes (compact chrome, no main sidebar).
   */
  readonly isToolWindowRoute = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.isToolWindowUrl(this.router.url)),
      startWith(this.isToolWindowUrl(this.router.url)),
    ),
    { initialValue: this.isToolWindowUrl(this.router.url) },
  );

  /**
   * Signal indicating if the loading overlay should be shown.
   */
  readonly showLoadingOverlay = this.loadingOverlayService.isLoading;

  getRoleAriaLabel(role: string): string {
    return $localize`:@@featureContainer-ariaLabelRole:Role ${role}:role:`;
  }

  /** Main nav routes that keep the app sidebar (excludes agent editor/vnc). */
  private shouldShowMainSidebar(url: string): boolean {
    return isMainSidebarUrl(url);
  }

  private isToolWindowUrl(url: string): boolean {
    return isToolWindowUrl(url);
  }

  /** Switch the sidebar mode by opening that mode's home page (the mode follows the page). */
  selectMode(mode: ConsoleMode): void {
    this.modePopoverOpen = false;

    if (mode === this.consoleMode()) return;

    void this.router.navigate(CONSOLE_MODE_HOME[mode]);
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
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.notificationsFacade.connectSocket();

          if (this.isUsersAuth) {
            this.authenticationFacade.loadTwoFactorStatus();
          }
        } else {
          this.notificationsFacade.disconnectSocket();
        }
      });

    this.authenticationFacade.canAccessUserManager$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((canAccess) => {
      if (canAccess) {
        this.adminUpdatesFacade.loadStatus();
      }
    });

    // Live to-dos while the signed-in user may administrate; disconnect on sign-out or role loss.
    this.authenticationFacade.canAccessUserManager$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((canAccess) => {
        if (canAccess) {
          this.actionCenterFacade.connect();
        } else {
          this.actionCenterFacade.disconnect();
        }
      });
    this.destroyRef.onDestroy(() => this.actionCenterFacade.disconnect());

    // Console mode follows the page and the role (see `nextConsoleMode`).
    let hadAdminAccess = false;

    combineLatest([
      this.authenticationFacade.canAccessUserManager$.pipe(distinctUntilChanged()),
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

    // Mask tool-window boot so Workspaces/Environments never flash before the panel opens.
    // Content panels clear the overlay when ready; only toggle on enter/leave here.
    if (this.isToolWindowUrl(this.router.url)) {
      this.loadingOverlayService.setLoading(true);
    }

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.isToolWindowUrl(this.router.url)),
        startWith(this.isToolWindowUrl(this.router.url)),
        distinctUntilChanged(),
        pairwise(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([wasToolWindow, isToolWindow]) => {
        if (!wasToolWindow && isToolWindow) {
          this.loadingOverlayService.setLoading(true);
        } else if (wasToolWindow && !isToolWindow) {
          this.loadingOverlayService.setLoading(false);
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
    this.notificationsFacade.disconnectSocket();
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }

  private isAccountNavUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0] ?? url;

    return this.accountNavItems.some((item) =>
      item.activePaths.some((active) => path === active || path.startsWith(`${active}/`)),
    );
  }
}
