import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { filter, map, startWith } from 'rxjs';

import { PORTAL_COMPARISON_NAV_ITEMS } from '../comparison/shared/misc/comparison-nav.items';

const PORTAL_LOCALE_PREFIXES = new Set(['en', 'de']);

function portalRoutePathFromRouterUrl(url: string): string {
  const pathOnly = url.split('?')[0]?.split('#')[0] ?? '';
  const segments = pathOnly.split('/').filter(Boolean);
  const first = segments[0];

  if (first !== undefined && PORTAL_LOCALE_PREFIXES.has(first)) {
    return segments.slice(1).join('/');
  }

  return segments.join('/');
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

  readonly comparisonDropdownActive = computed(() =>
    isComparisonDropdownRoutePath(portalRoutePathFromRouterUrl(this.navUrl() ?? '')),
  );

  readonly mobileMenuOpen = signal<boolean>(false);
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
  }
}
