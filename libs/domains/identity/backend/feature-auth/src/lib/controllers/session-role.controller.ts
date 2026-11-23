import { normalizeConsoleUserRole, type UserRole } from '@forepath/identity/backend';
import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { RequireInteractiveSession } from '../decorators/require-scopes.decorator';
import { UsersAuthGuard, type AuthenticatedUsersRequestUser } from '../guards/users-auth.guard';
import { UsersRepository } from '../repositories/users.repository';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

/**
 * Console role of the signed-in user, read from the local users table. OIDC sessions carry no local role claim,
 * so consoles ask here which administration features to show; the API enforces roles regardless of the UI.
 */
@Controller('auth')
@UseGuards(UsersAuthGuard)
export class SessionRoleController {
  constructor(private readonly usersRepository: UsersRepository) {}

  @RequireInteractiveSession()
  @Get('role')
  async getRole(@Req() req: RequestWithUser): Promise<{ role: UserRole }> {
    const user = req.user?.id ? await this.usersRepository.findById(req.user.id) : null;

    if (!user) {
      throw new UnauthorizedException();
    }

    return { role: normalizeConsoleUserRole(user.role) };
  }
}
