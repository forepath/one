import { getUserFromRequest, UserRole, UsersRoles, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RequireScopes } from '../decorators/require-scopes.decorator';
import { CreateUserDto } from '../dto/auth/create-user.dto';
import { UpdateUserDto } from '../dto/auth/update-user.dto';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersService } from '../services/users.service';

/**
 * Administrative user management. Admins manage every account; managers may list all accounts but only create
 * and manage regular users (enforced in {@link UsersService} from the caller's role).
 */
@Controller('users')
@UseGuards(UsersAuthGuard)
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
@RequireScopes('users:admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Caller role for account-level checks; static credentials (api-key / mTLS) act as admin. */
  private actorRole(req?: RequestWithUser): UserRole {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    return userInfo.isApiKeyAuth ? UserRole.ADMIN : (userInfo.userRole ?? UserRole.USER);
  }

  @Get()
  async findAll(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll(limit ?? 10, offset ?? 0, search);
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req?: RequestWithUser) {
    return this.usersService.create(dto, this.actorRole(req));
  }

  @Post(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req?: RequestWithUser,
  ) {
    return this.usersService.update(id, dto, this.actorRole(req));
  }

  @Post(':id/lock')
  async lock(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    return this.usersService.lockUser(id, req?.user?.id, this.actorRole(req));
  }

  @Post(':id/unlock')
  async unlock(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    return this.usersService.unlockUser(id, req?.user?.id, this.actorRole(req));
  }

  @Post(':id/confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    return this.usersService.confirmEmail(id, this.actorRole(req));
  }

  @Delete(':id/2fa/totp')
  @HttpCode(HttpStatus.OK)
  async clearTotp(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    return this.usersService.clearTotp(id, this.actorRole(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    const userId = req?.user?.id;

    return this.usersService.remove(id, userId, this.actorRole(req));
  }
}
