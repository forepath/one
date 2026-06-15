import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { filter, map, startWith } from 'rxjs';

import { PORTAL_COMPARISON_NAV_ITEMS } from '../comparison/shared/misc/comparison-nav.items';

const PORTAL_LOCALE_PREFIXES = new Set(['en', 'de']);

/**
 * Path after optional /en or /de prefix, without leading slash (e.g. "", "agentctx", "compare/devin").
 */
function portalRoutePathFromRouterUrl(url: string): string {
  const pathOnly = url.split('?')[0]?.split('#')[0] ?? '';
  const segments = pathOnly.split('/').filter(Boolean);
  const first = segments[0];

  if (first !== undefined && PORTAL_LOCALE_PREFIXES.has(first)) {
    return segments.slice(1).join('/');
  }

  return segments.join('/');
}

function isProductDropdownRoutePath(path: string): boolean {
  return path === '' || path === 'agentctx' || path === 'desktop' || path === 'cloud';
}

function isComparisonDropdownRoutePath(path: string): boolean {
  return path === 'compare' || path.startsWith('compare/');
}

@Component({
  selector: 'framework-portal-container',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalContainerComponent {
  protected readonly localeService = inject(LocaleService);

  private readonly router = inject(Router);

  readonly comparisonNavItems = PORTAL_COMPARISON_NAV_ITEMS;

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

  /**
   * True when the user has scrolled the page
   */
  readonly isScrolled = signal<boolean>(false);

  /**
   * Check if the user has scrolled the page
   */
  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled.set(window.scrollY > 0);
  }

  /**
   * Toggle mobile menu
   */
  toggleMobileMenu(): void {
    this.mobileMenuOpen.set(!this.mobileMenuOpen());
  }

  /**
   * Close mobile menu
   */
  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
