/** Console mode of the sidebar: the customer pages or the administration. */
export type ConsoleMode = 'user' | 'admin';

/** Home page of each console mode (logo, mode switch, `/` for the highest mode). */
export const CONSOLE_MODE_HOME: Record<ConsoleMode, string[]> = {
  user: ['/dashboard'],
  admin: ['/administration/overview'],
};

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/** Admin app management (`/apps`), not `/settings/apps` or the `/authorize` grant page. */
export function isAppsAdminUrl(url: string): boolean {
  const path = pathOf(url);

  return path === '/apps' || path.startsWith('/apps/');
}

/** Administration pages: `/administration/*` plus the shared admin pages (users, apps, webhooks, updates). */
export function isAdminConsoleUrl(url: string): boolean {
  const path = pathOf(url);

  return (
    path === '/administration' ||
    path.startsWith('/administration/') ||
    path === '/users' ||
    path.startsWith('/users/') ||
    path === '/webhooks' ||
    path.startsWith('/webhooks/') ||
    path === '/updates' ||
    path.startsWith('/updates/') ||
    isAppsAdminUrl(url)
  );
}

/**
 * Mode a page belongs to: administration pages (`admin`), the account pages available in both modes (`shared`, they
 * keep the current mode) and everything else (`user`).
 */
export function consoleModeOfUrl(url: string): ConsoleMode | 'shared' {
  if (isAdminConsoleUrl(url)) return 'admin';

  const path = pathOf(url);

  if (
    path.startsWith('/settings/security') ||
    path.startsWith('/settings/tokens') ||
    path.startsWith('/settings/apps')
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
