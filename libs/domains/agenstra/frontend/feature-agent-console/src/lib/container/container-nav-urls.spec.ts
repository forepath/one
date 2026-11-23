import {
  consoleModeOfUrl,
  isAdminNavUrl,
  isMainSidebarUrl,
  isToolWindowUrl,
  nextConsoleMode,
} from './container-nav-urls';

describe('container nav urls', () => {
  it('keeps the main sidebar on workspace pages incl. pipelines and on the connections admin pages', () => {
    for (const url of [
      '/pipelines',
      '/pipelines/c1?workflowId=w1&runId=r1',
      '/tasks/c1',
      '/connections/deployments',
      '/connections/atlassian',
    ]) {
      expect(isMainSidebarUrl(url)).toBe(true);
    }

    expect(isMainSidebarUrl('/clients/c1/agents/a1/editor')).toBe(false);
  });

  it('marks the admin popover active on connections', () => {
    expect(isAdminNavUrl('/connections/deployments')).toBe(true);
    expect(isAdminNavUrl('/connections/atlassian')).toBe(true);
    expect(isAdminNavUrl('/pipelines/c1')).toBe(false);
  });

  it('keeps the sidebar and marks the admin popover active on the admin overview', () => {
    expect(isMainSidebarUrl('/overview')).toBe(true);
    expect(isMainSidebarUrl('/overview?f=groupBy%3Dhour')).toBe(true);
    expect(isMainSidebarUrl('/overview/c1')).toBe(true);
    expect(isAdminNavUrl('/overview/c1?f=groupBy%3Dhour')).toBe(true);
    expect(isAdminNavUrl('/audit')).toBe(false);
  });

  it('detects tool windows', () => {
    expect(isToolWindowUrl('/clients/c1/agents/a1/vnc?x=1')).toBe(true);
    expect(isToolWindowUrl('/pipelines/c1')).toBe(false);
  });

  it('classifies pages by console mode', () => {
    for (const url of ['/overview', '/overview/c1?f=x', '/users', '/apps', '/agent-config', '/connections/atlassian']) {
      expect(consoleModeOfUrl(url)).toBe('admin');
    }

    for (const url of ['/clients', '/tickets/c1', '/knowledge', '/pipelines/c1', '/graphs']) {
      expect(consoleModeOfUrl(url)).toBe('user');
    }

    for (const url of ['/audit', '/settings/security', '/settings/tokens', '/settings/apps']) {
      expect(consoleModeOfUrl(url)).toBe('shared');
    }
  });

  it('derives the console mode from the page, the role and the current mode', () => {
    const base = { canAccessAdmin: true, hadAdminAccess: true, current: 'user' as const };

    expect(nextConsoleMode({ ...base, url: '/overview' })).toBe('admin');
    expect(nextConsoleMode({ ...base, url: '/tickets', current: 'admin' })).toBe('user');
    // Shared pages keep the current mode ...
    expect(nextConsoleMode({ ...base, url: '/audit' })).toBe('user');
    expect(nextConsoleMode({ ...base, url: '/audit', current: 'admin' })).toBe('admin');
    // ... but start in the highest mode when admin access just appeared (login, reload).
    expect(nextConsoleMode({ ...base, url: '/audit', hadAdminAccess: false })).toBe('admin');
    // Without admin access there is only user mode.
    expect(nextConsoleMode({ ...base, url: '/overview', canAccessAdmin: false, current: 'admin' })).toBe('user');
  });
});
