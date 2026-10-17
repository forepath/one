import { DOCUMENT, isPlatformBrowser, ViewportScroller } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

/**
 * Custom ViewportScroller that adds a fixed offset to account for fixed navigation bars.
 * This ensures anchor links scroll to the correct position below the navbar.
 */
@Injectable()
export class ViewportScrollerOffset extends ViewportScroller {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly offset = 80; // Offset in pixels for fixed navbar
  private offsetPosition: [number, number] = [0, this.offset];

  setOffset(offset: [number, number] | (() => [number, number])): void {
    if (typeof offset === 'function') {
      this.offsetPosition = offset();
    } else {
      this.offsetPosition = offset;
    }
  }

  getScrollPosition(): [number, number] {
    if (!isPlatformBrowser(this.platformId)) {
      return [0, 0];
    }

    return [window.scrollX, window.scrollY];
  }

  scrollToPosition(position: [number, number]): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    window.scrollTo({
      top: position[1] - this.offsetPosition[1],
      left: position[0] - this.offsetPosition[0],
      behavior: 'smooth',
    });
  }

  scrollToAnchor(anchor: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const element = this.document.getElementById(anchor) || this.document.querySelector(`[name="${anchor}"]`);

    if (element) {
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - this.offsetPosition[1];

      window.scrollTo({
        top: offsetPosition,
        left: 0,
        behavior: 'smooth',
      });
    }
  }

  setHistoryScrollRestoration(scrollRestoration: 'auto' | 'manual'): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (window.history && window.history.scrollRestoration) {
      window.history.scrollRestoration = scrollRestoration;
    }
  }
}
