/** URL heuristics of the console shell (`AgentConsoleContainerComponent`): sidebar visibility and active nav groups. */

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/** Editor / VNC tool windows (compact chrome, no main sidebar). */
export function isToolWindowUrl(url: string): boolean {
  const path = pathOf(url);

  return path.includes('/editor') || path.includes('/vnc');
}

/** Main nav routes that keep the app sidebar (excludes agent editor / VNC tool windows). */
export function isMainSidebarUrl(url: string): boolean {
  const path = pathOf(url);
  const onMainRoute =
    path.includes('/clients') ||
    path.includes('/users') ||
    path.includes('/webhooks') ||
    path.includes('/updates') ||
    path.includes('/audit') ||
    path.includes('/tickets') ||
    path.includes('/connections') ||
    path.includes('/knowledge') ||
    path.includes('/plans') ||
    path.includes('/tasks') ||
    path.includes('/pipelines') ||
    path.includes('/graphs') ||
    path.includes('/agent-config') ||
    path.includes('/settings/tokens') ||
    path.includes('/settings/apps') ||
    path === '/apps' ||
    path.startsWith('/apps/') ||
    path.includes('/settings/security');

  return onMainRoute && !isToolWindowUrl(url);
}

/** Routes of the admin popover (its trigger shows as active). */
export function isAdminNavUrl(url: string): boolean {
  const path = pathOf(url);

  return (
    path.includes('/users') ||
    path === '/apps' ||
    path.startsWith('/apps/') ||
    path.includes('/agent-config') ||
    path.includes('/connections') ||
    path.includes('/webhooks') ||
    path.includes('/updates')
  );
}
