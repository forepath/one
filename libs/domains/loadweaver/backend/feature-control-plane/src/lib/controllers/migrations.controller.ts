import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';

import { MigrationSessionService, type MigrationHistoryDto } from '../services/migration-session.service';

/** Migration history (3.10): every attempt with method, phases, fallback reason and measurements. */
@Controller('migrations')
export class MigrationsController {
  constructor(private readonly migrations: MigrationSessionService) {}

  @Get()
  @RequireScopes('projects:read')
  async list(
    @Query('replica') replica?: string,
    @Query('deployment') deployment?: string,
    @Query('project') project?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<MigrationHistoryDto[]> {
    const take = limit === undefined ? undefined : Number(limit);

    if (take !== undefined && (!Number.isInteger(take) || take < 1 || take > 500))
      throw new BadRequestException('limit must be between 1 and 500');

    return await this.migrations.history(req, { replica, deployment, project, limit: take });
  }
}
