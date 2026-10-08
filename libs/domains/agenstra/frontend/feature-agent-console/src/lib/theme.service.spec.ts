import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ThemeService } from './theme.service';

describe('Agent console startup theme', () => {
  const html = readFileSync(
    join(__dirname, '../../../../../../../apps/agenstra/frontend-agent-console/src/index.html'),
    'utf8',
  );
  const startupScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    localStorage.removeItem('theme-preference');
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.style.removeProperty('--bs-body-bg');
  });

  afterEach(() => {
    localStorage.removeItem('theme-preference');
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.style.removeProperty('--bs-body-bg');
  });

  function applyStartupTheme(systemDark: boolean): void {
    if (!startupScript) {
      throw new Error('Agent console startup theme script is missing');
    }
    runInNewContext(startupScript, {
      document,
      localStorage,
      window: { matchMedia: () => ({ matches: systemDark }) },
    });
  }

  it.each(['dark', 'light'])('does not pin the body background when starting in %s mode', (theme) => {
    localStorage.setItem('theme-preference', theme);
    applyStartupTheme(theme !== 'dark');

    expect(document.documentElement.getAttribute('data-bs-theme')).toBe(theme);
    expect(document.documentElement.style.getPropertyValue('--bs-body-bg')).toBe('');

    const service = TestBed.inject(ThemeService);
    for (const isDark of [false, true, false]) {
      service.setTheme(isDark);
      TestBed.tick();

      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(isDark ? 'dark' : 'light');
      expect(document.documentElement.style.getPropertyValue('--bs-body-bg')).toBe('');
      expect(localStorage.getItem('theme-preference')).toBe(isDark ? 'dark' : 'light');
    }
  });

  it.each([true, false])('uses the system preference when no theme is stored (dark: %s)', (systemDark) => {
    applyStartupTheme(systemDark);

    expect(document.documentElement.getAttribute('data-bs-theme')).toBe(systemDark ? 'dark' : 'light');
    expect(document.documentElement.style.getPropertyValue('--bs-body-bg')).toBe('');
  });
});
