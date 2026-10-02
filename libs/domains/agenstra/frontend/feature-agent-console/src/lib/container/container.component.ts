import { CommonModule } from '@angular/common';
import { afterNextRender, Component, DestroyRef, inject, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  NotificationsFacade,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { IdentityLogoutConfirmModalComponent, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
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
} from '@forepath/shared/frontend/ui-components';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { combineLatest, distinctUntilChanged, filter, map, pairwise, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

interface AdminNavItem {
  activePaths: string[];
  icon: string;
  label: string;
  navKey?: 'updates';
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
  readonly adminPopoverAriaLabel = $localize`:@@featureContainer-adminTitle:Admin`;

  /** True when console uses users (email/password) authentication. */
  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';

  /** True when Personal Access Tokens UI is available (users or keycloak; not api-key). */
  readonly isPatUiEnabled =
    this.authEnvironment.authentication.type === 'users' || this.authEnvironment.authentication.type === 'keycloak';

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

  /**
   * True when the user can access the user manager (admin with users/keycloak auth).
   */
  readonly canAccessUserManager$ = this.authenticationFacade.canAccessUserManager$;

  readonly isAdminRouteActive = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
      map((url) => this.isAdminNavUrl(url)),
    ),
    {
      initialValue: this.isAdminNavUrl(this.router.url),
    },
  );

  adminPopoverOpen = false;

  readonly adminNavItems: AdminNavItem[] = [
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
      routerLink: ['/filters'],
      activePaths: ['/filters'],
      icon: 'bi-funnel',
      title: $localize`:@@featureContainer-filtersTitle:Filters`,
      label: $localize`:@@featureContainer-filters:Filters`,
    },
    {
      routerLink: ['/agent-config'],
      activePaths: ['/agent-config', '/opencode-config'],
      icon: 'bi-sliders',
      title: $localize`:@@featureContainer-agentConfigTitle:Agent configuration`,
      label: $localize`:@@featureContainer-agentConfig:Agent config`,
    },
    {
      routerLink: ['/imports/atlassian'],
      activePaths: ['/imports'],
      icon: 'bi-cloud-download',
      title: $localize`:@@featureContainer-importTitle:Import`,
      label: $localize`:@@featureContainer-importTitle:Import`,
    },
  ];

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
   * True on editor / deployments / VNC tool window routes (compact chrome, no main sidebar).
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

  /** Main nav routes that keep the app sidebar (excludes agent editor/deployments/vnc). */
  private shouldShowMainSidebar(url: string): boolean {
    const path = url.split(/[?#]/)[0] ?? url;
    const onMainRoute =
      path.includes('/clients') ||
      path.includes('/users') ||
      path.includes('/filters') ||
      path.includes('/webhooks') ||
      path.includes('/updates') ||
      path.includes('/audit') ||
      path.includes('/tickets') ||
      path.includes('/imports') ||
      path.includes('/knowledge') ||
      path.includes('/agent-config') ||
      path.includes('/settings/tokens') ||
      path.includes('/settings/security');

    if (!onMainRoute) {
      return false;
    }

    return !this.isToolWindowUrl(url);
  }

  private isToolWindowUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0] ?? url;

    return path.includes('/editor') || path.includes('/deployments') || path.includes('/vnc');
  }

  private isAdminNavUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0] ?? url;

    return (
      path.includes('/users') ||
      path.includes('/filters') ||
      path.includes('/agent-config') ||
      path.includes('/imports') ||
      path.includes('/webhooks') ||
      path.includes('/updates')
    );
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
}
