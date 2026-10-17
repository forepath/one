import type { AccessMe } from '@forepath/loadweaver/frontend/data-access-console';

import type { ConsoleNavItem } from '../console-nav';
import { administersSomething, hasAnyRole } from './access-format';

/** Whether the caller is in a nav item's audience (items without one are for everyone signed in). */
export function navAudienceAllows(item: Pick<ConsoleNavItem, 'audience'>, me: AccessMe | null | undefined): boolean {
  switch (item.audience) {
    case 'member':
      return hasAnyRole(me);
    case 'admin':
      return administersSomething(me);
    default:
      return true;
  }
}
