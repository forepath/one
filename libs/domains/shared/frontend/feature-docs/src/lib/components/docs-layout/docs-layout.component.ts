import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, inject, OnDestroy, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { LocaleService, ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { NavigationNode } from '@forepath/shared/frontend/util-docs-parser';

import { DocsNavigationService, ThemeService } from '../../services';
import { DocsNavigationComponent } from '../docs-navigation/docs-navigation.component';
import { DocsSearchComponent } from '../docs-search/docs-search.component';

@Component({
  selector: 'framework-docs-layout',
  imports: [CommonModule, RouterModule, DocsNavigationComponent, DocsSearchComponent],
  templateUrl: './docs-layout.component.html',
  styleUrls: ['./docs-layout.component.scss'],
  standalone: true,
})
export class DocsLayoutComponent implements AfterViewInit, OnDestroy {
  private readonly navigationService = inject(DocsNavigationService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject<Environment>(ENVIRONMENT).productName;

  /**
   * Whether we're on a mobile device (width <= 767.98px, Bootstrap md breakpoint)
   * Updates reactively on window resize via ResizeObserver
   */
  readonly isMobile = signal<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 767.98 : false);

  private resizeObserver?: ResizeObserver;

  /**
   * Get the base path (/docs) based on current route
   */
  getBasePath(): string {
    return '/docs';
  }

  /**
   * Navigation nodes
   */
  readonly navigationNodes = toSignal(this.navigationService.loadNavigation(), {
    initialValue: [] as NavigationNode[],
  });

  /**
   * Mobile menu visibility
   */
  readonly mobileMenuOpen = signal<boolean>(false);

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

  ngAfterViewInit(): void {
    // Set up ResizeObserver on the document body to detect window resize
    if (typeof window !== 'undefined' && document.body) {
      this.resizeObserver = new ResizeObserver(() => {
        // Update isMobile signal based on current window width
        this.isMobile.set(window.innerWidth <= 767.98);
      });
      this.resizeObserver.observe(document.body);
    }
  }

  ngOnDestroy(): void {
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}
