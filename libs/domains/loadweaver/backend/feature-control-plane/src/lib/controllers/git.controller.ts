import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  AuthorizeGitAccountDto,
  ConfirmGitAccountDto,
  CreateGitConnectionDto,
  ExportToRepoDto,
  UpdateGitConnectionDto,
  type GitCommitDto,
  type GitConnectionDto,
  type GitExportResultDto,
  type GitPendingLinkDto,
  type GitSyncResultDto,
} from '../dto/git.dto';
import { ProjectAccessService } from '../access/project-access.service';
import { GitAccountsService, type GitAccountDto } from '../git/git-accounts.service';
import { GitConnectionsService } from '../git/git-connections.service';
import { ClusterSopsDecryptor, GitSopsDecryptor } from '../git/git-sops';
import { GitSyncService } from '../git/git-sync.service';

/**
 * Git connections (3.29): per scope (cluster or project) repository, branch, path and mode; direct API like
 * memberships (cluster admins / project admins), with test, sync, export and host-key reset actions.
 */
@Controller('git/connections')
export class GitConnectionsController {
  constructor(
    private readonly connections: GitConnectionsService,
    private readonly sync: GitSyncService,
  ) {}

  @Get()
  @RequireScopes('resources:read')
  async list(@Req() req?: RequestWithUser): Promise<GitConnectionDto[]> {
    return await this.connections.list(req);
  }

  @Post()
  @RequireScopes('git:admin')
  async create(
    @Body() dto: CreateGitConnectionDto,
    @Req() req?: RequestWithUser,
  ): Promise<GitConnectionDto & { webhookSecret: string }> {
    return await this.connections.create(req, dto);
  }

  @Get(':id')
  @RequireScopes('resources:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<GitConnectionDto> {
    return await this.connections.get(req, id);
  }

  @Patch(':id')
  @RequireScopes('git:admin')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGitConnectionDto,
    @Req() req?: RequestWithUser,
  ): Promise<GitConnectionDto> {
    return await this.connections.update(req, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('git:admin')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.connections.remove(req, id);
  }

  @Get(':id/commits')
  @RequireScopes('resources:read')
  async commits(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<GitCommitDto[]> {
    return await this.connections.commits(req, id, Number(limit) || 50);
  }

  @Get(':id/webhook-secret')
  @RequireScopes('git:admin')
  async webhookSecret(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ webhookSecret: string }> {
    return await this.connections.revealWebhookSecret(req, id);
  }

  /** A new webhook secret: the old one stops working at once (audited). */
  @Post(':id/webhook-secret/rotate')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:admin')
  async rotateWebhookSecret(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ webhookSecret: string; webhookGeneration: number }> {
    return await this.connections.rotateWebhookSecret(req, id);
  }

  @Post(':id/host-key/reset')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:admin')
  async resetHostKey(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<GitConnectionDto> {
    return await this.connections.resetHostKey(req, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:admin')
  async test(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<{
    ok: boolean;
    head: string | null;
    defaultBranch?: string | null;
    hostKey: string | null;
    error?: string;
  }> {
    return await this.sync.test(req, id);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:admin')
  async syncNow(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<GitSyncResultDto> {
    return await this.sync.syncNow(req, id);
  }

  @Post(':id/export')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:admin')
  async exportToRepo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExportToRepoDto,
    @Req() req?: RequestWithUser,
  ): Promise<GitExportResultDto> {
    return await this.sync.exportToRepo(req, id, dto.force === true);
  }
}

/**
 * Webhook deliveries (3.29): public, authenticated by the connection's derived secret (GitHub / Gitea
 * `X-Hub-Signature-256`, GitLab `X-Gitlab-Token`) over the raw body. Pushes to the branch queue a sync; pull request
 * events belong to the plan bot.
 */
@Public()
@Controller('git/webhooks')
export class GitWebhooksController {
  constructor(private readonly sync: GitSyncService) {}

  @Post(':connection')
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Param('connection') connection: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<{ status: 'queued' | 'ignored'; event: string }> {
    return await this.sync.webhook(connection, headers, Buffer.isBuffer(body) ? body : Buffer.alloc(0));
  }
}

/** Git accounts linked to the caller (plan bot commands act with the user's roles, 3.30). */
@Controller('git/accounts')
export class GitAccountsController {
  constructor(private readonly accounts: GitAccountsService) {}

  @Get()
  @RequireScopes('git:accounts')
  async list(@Req() req?: RequestWithUser): Promise<GitAccountDto[]> {
    return await this.accounts.list(req);
  }

  /**
   * The provider's authorize URL (signed, single-use state, valid 10 minutes); the console navigates there. Through a
   * trusted fleet the body may name the fleet console's page the callback returns to (`returnUrl`, 3.41).
   */
  @Post(':provider/authorize')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:accounts')
  async authorize(
    @Param('provider') provider: string,
    @Body() dto?: AuthorizeGitAccountDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ url: string; expiresAt: string }> {
    return await this.accounts.authorize(req, provider, dto?.returnUrl);
  }

  /** The provider account an OAuth flow of the caller returned, waiting for confirmation. */
  @Get('pending/:nonce')
  @RequireScopes('git:accounts')
  async pending(@Param('nonce') nonce: string, @Req() req?: RequestWithUser): Promise<GitPendingLinkDto> {
    return await this.accounts.pending(req, nonce);
  }

  /** Confirms a pending link (the same user who started the flow). */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('git:accounts')
  async confirm(@Body() dto: ConfirmGitAccountDto, @Req() req?: RequestWithUser): Promise<GitAccountDto> {
    return await this.accounts.confirm(req, dto.nonce);
  }

  @Delete('pending/:nonce')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('git:accounts')
  async cancel(@Param('nonce') nonce: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.accounts.cancel(req, nonce);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('git:accounts')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.accounts.remove(req, id);
  }
}

/**
 * The OAuth callback (public: the provider redirects the browser here). It never links by itself: it records the
 * returned provider account as a pending link and redirects to the console's own settings page, where the signed-in
 * user who started the flow confirms it (or a fixed error code). Without a console URL it answers with the result.
 */
@Public()
@Controller('git/accounts')
export class GitAccountsCallbackController {
  constructor(private readonly accounts: GitAccountsService) {}

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.accounts.callback(provider, {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof state === 'string' ? { state } : {}),
      ...(typeof error === 'string' ? { error } : {}),
    });
    // A link started through a trusted fleet returns to that fleet's console (recorded in the signed state, 3.41).
    const target = this.accounts.settingsUrl(result, this.accounts.returnUrlOf(state));

    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');

    if (target) {
      res.redirect(HttpStatus.FOUND, target);

      return;
    }

    res.status('confirm' in result ? HttpStatus.OK : HttpStatus.BAD_REQUEST).json(result);
  }
}

/** SOPS (3.29): the cluster's public age recipient, to encrypt files to (`sops encrypt --age <recipient>`). */
@Controller('git/sops')
export class GitSopsController {
  constructor(
    private readonly sops: GitSopsDecryptor,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('recipient')
  @RequireScopes('resources:read')
  async recipient(@Req() req?: RequestWithUser): Promise<{ recipient: string; createdAt: string }> {
    const caller = await this.access.caller(req);

    // Public information, but only for members of the cluster or a project.
    if (!caller.isApiKey && !caller.clusterRole && caller.projects.size === 0)
      throw new ForbiddenException('a cluster or project role is required');

    if (!(this.sops instanceof ClusterSopsDecryptor))
      throw new NotFoundException('SOPS is not available on this cluster');

    try {
      return await this.sops.recipient();
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'SOPS identity unavailable');
    }
  }
}
