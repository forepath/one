import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
} from '@forepath/identity/frontend';
import { ConsoleAccessFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { ENVIRONMENT, LocaleService } from '@forepath/loadweaver/frontend/util-configuration';
import {
  FpcButtonComponent,
  FpcLanguageSwitcherComponent,
  FpcNotificationIndicatorComponent,
  FpcSectionContainerComponent,
  FpcSidebarComponent,
  FpcSidebarPopoverComponent,
  FpcThemeSwitcherComponent,
  FpcTopBarComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, distinctUntilChanged, filter, map, startWith } from 'rxjs';

import { navAudienceAllows } from '../access/nav-audience';
import { CONSOLE_ADMIN_NAV_ITEMS, CONSOLE_NAV_ITEMS } from '../console-nav';
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
 * members don't get infrastructure views), admin popover for cluster admins.
 */
@Component({
  selector: 'loadweaver-console-container',
  imports: [
    CommonModule,
    RouterModule,
    IdentityLogoutConfirmModalComponent,
    FpcButtonComponent,
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

  /** The sidebar for the caller: infrastructure views for cluster roles only. */
  readonly navItems = toSignal(
    combineLatest([this.access.seesInfrastructure$, this.access.me$]).pipe(
      map(([infrastructure, me]) =>
        CONSOLE_NAV_ITEMS.filter((item) => (infrastructure || !item.infrastructure) && navAudienceAllows(item, me)),
      ),
    ),
    { initialValue: CONSOLE_NAV_ITEMS.filter((item) => !item.infrastructure && !item.audience) },
  );

  /** Cluster admins manage webhooks; global admins (users / keycloak) manage users. */
  readonly adminNavItems = toSignal(
    combineLatest([this.access.isClusterAdmin$, this.authenticationFacade.canAccessUserManager$]).pipe(
      map(([clusterAdmin, userManager]) =>
        CONSOLE_ADMIN_NAV_ITEMS.filter(
          (item) =>
            (item.requires === 'cluster-admin' && clusterAdmin) ||
            (item.requires === 'user-manager' && userManager) ||
            !item.requires,
        ),
      ),
    ),
    { initialValue: [] },
  );

  adminPopoverOpen = false;

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  showChrome(): boolean {
    return !isBareRoute(this.url());
  }

  isAdminRouteActive(): boolean {
    return this.adminNavItems().some((item) => this.url().includes(item.path));
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

          if (this.isUsersAuth) this.authenticationFacade.loadTwoFactorStatus();
        } else {
          this.access.clear();
        }
      });
  }

  onLogoutClick(): void {
    this.logoutConfirmModal?.open();
  }

  onLogoutConfirmed(result: { invalidateAllSessions: boolean }): void {
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }
}
