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
    // Apply theme on initialization
    this.applyTheme(this.isDarkMode());

    // Watch for theme changes and apply them
    effect(() => {
      this.applyTheme(this.isDarkMode());
    });
  }

  /**
   * Toggle between light and dark mode
   */
  toggleTheme(): void {
    this.isDarkMode.set(!this.isDarkMode());
  }

  /**
   * Set theme explicitly
   * @param isDark - true for dark mode, false for light mode
   */
  setTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
  }

  /**
   * Get initial theme from localStorage or system preference
   */
  private getInitialTheme(): boolean {
    // Check localStorage first
    const stored = this.document.defaultView?.localStorage.getItem(this.storageKey);

    if (stored !== null) {
      return stored === 'dark';
    }

    // Fall back to system preference
    if (this.document.defaultView?.matchMedia) {
      return this.document.defaultView.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Default to light mode
    return false;
  }

  /**
   * Apply theme to the document
   */
  private applyTheme(isDark: boolean): void {
    if (isDark) {
      this.htmlElement.setAttribute('data-bs-theme', 'dark');
    } else {
      this.htmlElement.setAttribute('data-bs-theme', 'light');
    }

    // Persist preference to localStorage
    if (this.document.defaultView?.localStorage) {
      this.document.defaultView.localStorage.setItem(this.storageKey, isDark ? 'dark' : 'light');
    }
  }
}
