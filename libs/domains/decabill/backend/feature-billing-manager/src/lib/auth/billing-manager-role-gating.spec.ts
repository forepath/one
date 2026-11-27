// archiver ships ESM only; controllers are loaded for metadata, never executed.
jest.mock('archiver', () => ({ ZipArchive: jest.fn() }));

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { collectControllerClasses, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';
import { METHOD_METADATA } from '@nestjs/common/constants';

const libDir = join(__dirname, '..');
/** Admin-only on purpose: managers may not change tenant / global settings. */
const ADMIN_ONLY_CONTROLLERS = ['AdminBillingSettingsController'];

function findControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return findControllerFiles(path);
    }

    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** `@UsersRoles` per route (handler metadata overrides the controller's, like the guard's getAllAndOverride). */
function routeRoles(controller: new (...args: never[]) => unknown): Array<{ route: string; roles: UserRole[] }> {
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .filter((name) => Reflect.getMetadata(METHOD_METADATA, prototype[name] as object) !== undefined)
    .map((name) => ({
      route: `${controller.name}.${name}`,
      roles:
        (Reflect.getMetadata(USERS_ROLES_KEY, prototype[name] as object) as UserRole[] | undefined) ??
        (Reflect.getMetadata(USERS_ROLES_KEY, controller) as UserRole[] | undefined) ??
        [],
    }));
}

describe('Decabill manager role gating', () => {
  const modules = findControllerFiles(libDir).map((file) => require(file) as Record<string, unknown>);
  const routes = collectControllerClasses(modules).flatMap((controller) => routeRoles(controller as never));
  const gated = routes.filter((route) => route.roles.length > 0);

  it('finds role-gated routes', () => {
    expect(gated.length).toBeGreaterThan(100);
  });

  it('opens every admin route to managers, except the admin-only settings', () => {
    const wrong = gated
      .filter((route) => !ADMIN_ONLY_CONTROLLERS.includes(route.route.split('.')[0]))
      .filter((route) => !(route.roles.includes(UserRole.ADMIN) && route.roles.includes(UserRole.MANAGER)))
      .map((route) => `${route.route}: ${route.roles.join(',')}`);

    expect(wrong).toEqual([]);
  });

  it('keeps tenant / global settings admin-only', () => {
    const settings = gated.filter((route) => ADMIN_ONLY_CONTROLLERS.includes(route.route.split('.')[0]));

    expect(settings.length).toBeGreaterThanOrEqual(3);
    expect(settings.every((route) => route.roles.length === 1 && route.roles[0] === UserRole.ADMIN)).toBe(true);
  });

  it('never gates a route to managers without admins', () => {
    expect(gated.filter((route) => !route.roles.includes(UserRole.ADMIN)).map((route) => route.route)).toEqual([]);
  });
});
