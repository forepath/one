import { TestBed } from '@angular/core/testing';

import { LANDING_THEME_STORAGE_KEY, LandingThemeService } from './landing-theme.service';

describe('LandingThemeService', () => {
  const html = document.documentElement;

  afterEach(() => {
    html.removeAttribute('data-bs-theme');
    localStorage.clear();
  });

  it('starts from the theme index.html applied before first paint', () => {
    html.setAttribute('data-bs-theme', 'light');

    const service = TestBed.inject(LandingThemeService);

    expect(service.isDarkMode()).toBe(false);
  });

  it('applies and persists a new choice', () => {
    html.setAttribute('data-bs-theme', 'dark');
    const service = TestBed.inject(LandingThemeService);

    service.setTheme(false);
    TestBed.tick();

    expect(html.getAttribute('data-bs-theme')).toBe('light');
    expect(localStorage.getItem(LANDING_THEME_STORAGE_KEY)).toBe('light');

    service.toggleTheme();
    TestBed.tick();

    expect(html.getAttribute('data-bs-theme')).toBe('dark');
    expect(localStorage.getItem(LANDING_THEME_STORAGE_KEY)).toBe('dark');
  });
});
