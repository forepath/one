import { APP_GUARD } from '@nestjs/core';

import { KeycloakAuthGuard } from '../guards/keycloak-auth.guard';
import { KeycloakRolesGuard } from '../guards/keycloak-roles.guard';
import { PatBearerAuthGuard } from '../guards/pat-bearer-auth.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';

import { getKeycloakPatAuthGuards } from './get-keycloak-pat-auth-guards';

describe('getKeycloakPatAuthGuards', () => {
  let originalAuthMethod: string | undefined;

  beforeEach(() => {
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
  });

  afterEach(() => {
    if (originalAuthMethod !== undefined) {
      process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    } else {
      delete process.env.AUTHENTICATION_METHOD;
    }
  });

  it('registers Keycloak+PAT chain in PatBearer → nest → sync → roles → scopes order', () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';

    const guards = getKeycloakPatAuthGuards();
    const classes = guards.map((g) => g.useClass);

    expect(guards.every((g) => g.provide === APP_GUARD)).toBe(true);
    expect(classes[0]).toBe(PatBearerAuthGuard);
    expect(classes.indexOf(KeycloakAuthGuard)).toBeGreaterThan(classes.indexOf(PatBearerAuthGuard));
    expect(classes.indexOf(KeycloakRolesGuard)).toBeGreaterThan(classes.indexOf(KeycloakAuthGuard));
    expect(classes.indexOf(UsersRolesGuard)).toBeGreaterThan(classes.indexOf(KeycloakRolesGuard));
    expect(classes.indexOf(PatScopesGuard)).toBeGreaterThan(classes.indexOf(UsersRolesGuard));
    expect(classes.filter((c) => c === PatBearerAuthGuard)).toHaveLength(1);
    expect(classes.filter((c) => c === KeycloakAuthGuard)).toHaveLength(1);
    expect(classes.filter((c) => c === PatScopesGuard)).toHaveLength(1);
  });

  it('does not register Keycloak PAT chain when not in keycloak mode', () => {
    process.env.AUTHENTICATION_METHOD = 'users';

    const classes = getKeycloakPatAuthGuards().map((g) => g.useClass);

    expect(classes).not.toContain(PatBearerAuthGuard);
    expect(classes).not.toContain(KeycloakAuthGuard);
  });
});
