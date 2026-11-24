import type { EnvironmentProviders, Provider } from '@angular/core';
import { actionCenterStateProviders } from '@forepath/shared/frontend/data-access-action-center';

import { provideActionCenterPresenters } from './presenters/action-center-presenter.types';
import { ActionCenterPresentersService } from './presenters/action-center-presenters.service';
import {
  platformActionCenterPresenters,
  type PlatformActionCenterLinks,
} from './presenters/platform-action-center.presenters';

/**
 * Everything a console needs for the action center besides its environment (`ACTION_CENTER_ENVIRONMENT`,
 * `ACTION_CENTER_SOCKET_AUTH`) and its own presenters (`provideActionCenterPresenters`): the NgRx slice and the
 * presenters of the shared platform items.
 */
export function provideActionCenter(platformLinks: PlatformActionCenterLinks): Array<Provider | EnvironmentProviders> {
  return [
    ...actionCenterStateProviders,
    ActionCenterPresentersService,
    provideActionCenterPresenters(() => platformActionCenterPresenters(platformLinks)),
  ];
}
