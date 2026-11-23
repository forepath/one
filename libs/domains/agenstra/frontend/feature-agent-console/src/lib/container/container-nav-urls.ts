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
    path === '/overview' ||
    path.startsWith('/overview/') ||
    path.includes('/tickets') ||
    path.includes('/connections') ||
    path.includes('/knowledge') ||
    path.includes('/plans') ||
    path.includes('/tasks') ||
    path.includes('/pipelines') ||
    path.includes('/graphs') ||
    path.includes('/agent-config') ||
    path.includes('/system-settings') ||
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
    path === '/overview' ||
    path.startsWith('/overview/') ||
    path.includes('/users') ||
    path === '/apps' ||
    path.startsWith('/apps/') ||
    path.includes('/agent-config') ||
    path.includes('/system-settings') ||
    path.includes('/connections') ||
    path.includes('/webhooks') ||
    path.includes('/updates')
  );
}

/** Console mode of the sidebar: the user's workspace pages or the administration. */
export type ConsoleMode = 'user' | 'admin';

/** Home page of each console mode (logo, mode switch, `/` for the highest mode). */
export const CONSOLE_MODE_HOME: Record<ConsoleMode, string[]> = {
  user: ['/clients'],
  admin: ['/overview'],
};

/**
 * Mode a page belongs to: admin pages (`isAdminNavUrl`), pages available in both modes (`shared`: audit and the
 * account pages, they keep the current mode) and everything else (`user`).
 */
export function consoleModeOfUrl(url: string): ConsoleMode | 'shared' {
  if (isAdminNavUrl(url)) return 'admin';

  const path = pathOf(url);

  if (
    path.includes('/audit') ||
    path.includes('/settings/security') ||
    path.includes('/settings/tokens') ||
    path.includes('/settings/apps')
  ) {
    return 'shared';
  }

  return 'user';
}

/**
 * Next console mode after a navigation or role change: users without admin access are always in user mode; admin and
 * user pages set their mode; shared pages keep the current mode, except right after admin access appeared (login or
 * reload), when they start in the highest mode.
 */
export function nextConsoleMode(params: {
  url: string;
  canAccessAdmin: boolean;
  hadAdminAccess: boolean;
  current: ConsoleMode;
}): ConsoleMode {
  if (!params.canAccessAdmin) return 'user';

  const kind = consoleModeOfUrl(params.url);

  if (kind !== 'shared') return kind;

  return params.hadAdminAccess ? params.current : 'admin';
}
