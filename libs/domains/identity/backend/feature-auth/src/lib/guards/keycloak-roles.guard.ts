import { getAuthenticationMethod, IS_PUBLIC_KEY, KEYCLOAK_ROLES_KEY, UserRole } from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** Keycloak token structure with realm_access and resource_access. */
interface KeycloakTokenPayload {
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown }>;
  [key: string]: unknown;
}

@Injectable()
export class KeycloakRolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (getAuthenticationMethod() !== 'keycloak') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ patAuthenticated?: boolean; user?: unknown }>();

    if (request.patAuthenticated) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(KEYCLOAK_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = request;
    const roles = this.getRolesFromKeycloakToken(user);

    if (roles.length === 0) {
      return false;
    }

    return requiredRoles.some((role) => roles.includes(role));
  }

  /**
   * Extracts roles from user object.
   * Supports Keycloak token structure (realm_access.roles, resource_access.<client>.roles)
   * and our format (user.roles) when set by KeycloakAuthGuard.
   */
  private getRolesFromKeycloakToken(user: unknown): string[] {
    if (!user || typeof user !== 'object') {
      return [];
    }

    const obj = user as Record<string, unknown>;

    // Our format: user.roles is already an array (from KeycloakAuthGuard)
    if (Array.isArray(obj.roles)) {
      return obj.roles.filter((r): r is string => typeof r === 'string');
    }

    // Keycloak format: extract from realm_access and resource_access
    const tokenPayload = obj as KeycloakTokenPayload;
    const roles: string[] = [];
    const seen = new Set<string>();

    function collectRoles(value: unknown): void {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && !seen.has(item)) {
            seen.add(item);
            roles.push(item);
          } else if (item !== null && typeof item === 'object') {
            collectRoles(item);
          }
        }
      } else if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value)) {
          collectRoles(v);
        }
      }
    }

    collectRoles(tokenPayload.realm_access?.roles);

    if (tokenPayload.resource_access && typeof tokenPayload.resource_access === 'object') {
      for (const resource of Object.values(tokenPayload.resource_access)) {
        if (resource !== null && typeof resource === 'object' && 'roles' in resource) {
          collectRoles((resource as { roles?: unknown }).roles);
        }
      }
    }

    return roles;
  }
}
