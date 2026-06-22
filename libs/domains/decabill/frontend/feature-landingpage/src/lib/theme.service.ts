import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

/**
 * Service for managing application theme (light/dark mode)
 * Uses Bootstrap 5's dark mode functionality via data-bs-theme attribute
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = 'theme-preference';
  private readonly htmlElement = this.document.documentElement;

  /**
   * Signal indicating whether dark mode is enabled
   */
  readonly isDarkMode = signal<boolean>(this.getInitialTheme());

  constructor() {
    this.applyTheme(this.isDarkMode());

    effect(() => {
      this.applyTheme(this.isDarkMode());
    });
  }

  toggleTheme(): void {
    this.isDarkMode.set(!this.isDarkMode());
  }

  setTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
  }

  private getInitialTheme(): boolean {
    const stored = this.document.defaultView?.localStorage.getItem(this.storageKey);

    if (stored !== null) {
      return stored === 'dark';
    }

    if (this.document.defaultView?.matchMedia) {
      return this.document.defaultView.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  }

  private applyTheme(isDark: boolean): void {
    if (isDark) {
      this.htmlElement.setAttribute('data-bs-theme', 'dark');
    } else {
      this.htmlElement.setAttribute('data-bs-theme', 'light');
    }

    if (this.document.defaultView?.localStorage) {
      this.document.defaultView.localStorage.setItem(this.storageKey, isDark ? 'dark' : 'light');
    }
  }
}
