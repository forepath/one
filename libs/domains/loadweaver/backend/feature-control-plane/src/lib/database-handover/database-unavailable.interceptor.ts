import {
  Injectable,
  ServiceUnavailableException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';

import { isDatabaseUnavailableError, MEMBERS_UNREACHABLE_MESSAGE } from './database-handover.utils';
import { databaseTarget, type DatabaseTargetRuntime } from './database-target.runtime';

/**
 * On the members' database (3.43): a request that fails because the members' Postgres can't be reached (connection
 * errors, a leader shutting down, a read-only session in the fallback) answers 503 with the read-only message instead
 * of a 500 — the write guard catches most writes up front once the leader proxy notices; this covers the requests
 * already running and the gap until it does. HTTP only; other errors pass unchanged.
 */
@Injectable()
export class DatabaseUnavailableInterceptor implements NestInterceptor {
  constructor(private readonly runtime: Pick<DatabaseTargetRuntime, 'target'> = databaseTarget) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          this.runtime.target === 'members' && isDatabaseUnavailableError(error)
            ? new ServiceUnavailableException({
                statusCode: 503,
                error: 'Service Unavailable',
                code: 'read-only',
                message: MEMBERS_UNREACHABLE_MESSAGE,
              })
            : error,
        ),
      ),
    );
  }
}
