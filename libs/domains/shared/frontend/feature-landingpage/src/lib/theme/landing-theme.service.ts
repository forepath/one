import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';

/** Same key as the portals and docs, so one choice follows the visitor across every surface. */
export const LANDING_THEME_STORAGE_KEY = 'theme-preference';

/**
 * Light / dark mode for the landing pages (Bootstrap `data-bs-theme` on `<html>`).
 *
 * The app's `index.html` applies the stored choice (or the system preference) before first paint;
 * this service picks up the same value in the browser, and the toggle persists changes. On the
 * server it does nothing, so prerendered markup keeps the attribute from `index.html`.
 */
@Injectable({ providedIn: 'root' })
export class LandingThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly isDarkMode = signal<boolean>(this.initialTheme());

  constructor() {
    if (this.isBrowser) {
      effect(() => this.apply(this.isDarkMode()));
    }
  }

  setTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
  }

  toggleTheme(): void {
    this.isDarkMode.update((isDark) => !isDark);
  }

  private initialTheme(): boolean {
    const view = this.document.defaultView;

    if (!this.isBrowser || !view) {
      // Landing pages were dark-only; keep that as the server-side default.
      return true;
    }

    const attribute = this.document.documentElement.getAttribute('data-bs-theme');

    if (attribute === 'dark' || attribute === 'light') {
      return attribute === 'dark';
    }

    return view.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  }

  private apply(isDark: boolean): void {
    const theme = isDark ? 'dark' : 'light';

    this.document.documentElement.setAttribute('data-bs-theme', theme);

    try {
      this.document.defaultView?.localStorage.setItem(LANDING_THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the choice then lasts for this page.
    }
  }
}
