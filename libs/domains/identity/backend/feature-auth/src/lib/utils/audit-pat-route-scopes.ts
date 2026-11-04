import { IS_PUBLIC_KEY, isAdminPatScope, parsePatScope, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

type ControllerClass = abstract new (...args: never[]) => unknown;

export interface PatRouteScopeAuditOptions {
  /** Product PAT scope catalog the routes must draw from. */
  catalog: readonly string[];
  /**
   * Controllers that enforce admin in code (e.g. `assertAdmin`) instead of `@UsersRoles(ADMIN)`.
   * They may (and must) use `:admin` scopes without role decorators.
   */
  inCodeAdminControllers?: readonly ControllerClass[];
  /** Individual routes (`ControllerName.handlerName`) that enforce admin in code (e.g. `ensureAdmin`). */
  inCodeAdminRoutes?: readonly string[];
}

export interface PatRouteScopeViolation {
  route: string;
  problem: string;
}

/**
 * Static audit of PAT scope metadata on controller routes (used by product specs):
 * - non-public, non-interactive-only routes declare at least one scope (handler or class)
 * - every scope is pattern-conformant and in the product catalog
 * - admin role-gated routes only use `:admin` scopes; `:admin` scopes only on admin routes
 */
export function auditPatRouteScopes(
  controllers: readonly ControllerClass[],
  options: PatRouteScopeAuditOptions,
): PatRouteScopeViolation[] {
  const catalog = new Set(options.catalog);
  const inCodeAdmin = new Set(options.inCodeAdminControllers ?? []);
  const inCodeAdminRoutes = new Set(options.inCodeAdminRoutes ?? []);
  const seenInCodeAdminRoutes = new Set<string>();
  const violations: PatRouteScopeViolation[] = [];

  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    const handlerNames = new Set<string>();

    for (let proto = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      Object.getOwnPropertyNames(proto).forEach((name) => handlerNames.add(name));
    }

    for (const name of handlerNames) {
      const handler = prototype[name];

      if (name === 'constructor' || typeof handler !== 'function') {
        continue;
      }

      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
        continue;
      }

      const route = `${controller.name}.${name}`;
      const read = <T>(key: string): T | undefined =>
        (Reflect.getMetadata(key, handler) as T | undefined) ?? (Reflect.getMetadata(key, controller) as T | undefined);

      if (read<boolean>(IS_PUBLIC_KEY) || read<boolean>(REQUIRE_PASSWORD_SESSION_KEY)) {
        continue;
      }

      const scopes = read<string[]>(REQUIRE_SCOPES_KEY) ?? [];
      const roleGatedAdmin = (read<UserRole[]>(USERS_ROLES_KEY) ?? []).includes(UserRole.ADMIN);
      const isAdminRoute = roleGatedAdmin || inCodeAdmin.has(controller) || inCodeAdminRoutes.has(route);

      if (inCodeAdminRoutes.has(route)) {
        seenInCodeAdminRoutes.add(route);
      }

      if (scopes.length === 0) {
        violations.push({ route, problem: 'no @RequireScopes (unreachable for PATs)' });
      }

      for (const scope of scopes) {
        if (!parsePatScope(scope)) {
          violations.push({ route, problem: `scope ${scope} does not follow <resource>:read|write|admin` });
        }

        if (!catalog.has(scope)) {
          violations.push({ route, problem: `scope ${scope} is not in the product catalog` });
        }

        if (isAdminRoute && !isAdminPatScope(scope)) {
          violations.push({ route, problem: `admin route uses non-admin scope ${scope}` });
        }

        if (!isAdminRoute && isAdminPatScope(scope)) {
          violations.push({ route, problem: `non-admin route uses admin scope ${scope}` });
        }
      }
    }
  }

  for (const route of inCodeAdminRoutes) {
    if (!seenInCodeAdminRoutes.has(route)) {
      violations.push({ route, problem: 'declared in-code admin route does not exist' });
    }
  }

  return violations;
}

/** Collect exported Nest controller classes from loaded modules. */
export function collectControllerClasses(modules: readonly Record<string, unknown>[]): ControllerClass[] {
  return modules.flatMap((mod) =>
    Object.values(mod).filter(
      (value): value is ControllerClass =>
        typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined,
    ),
  );
}
