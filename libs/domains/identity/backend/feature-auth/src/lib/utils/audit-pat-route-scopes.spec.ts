import { Public, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Controller, Get, Post } from '@nestjs/common';

import { RequireInteractiveSession, RequireScopes } from '../decorators/require-scopes.decorator';

import { auditPatRouteScopes, collectControllerClasses } from './audit-pat-route-scopes';

const catalog = ['things:read', 'things:write', 'things:admin'];

@Controller('things')
@RequireScopes('things:read')
class GoodController {
  @Get()
  list(): string {
    return '';
  }

  @Post()
  @RequireScopes('things:write')
  create(): string {
    return '';
  }

  @Get('public')
  @Public()
  open(): string {
    return '';
  }

  @Get('interactive')
  @RequireInteractiveSession()
  interactive(): string {
    return '';
  }
}

@Controller('admin/things')
@UsersRoles(UserRole.ADMIN)
class GoodAdminController {
  @Post()
  @RequireScopes('things:admin')
  create(): string {
    return '';
  }
}

@Controller('bad')
class BadController {
  @Get()
  unscoped(): string {
    return '';
  }

  @Get('unknown')
  @RequireScopes('other:read')
  unknown(): string {
    return '';
  }

  @Get('legacy')
  @RequireScopes('things:pay')
  legacy(): string {
    return '';
  }

  @Get('leak')
  @RequireScopes('things:admin')
  adminScopeOnUserRoute(): string {
    return '';
  }
}

@Controller('admin/bad')
@UsersRoles(UserRole.ADMIN)
class BadAdminController {
  @Post()
  @RequireScopes('things:write')
  create(): string {
    return '';
  }
}

describe('auditPatRouteScopes', () => {
  it('accepts consistent controllers', () => {
    expect(auditPatRouteScopes([GoodController, GoodAdminController], { catalog })).toEqual([]);
  });

  it('flags missing, unknown, non-conformant and level-inconsistent scopes', () => {
    const problems = auditPatRouteScopes([BadController, BadAdminController], { catalog }).map(
      (violation) => `${violation.route}: ${violation.problem}`,
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        'BadController.unscoped: no @RequireScopes (unreachable for PATs)',
        'BadController.unknown: scope other:read is not in the product catalog',
        'BadController.legacy: scope things:pay does not follow <resource>:read|write|admin',
        'BadController.adminScopeOnUserRoute: non-admin route uses admin scope things:admin',
        'BadAdminController.create: admin route uses non-admin scope things:write',
      ]),
    );
  });

  it('treats in-code admin controllers as admin routes', () => {
    expect(
      auditPatRouteScopes([BadController], { catalog, inCodeAdminControllers: [BadController] }).some((violation) =>
        violation.problem.startsWith('non-admin route uses admin scope'),
      ),
    ).toBe(false);
  });

  it('treats declared in-code admin routes as admin routes and flags stale declarations', () => {
    const problems = auditPatRouteScopes([BadController], {
      catalog,
      inCodeAdminRoutes: ['BadController.adminScopeOnUserRoute', 'BadController.gone'],
    }).map((violation) => `${violation.route}: ${violation.problem}`);

    expect(problems).not.toContain(
      'BadController.adminScopeOnUserRoute: non-admin route uses admin scope things:admin',
    );
    expect(problems).toContain('BadController.gone: declared in-code admin route does not exist');
  });

  it('collects only controller classes from modules', () => {
    expect(collectControllerClasses([{ GoodController, helper: () => undefined, value: 1 }])).toEqual([GoodController]);
  });
});
