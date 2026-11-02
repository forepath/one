import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import { isTrustedFleetRegistration, type FleetIdentityRequest } from './fleet-identity.utils';
import { TrustedFleetsService } from './trusted-fleets.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Verifies the fleet identity claim of every relayed request (3.24) before the handler runs, so the access services
 * and the audit see the acting person (`req.fleetIdentity`) and scope reads and changes to the person's grants;
 * changes consume the nonce, reads don't. A trusted fleet's claim that fails a check
 * (signature, cluster, request binding, lifetime, replay) refuses the request.
 */
@Injectable()
export class FleetIdentityInterceptor implements NestInterceptor {
  constructor(private readonly fleets: TrustedFleetsService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<FleetIdentityRequest>();

    // A fleet registering its own keys proves possession of the key it registers; the service checks that claim
    // (2026-10-29). Everything else about the route (scopes, cluster-admin role) is enforced as usual.
    if (isTrustedFleetRegistration(req)) return next.handle();

    // Reads too (2026-10-27, fleet parity): the fleet relays project grants on person-scoped read routes, so the
    // cluster must scope those reads to the person. Reads don't consume the nonce (idempotent, bound to the URL).
    const read = READ_METHODS.has((req.method ?? '').toUpperCase());
    const evaluation = await this.fleets.evaluate(req, !read);

    if (evaluation.result === 'refused')
      throw new ForbiddenException(`fleet identity claim refused: ${evaluation.reason}`);

    if (evaluation.result === 'verified') req.fleetIdentity = evaluation.identity;

    return next.handle();
  }
}
