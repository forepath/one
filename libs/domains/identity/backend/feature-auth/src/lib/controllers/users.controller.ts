import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
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
import { Request } from 'express';

import { RequireScopes } from '../decorators/require-scopes.decorator';
import { CreateUserDto } from '../dto/auth/create-user.dto';
import { UpdateUserDto } from '../dto/auth/update-user.dto';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersService } from '../services/users.service';

@Controller('users')
@UseGuards(UsersAuthGuard)
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('users:admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    return this.usersService.findAll(limit ?? 10, offset ?? 0);
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const count = await this.usersService.getUsersCount();
    const isFirstUser = count === 0;

    return this.usersService.create(dto, isFirstUser);
  }

  @Post(':id')
  async update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Post(':id/lock')
  async lock(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: Request & { user?: { id?: string } },
  ) {
    return this.usersService.lockUser(id, req?.user?.id);
  }

  @Post(':id/unlock')
  async unlock(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: Request & { user?: { id?: string } },
  ) {
    return this.usersService.unlockUser(id, req?.user?.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: Request & { user?: { id?: string } },
  ) {
    const userId = req?.user?.id;

    return this.usersService.remove(id, userId);
  }
}
