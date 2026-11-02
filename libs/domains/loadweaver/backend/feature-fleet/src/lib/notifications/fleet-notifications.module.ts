import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import {
  IDENTITY_EMAIL_EVENTS,
  IDENTITY_EMAIL_SUBJECTS,
  INSTANCE_SCOPE_KEY,
  NotificationsModule,
  resolveEmailCompanyFrom,
  resolveEmailCompanyName,
  resolveIdentityEmailTemplateRoots,
} from '@forepath/shared/backend';
import { ForbiddenException, Module } from '@nestjs/common';

import { FLEET_QUEUE_NAME } from '../constants/fleet.constants';
import { fleetCallerFromRequest } from '../services/fleet-access.service';

/**
 * Webhook endpoints of the fleet are managed by fleet admins (the API key and global admins); PATs additionally
 * need `webhooks:admin`. The fleet publishes no events of its own yet (empty catalog) — the shared feature always
 * mounts the endpoint routes, so they are guarded like every other fleet admin route.
 */
export function assertFleetNotificationAdmin(req: unknown): void {
  if (!fleetCallerFromRequest(req as RequestWithUser).isAdmin) throw new ForbiddenException('fleet admins only');

  assertPatScopes(getUserFromRequest(req as RequestWithUser), 'webhooks:admin');
}

export const fleetNotificationsModule = NotificationsModule.register({
  applicationId: 'loadweaver-fleet',
  scopeMode: 'instance',
  controllerPath: 'admin/webhooks',
  queueName: FLEET_QUEUE_NAME,
  eventCatalog: [],
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertFleetNotificationAdmin,
  // Identity transactional email only (signup confirmation, login 2FA codes, password reset).
  email: {
    templateRoots: resolveIdentityEmailTemplateRoots(),
    emailEventCatalog: [...IDENTITY_EMAIL_EVENTS],
    subjectRegistry: { ...IDENTITY_EMAIL_SUBJECTS },
    resolveCompanyName: () => resolveEmailCompanyName(),
    resolveCompanyFrom: () => resolveEmailCompanyFrom(),
  },
});

/** The shared notifications feature (email deliveries, webhook endpoints) for the fleet service. */
@Module({
  imports: [fleetNotificationsModule],
  exports: [fleetNotificationsModule],
})
export class FleetNotificationsModule {}
