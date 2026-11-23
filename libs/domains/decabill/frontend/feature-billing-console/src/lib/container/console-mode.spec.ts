import { consoleModeOfUrl, isAdminConsoleUrl, nextConsoleMode } from './console-mode';

describe('console mode', () => {
  it('classifies pages by console mode', () => {
    for (const url of [
      '/administration/overview',
      '/administration/billing?f=x',
      '/administration/accounting/journal',
      '/users',
      '/webhooks',
      '/updates',
      '/apps',
      '/apps/a1',
    ]) {
      expect(consoleModeOfUrl(url)).toBe('admin');
    }

    for (const url of ['/dashboard', '/subscriptions', '/offers', '/invoices', '/projects/p1/board', '/withdrawal']) {
      expect(consoleModeOfUrl(url)).toBe('user');
    }

    for (const url of ['/settings/security', '/settings/tokens', '/settings/apps']) {
      expect(consoleModeOfUrl(url)).toBe('shared');
    }
  });

  it('does not treat look-alike paths as admin pages', () => {
    expect(isAdminConsoleUrl('/administrationx')).toBe(false);
    expect(isAdminConsoleUrl('/settings/apps')).toBe(false);
    expect(isAdminConsoleUrl('/usersettings')).toBe(false);
  });

  it('derives the console mode from the page, the role and the current mode', () => {
    const base = { canAccessAdmin: true, hadAdminAccess: true, current: 'user' as const };

    expect(nextConsoleMode({ ...base, url: '/administration/overview' })).toBe('admin');
    expect(nextConsoleMode({ ...base, url: '/dashboard', current: 'admin' })).toBe('user');
    expect(nextConsoleMode({ ...base, url: '/settings/tokens' })).toBe('user');
    expect(nextConsoleMode({ ...base, url: '/settings/tokens', current: 'admin' })).toBe('admin');
    expect(nextConsoleMode({ ...base, url: '/settings/tokens', hadAdminAccess: false })).toBe('admin');
    expect(nextConsoleMode({ ...base, url: '/administration', canAccessAdmin: false, current: 'admin' })).toBe('user');
  });
});
