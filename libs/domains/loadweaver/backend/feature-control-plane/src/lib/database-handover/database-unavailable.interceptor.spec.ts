import { ServiceUnavailableException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';

import { MEMBERS_UNREACHABLE_MESSAGE } from './database-handover.utils';
import { DatabaseUnavailableInterceptor } from './database-unavailable.interceptor';

/** Requests failing on an unreachable members' database answer 503, not 500 (3.43). */
describe('DatabaseUnavailableInterceptor', () => {
  const http = { getType: () => 'http' } as never;
  const failing = (error: unknown) => ({ handle: () => throwError(() => error) });
  const run = (target: 'external' | 'members' | null, error: unknown, context = http) =>
    firstValueFrom(new DatabaseUnavailableInterceptor({ target }).intercept(context, failing(error))).catch(
      (e: unknown) => e,
    );

  it('maps connection errors on the members target to 503 with the read-only message', async () => {
    const result = await run('members', new Error('Connection terminated unexpectedly'));

    expect(result).toBeInstanceOf(ServiceUnavailableException);
    expect((result as ServiceUnavailableException).message).toBe(MEMBERS_UNREACHABLE_MESSAGE);
    expect((result as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'read-only',
      message: MEMBERS_UNREACHABLE_MESSAGE,
    });
  });

  it('leaves other errors, other targets and non-HTTP contexts alone', async () => {
    const query = new Error('duplicate key value violates unique constraint');
    const lost = new Error('Connection terminated unexpectedly');

    expect(await run('members', query)).toBe(query);
    expect(await run('external', lost)).toBe(lost);
    expect(await run(null, lost)).toBe(lost);
    expect(await run('members', lost, { getType: () => 'ws' } as never)).toBe(lost);
  });
});
