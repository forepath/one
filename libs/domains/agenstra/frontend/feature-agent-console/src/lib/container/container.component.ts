import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  NotificationsFacade,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { combineLatest, filter, map, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

@Component({
  selector: 'framework-agent-console-container',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class AgentConsoleContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  protected readonly notificationsFacade = inject(NotificationsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);

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
            (url.includes('/clients') ||
              url.includes('/users') ||
              url.includes('/filters') ||
              url.includes('/audit') ||
              url.includes('/tickets') ||
              url.includes('/imports') ||
              url.includes('/knowledge')) &&
            !url.includes('/editor') &&
            !url.includes('/config') &&
            !url.includes('/deployments'),
        ),
      ),
    {
      initialValue:
        (this.router.url.includes('/clients') ||
          this.router.url.includes('/users') ||
          this.router.url.includes('/filters') ||
          this.router.url.includes('/audit') ||
          this.router.url.includes('/tickets') ||
          this.router.url.includes('/imports') ||
          this.router.url.includes('/knowledge')) &&
        !this.router.url.includes('/editor') &&
        !this.router.url.includes('/config') &&
        !this.router.url.includes('/deployments'),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  readonly spacesAttentionBadge$ = this.notificationsFacade.spacesAttentionBadge$;

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

    this.authenticationFacade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.notificationsFacade.connectSocket();
        } else {
          this.notificationsFacade.disconnectSocket();
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
    this.notificationsFacade.disconnectSocket();
    this.authenticationFacade.logout();
  }
}
