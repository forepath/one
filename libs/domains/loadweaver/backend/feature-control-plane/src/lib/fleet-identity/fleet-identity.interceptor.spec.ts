import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { FleetIdentityInterceptor } from './fleet-identity.interceptor';

const context = (req: Record<string, unknown>) =>
  ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as never;
const next = { handle: () => of('ok') };
const identity = { person: 'fleet:f:u' };

describe('FleetIdentityInterceptor (3.24)', () => {
  it('attaches the verified person to state-changing requests', async () => {
    const fleets = { evaluate: jest.fn(async () => ({ result: 'verified', identity })) };
    const req: Record<string, unknown> = { method: 'POST' };

    await expect(
      lastValueFrom(await new FleetIdentityInterceptor(fleets as never).intercept(context(req), next)),
    ).resolves.toBe('ok');
    expect(fleets.evaluate).toHaveBeenCalledWith(req, true);
    expect(req['fleetIdentity']).toBe(identity);
  });

  it('refuses a trusted fleet’s failing claim, for reads too', async () => {
    const fleets = { evaluate: jest.fn(async () => ({ result: 'refused', reason: 'claim replayed' })) };
    const interceptor = new FleetIdentityInterceptor(fleets as never);

    await expect(interceptor.intercept(context({ method: 'DELETE' }), next)).rejects.toThrow(ForbiddenException);
    await expect(interceptor.intercept(context({ method: 'GET' }), next)).rejects.toThrow(ForbiddenException);
  });

  it('scopes reads to the verified person without consuming the nonce (person-scoped relay, 2026-10-27)', async () => {
    const fleets = { evaluate: jest.fn(async () => ({ result: 'verified', identity })) };
    const req: Record<string, unknown> = { method: 'GET' };

    await new FleetIdentityInterceptor(fleets as never).intercept(context(req), next);
    expect(fleets.evaluate).toHaveBeenCalledWith(req, false);
    expect(req['fleetIdentity']).toBe(identity);
  });

  it('goes on without a person when the claim is ignored (unknown fleet)', async () => {
    const fleets = { evaluate: jest.fn(async () => ({ result: 'ignored', reason: 'not trusted' })) };
    const req: Record<string, unknown> = { method: 'POST' };

    await new FleetIdentityInterceptor(fleets as never).intercept(context(req), next);
    expect(req['fleetIdentity']).toBeUndefined();
  });

  it('leaves a fleet’s own registration to the service (proof of possession, 2026-10-29)', async () => {
    const fleets = { evaluate: jest.fn(async () => ({ result: 'refused', reason: 'key k2 is not registered' })) };
    const interceptor = new FleetIdentityInterceptor(fleets as never);

    await expect(
      lastValueFrom(
        await interceptor.intercept(context({ method: 'PUT', originalUrl: '/api/trusted-fleets/fleet-a' }), next),
      ),
    ).resolves.toBe('ok');
    expect(fleets.evaluate).not.toHaveBeenCalled();
    // Any other method on the route (and other routes) is evaluated as usual.
    await expect(
      interceptor.intercept(context({ method: 'DELETE', originalUrl: '/api/trusted-fleets/fleet-a' }), next),
    ).rejects.toThrow(ForbiddenException);
  });
});
