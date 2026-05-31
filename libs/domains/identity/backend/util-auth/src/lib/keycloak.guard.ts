import { APP_GUARD } from '@nestjs/core';

import {
  BullBoardSkippingAuthGuard,
  BullBoardSkippingResourceGuard,
  BullBoardSkippingRoleGuard,
} from './bull-board-keycloak.guards';

export const KeycloakGuard = [
  {
    provide: APP_GUARD,
    useClass: BullBoardSkippingAuthGuard,
  },
  {
    provide: APP_GUARD,
    useClass: BullBoardSkippingResourceGuard,
  },
  {
    provide: APP_GUARD,
    useClass: BullBoardSkippingRoleGuard,
  },
];
