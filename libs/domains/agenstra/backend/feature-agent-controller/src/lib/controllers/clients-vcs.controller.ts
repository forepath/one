import {
  CommitDto,
  CreateBranchDto,
  GitBranchDto,
  GitDiffDto,
  GitStatusDto,
  PrepareCleanWorkspaceDto,
  PushOptionsDto,
  RebaseDto,
  ResolveConflictDto,
  StageFilesDto,
  UnstageFilesDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentVcsProxyService } from '../services/client-agent-vcs-proxy.service';

/**
 * Controller for proxied agent VCS (Version Control System) operations.
 * Provides endpoints that proxy VCS requests to client endpoints.
 */
@Controller('clients/:clientId/agents/:agentId/vcs')
@RequireScopes('agents:vcs')
export class ClientsVcsController {
  constructor(
    private readonly clientAgentVcsProxyService: ClientAgentVcsProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  /**
   * Get git status for the agent's repository.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Git status information
   */
  @Get('status')
  async getStatus(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<GitStatusDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.clientAgentVcsProxyService.getStatus(clientId, agentId);
  }

  /**
   * List all branches (local and remote).
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Array of branch information
   */
  @Get('branches')
  async getBranches(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<GitBranchDto[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.clientAgentVcsProxyService.getBranches(clientId, agentId);
  }

  /**
   * Get diff for a specific file.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The file path relative to repository root
   * @returns File diff information
   */
  @Get('diff')
  async getFileDiff(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') filePath: string,
    @Req() req?: RequestWithUser,
  ): Promise<GitDiffDto> {
    if (!filePath) {
      throw new BadRequestException('File path is required');
    }

    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.clientAgentVcsProxyService.getFileDiff(clientId, agentId, filePath);
  }

  /**
   * Stage files.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param stageFilesDto - Files to stage (empty array stages all)
   */
  @Post('stage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stageFiles(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() stageFilesDto: StageFilesDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.stageFiles(clientId, agentId, stageFilesDto);
  }

  /**
   * Unstage files.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param unstageFilesDto - Files to unstage (empty array unstages all)
   */
  @Post('unstage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unstageFiles(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() unstageFilesDto: UnstageFilesDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.unstageFiles(clientId, agentId, unstageFilesDto);
  }

  /**
   * Commit staged changes.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param commitDto - Commit message
   */
  @Post('commit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async commit(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() commitDto: CommitDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.commit(clientId, agentId, commitDto);
  }

  /**
   * Push changes to remote.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param pushOptions - Optional push options (e.g., force flag)
   */
  @Post('push')
  @HttpCode(HttpStatus.NO_CONTENT)
  async push(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() pushOptions: PushOptionsDto = {},
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.push(clientId, agentId, pushOptions);
  }

  /**
   * Pull changes from remote.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   */
  @Post('pull')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pull(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.pull(clientId, agentId);
  }

  /**
   * Fetch changes from remote.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   */
  @Post('workspace/prepare-clean')
  @HttpCode(HttpStatus.NO_CONTENT)
  async prepareCleanWorkspace(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: PrepareCleanWorkspaceDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.prepareCleanWorkspace(clientId, agentId, body);
  }

  @Post('fetch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async fetch(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.fetch(clientId, agentId);
  }

  /**
   * Rebase current branch onto another branch.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param rebaseDto - Branch to rebase onto
   */
  @Post('rebase')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rebase(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() rebaseDto: RebaseDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.rebase(clientId, agentId, rebaseDto);
  }

  /**
   * Switch to a different branch.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to switch to
   */
  @Post('branches/:branch/switch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchBranch(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('branch') branch: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.switchBranch(clientId, agentId, branch);
  }

  /**
   * Create a new branch.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param createBranchDto - Branch creation data
   */
  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createBranchDto: CreateBranchDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.createBranch(clientId, agentId, createBranchDto);
  }

  /**
   * Delete a branch.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to delete
   */
  @Delete('branches/:branch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBranch(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('branch') branch: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.deleteBranch(clientId, agentId, branch);
  }

  /**
   * Resolve a merge conflict.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param resolveConflictDto - Conflict resolution data
   */
  @Post('conflicts/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resolveConflict(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() resolveConflictDto: ResolveConflictDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.clientAgentVcsProxyService.resolveConflict(clientId, agentId, resolveConflictDto);
  }
}
