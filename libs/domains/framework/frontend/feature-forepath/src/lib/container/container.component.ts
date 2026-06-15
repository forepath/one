import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { LocaleService } from '@forepath/framework/frontend/util-configuration';
import { filter, map, startWith } from 'rxjs';
import { FOREPATH_CONTACT, FOREPATH_SOCIAL_LINKS } from '../forepath-contact.config';

const FOREPATH_LOCALE_PREFIXES = new Set(['en', 'de']);

function forepathRoutePathFromRouterUrl(url: string): string {
  const pathOnly = url.split('?')[0]?.split('#')[0] ?? '';
  const segments = pathOnly.split('/').filter(Boolean);
  const first = segments[0];

  if (first !== undefined && FOREPATH_LOCALE_PREFIXES.has(first)) {
    return segments.slice(1).join('/');
  }

  return segments.join('/');
}

function isServicesDropdownRoutePath(path: string): boolean {
  return path === 'consulting' || path === 'it-systems' || path === 'software-development';
}

@Component({
  selector: 'framework-forepath-container',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathContainerComponent {
  protected readonly localeService = inject(LocaleService);
  protected readonly contact = FOREPATH_CONTACT;
  protected readonly socialLinks = FOREPATH_SOCIAL_LINKS;

  private readonly router = inject(Router);

  private readonly navUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly servicesDropdownActive = computed(() =>
    isServicesDropdownRoutePath(forepathRoutePathFromRouterUrl(this.navUrl() ?? '')),
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
