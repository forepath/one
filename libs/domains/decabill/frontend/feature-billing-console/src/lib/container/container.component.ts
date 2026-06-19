import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { ENVIRONMENT, LocaleService } from '@forepath/shared/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { combineLatest, filter, map, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

@Component({
  selector: 'framework-billing-console-container',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class BillingConsoleContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
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
            url.includes('/invoices') ||
            url.includes('/administration') ||
            url.includes('/users'),
        ),
      ),
    {
      initialValue:
        this.router.url.includes('/dashboard') ||
        this.router.url.includes('/subscriptions') ||
        this.router.url.includes('/invoices') ||
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
}
