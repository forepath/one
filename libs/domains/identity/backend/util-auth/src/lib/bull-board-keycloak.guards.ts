import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  AuthGuard as KeycloakAuthGuard,
  ResourceGuard as KeycloakResourceGuard,
  RoleGuard as KeycloakRoleGuard,
} from 'nest-keycloak-connect';

import { isBullBoardRequestPath } from './bull-board-request-path';
import { getHttpRequestPath } from './http-request-path.util';

function shouldSkipForBullBoard(context: ExecutionContext): boolean {
  return isBullBoardRequestPath(getHttpRequestPath(context));
}

/** Keycloak AuthGuard that skips Bull Board routes (HTTP Basic auth on the board). */
@Injectable()
export class BullBoardSkippingAuthGuard extends KeycloakAuthGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (shouldSkipForBullBoard(context)) {
      return Promise.resolve(true);
    }

    return super.canActivate(context);
  }
}

/** Keycloak ResourceGuard that skips Bull Board routes. */
@Injectable()
export class BullBoardSkippingResourceGuard extends KeycloakResourceGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (shouldSkipForBullBoard(context)) {
      return Promise.resolve(true);
    }

    return super.canActivate(context);
  }
}

/** Keycloak RoleGuard that skips Bull Board routes. */
@Injectable()
export class BullBoardSkippingRoleGuard extends KeycloakRoleGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (shouldSkipForBullBoard(context)) {
      return Promise.resolve(true);
    }

    return super.canActivate(context);
  }
}
