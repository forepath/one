import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { ENVIRONMENT, LocaleService, type EnvironmentWithLanding } from '@forepath/shared/frontend/util-configuration';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcLanguageSwitcherComponent,
  type FpcLocaleOption,
} from '@forepath/shared/frontend/ui-components';
import { filter, map, startWith } from 'rxjs';

import { PORTAL_COMPARISON_NAV_ITEMS } from '../comparison/shared/misc/comparison-nav.items';
import { LoadweaverEarlyAccessDirective } from '../shared/early-access';

const PORTAL_LOCALE_PREFIXES = new Set(['en', 'de']);

/**
 * Path after optional /en or /de prefix, without leading slash (e.g. "", "apps", "compare/nomad").
 */
export function portalRoutePathFromRouterUrl(url: string): string {
  const pathOnly = url.split('?')[0]?.split('#')[0] ?? '';
  const segments = pathOnly.split('/').filter(Boolean);
  const first = segments[0];

  if (first !== undefined && PORTAL_LOCALE_PREFIXES.has(first)) {
    return segments.slice(1).join('/');
  }

  return segments.join('/');
}

export function isProductDropdownRoutePath(path: string): boolean {
  return path === '' || path === 'apps' || path === 'remote-access' || path === 'cloud';
}

export function isComparisonDropdownRoutePath(path: string): boolean {
  return path === 'compare' || path.startsWith('compare/');
}

@Component({
  selector: 'loadweaver-portal-container',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcLanguageSwitcherComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalContainerComponent {
  protected readonly localeService = inject(LocaleService);
  /** Footer copyright year, so it never goes stale. */
  protected readonly currentYear = new Date().getFullYear();

  private readonly router = inject(Router);
  private readonly environment = inject<EnvironmentWithLanding>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);

  /** Statutory withdrawal page of the billing portal (same pattern as the other landing pages). */
  readonly withdrawalUrl = this.environment.application.production
    ? `${this.environment.landing.urls.portal}/${this.locale}/withdrawal`
    : `${this.environment.landing.urls.portal}/withdrawal`;

  readonly comparisonNavItems = PORTAL_COMPARISON_NAV_ITEMS;

  readonly footerLocales: readonly FpcLocaleOption[] = this.localeService.getAvailableLocales().map((locale) => ({
    ...locale,
    href: this.localeService.getLanguageSwitchUrl(locale.code),
  }));

  private readonly navUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly productDropdownActive = computed(() =>
    isProductDropdownRoutePath(portalRoutePathFromRouterUrl(this.navUrl() ?? '')),
  );

  readonly comparisonDropdownActive = computed(() =>
    isComparisonDropdownRoutePath(portalRoutePathFromRouterUrl(this.navUrl() ?? '')),
  );

  /**
   * Mobile menu visibility
   */
  readonly mobileMenuOpen = signal<boolean>(false);
  readonly productNavOpen = signal(false);
  readonly comparisonNavOpen = signal(false);

  /**
   * True when the user has scrolled the page
   */
  readonly isScrolled = signal<boolean>(false);

  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled.set(window.scrollY > 0);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.set(!this.mobileMenuOpen());
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
    this.productNavOpen.set(false);
    this.comparisonNavOpen.set(false);
  }
}
