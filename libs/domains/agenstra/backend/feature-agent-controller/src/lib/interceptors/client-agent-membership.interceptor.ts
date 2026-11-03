import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { from, Observable, switchMap } from 'rxjs';

import { ClientAgentMembershipService } from '../services/client-agent-membership.service';

/** `clients/:id/agents/:agentId…` or `clients/:clientId/agents/:agentId…` (any global prefix). */
const AGENT_ROUTE = /\/clients\/:(id|clientId)\/agents\/:agentId(\/|$)/;

/**
 * Agent routes of a workspace only reach the workspace's own agents. The agent-manager behind a workspace may serve
 * other workspaces too (same endpoint / API key) and answers for every agent it knows, so the controller checks the
 * agent against the workspace before proxying anything. Runs after the authentication guards (workspace access);
 * a foreign agent is indistinguishable from an unknown one.
 */
@Injectable()
export class ClientAgentMembershipInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly membership?: ClientAgentMembershipService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.membership) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      route?: { path?: string };
      params?: Record<string, string | undefined>;
    }>();
    const match = AGENT_ROUTE.exec(request.route?.path ?? '');
    const clientId = match ? request.params?.[match[1]] : undefined;
    const agentId = request.params?.['agentId'];

    if (!match || !clientId || !agentId) {
      return next.handle();
    }

    const membership = this.membership;

    return from(membership.isMember(clientId, agentId)).pipe(
      switchMap((member) => {
        if (!member) {
          throw new NotFoundException(`Agent ${agentId} was not found in this workspace`);
        }

        return next.handle();
      }),
    );
  }
}
