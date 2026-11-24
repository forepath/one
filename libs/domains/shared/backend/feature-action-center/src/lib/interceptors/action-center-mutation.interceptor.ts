import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

import { ActionCenterService } from '../services/action-center.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Request fields set by the identity guards (user session / PAT) or the static credential. */
type AuthenticatedRequest = Request & { user?: unknown; apiKeyAuthenticated?: boolean };

/**
 * Global interceptor: after every successful authenticated mutating HTTP request, signal a possible to-do change for
 * the request's scope. Cheap (debounced recompute only where viewers are connected, one throttled Valkey write) and it covers
 * every admin and customer action without wiring each service.
 */
@Injectable()
export class ActionCenterMutationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActionCenterMutationInterceptor.name);

  constructor(private readonly actionCenter: ActionCenterService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const method = request?.method?.toUpperCase();

    if (!method || !MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    // Anonymous requests (sign-in, public forms) never trigger recomputes: nobody can load the system by posting
    // to public endpoints. Their effects still arrive through published events and the periodic refresh.
    if (!request.user && !request.apiKeyAuthenticated) {
      return next.handle();
    }

    // Resolve the scope while the request context (tenant) is certainly active.
    let scopeKey: string | null = null;

    try {
      scopeKey = this.actionCenter.currentScopeKey();
    } catch (error) {
      this.logger.debug(`Action center scope unavailable: ${(error as Error)?.message ?? error}`);
    }

    return next.handle().pipe(
      tap({
        complete: () => {
          if (scopeKey) {
            this.actionCenter.signalChange(scopeKey);
          }
        },
      }),
    );
  }
}
