import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import type { RequestWithUser } from '@forepath/identity/backend';

import type { AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';

/** PAT create (`POST /auth/tokens`) and change (`PATCH /auth/tokens/:id`) of the shared identity stack. */
const PAT_MINTING_PATH = /\/auth\/tokens(?:\/[^/?]+)?\/?$/;

type MintingRequest = RequestWithUser & {
  method?: string;
  originalUrl?: string;
  url?: string;
  body?: { scopes?: unknown };
};

export function isPatMintingRequest(req: MintingRequest): boolean {
  const method = (req.method ?? '').toUpperCase();
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];

  return (method === 'POST' || method === 'PATCH') && PAT_MINTING_PATH.test(path);
}

export function requestsOnBehalfOfScope(body: MintingRequest['body']): boolean {
  const scopes = body?.scopes;

  return Array.isArray(scopes) && scopes.some((s) => typeof s === 'string' && s.trim() === ON_BEHALF_OF_SCOPE);
}

/**
 * Who may hold `fleet:on-behalf-of` (3.24): cluster admins and the cluster's fleet service users — accounts with a
 * cluster-wide role (`cluster-admin`, `infra-operator`, `auditor`; the docs recommend `auditor` / `cluster-admin`
 * for the service user). Project members and users without a cluster role can't mint it, so they can't annotate
 * the audit log with someone else's name.
 */
export function mayMintOnBehalfOfScope(caller: AccessCaller): boolean {
  return !caller.isApiKey && !!caller.clusterRole;
}

/**
 * Enforces {@link mayMintOnBehalfOfScope} at PAT creation / change in the control plane (the shared identity PAT
 * service only knows global roles). Runs after the guards, so the session user is known.
 */
@Injectable()
export class FleetOnBehalfOfScopeInterceptor implements NestInterceptor {
  constructor(private readonly access: ProjectAccessService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<MintingRequest>();

      if (isPatMintingRequest(req) && requestsOnBehalfOfScope(req.body)) {
        const caller = await this.access.caller(req);

        if (!mayMintOnBehalfOfScope(caller))
          throw new ForbiddenException(
            `${ON_BEHALF_OF_SCOPE} can only be granted to cluster admins and fleet service users (a cluster-wide role)`,
          );
      }
    }

    return next.handle();
  }
}
