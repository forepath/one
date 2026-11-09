import { isAdminNavUrl, isMainSidebarUrl, isToolWindowUrl } from './container-nav-urls';

describe('container nav urls', () => {
  it('keeps the main sidebar on workspace pages incl. pipelines and on the connections admin pages', () => {
    for (const url of [
      '/pipelines',
      '/pipelines/c1?workflowId=w1&runId=r1',
      '/tasks/c1',
      '/initiatives/c1?initiativeId=i1&tab=work',
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

  it('detects tool windows', () => {
    expect(isToolWindowUrl('/clients/c1/agents/a1/vnc?x=1')).toBe(true);
    expect(isToolWindowUrl('/pipelines/c1')).toBe(false);
  });
});
