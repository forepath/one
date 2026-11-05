import 'reflect-metadata';

import { IS_PUBLIC_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';
import { METHOD_METADATA } from '@nestjs/common/constants';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

import { IdentityAppAuthorizationController } from './identity-app-authorization.controller';
import { IdentityAppTokenController } from './identity-app-token.controller';
import { IdentityAppsController } from './identity-apps.controller';

type ControllerClass = abstract new (...args: never[]) => unknown;

function routes(controller: ControllerClass) {
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .filter((name) => Reflect.getMetadata(METHOD_METADATA, prototype[name]) !== undefined)
    .map((name) => {
      const handler = prototype[name] as object;
      const read = <T>(key: string): T | undefined =>
        (Reflect.getMetadata(key, handler) as T | undefined) ?? (Reflect.getMetadata(key, controller) as T | undefined);

      return {
        name,
        isPublic: read<boolean>(IS_PUBLIC_KEY) === true,
        interactiveOnly: read<boolean>(REQUIRE_PASSWORD_SESSION_KEY) === true,
        scopes: read<string[]>(REQUIRE_SCOPES_KEY) ?? [],
        roles: read<UserRole[]>(USERS_ROLES_KEY) ?? [],
      };
    });
}

/**
 * Machine credentials (PATs, app tokens) must never manage apps or approve grants:
 * that would let a token mint new tokens or widen its own reach.
 */
describe('identity app routes', () => {
  it('admin app management is interactive-only and admin-gated with no scope that could unlock it', () => {
    const list = routes(IdentityAppsController);

    expect(list.length).toBeGreaterThanOrEqual(9);

    for (const route of list) {
      expect(route).toMatchObject({ isPublic: false, interactiveOnly: true, scopes: [] });
      expect(route.roles).toContain(UserRole.ADMIN);
    }
  });

  it('grant page and own-grant routes are interactive-only', () => {
    for (const route of routes(IdentityAppAuthorizationController)) {
      expect(route).toMatchObject({ isPublic: false, interactiveOnly: true, scopes: [] });
    }
  });

  it('only the token endpoint is public', () => {
    expect(routes(IdentityAppTokenController)).toEqual([expect.objectContaining({ name: 'token', isPublic: true })]);
  });
});
