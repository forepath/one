import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { CommitDto } from '../dto/commit.dto';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { GitBranchDto } from '../dto/git-branch.dto';
import { GitDiffDto } from '../dto/git-diff.dto';
import { GitStatusDto } from '../dto/git-status.dto';
import { PrepareCleanWorkspaceDto } from '../dto/prepare-clean-workspace.dto';
import { PushOptionsDto } from '../dto/push-options.dto';
import { RebaseDto } from '../dto/rebase.dto';
import { ResolveConflictDto } from '../dto/resolve-conflict.dto';
import { StageFilesDto } from '../dto/stage-files.dto';
import { UnstageFilesDto } from '../dto/unstage-files.dto';
import { AgentsVcsService } from '../services/agents-vcs.service';

/**
 * Controller for agent VCS (Version Control System) operations.
 * Provides endpoints for git operations in agent containers.
 */
@Controller('agents/:agentId/vcs')
export class AgentsVcsController {
  constructor(private readonly agentsVcsService: AgentsVcsService) {}

  /**
   * Get git status for the agent's repository.
   * @param agentId - The UUID of the agent
   * @returns Git status information
   */
  @Get('status')
  async getStatus(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<GitStatusDto> {
    return await this.agentsVcsService.getStatus(agentId);
  }

  /**
   * List all branches (local and remote).
   * @param agentId - The UUID of the agent
   * @returns Array of branch information
   */
  @Get('branches')
  async getBranches(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<GitBranchDto[]> {
    return await this.agentsVcsService.getBranches(agentId);
  }

  /**
   * Get diff for a specific file.
   * @param agentId - The UUID of the agent
   * @param filePath - The file path relative to repository root
   * @returns File diff information
   */
  @Get('diff')
  async getFileDiff(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') filePath: string,
  ): Promise<GitDiffDto> {
    if (!filePath) {
      throw new Error('File path is required');
    }

    return await this.agentsVcsService.getFileDiff(agentId, filePath);
  }

  /**
   * Stage files.
   * @param agentId - The UUID of the agent
   * @param stageFilesDto - Files to stage (empty array stages all)
   */
  @Post('stage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stageFiles(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() stageFilesDto: StageFilesDto,
  ): Promise<void> {
    await this.agentsVcsService.stageFiles(agentId, stageFilesDto.files || []);
  }

  /**
   * Unstage files.
   * @param agentId - The UUID of the agent
   * @param unstageFilesDto - Files to unstage (empty array unstages all)
   */
  @Post('unstage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unstageFiles(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() unstageFilesDto: UnstageFilesDto,
  ): Promise<void> {
    await this.agentsVcsService.unstageFiles(agentId, unstageFilesDto.files || []);
  }

  /**
   * Commit staged changes.
   * @param agentId - The UUID of the agent
   * @param commitDto - Commit message
   */
  @Post('commit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async commit(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() commitDto: CommitDto,
  ): Promise<void> {
    await this.agentsVcsService.commit(agentId, commitDto.message);
  }

  /**
   * Push changes to remote.
   * @param agentId - The UUID of the agent
   */
  @Post('push')
  @HttpCode(HttpStatus.NO_CONTENT)
  async push(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() pushOptions: PushOptionsDto = {},
  ): Promise<void> {
    await this.agentsVcsService.push(agentId, pushOptions.force ?? false);
  }

  /**
   * Pull changes from remote.
   * @param agentId - The UUID of the agent
   */
  @Post('pull')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pull(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<void> {
    await this.agentsVcsService.pull(agentId);
  }

  /**
   * Fetch changes from remote.
   * @param agentId - The UUID of the agent
   */
  @Post('fetch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async fetch(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<void> {
    await this.agentsVcsService.fetch(agentId);
  }

  /**
   * Reset working tree to match upstream default branch (fetch, reset --hard, clean).
   */
  @Post('workspace/prepare-clean')
  @HttpCode(HttpStatus.NO_CONTENT)
  async prepareCleanWorkspace(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: PrepareCleanWorkspaceDto,
  ): Promise<void> {
    await this.agentsVcsService.prepareCleanWorkspace(agentId, body.baseBranch);
  }

  /**
   * Rebase current branch onto another branch.
   * @param agentId - The UUID of the agent
   * @param rebaseDto - Branch to rebase onto
   */
  @Post('rebase')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rebase(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() rebaseDto: RebaseDto,
  ): Promise<void> {
    await this.agentsVcsService.rebase(agentId, rebaseDto.branch);
  }

  /**
   * Switch to a different branch.
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to switch to
   */
  @Post('branches/:branch/switch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchBranch(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('branch') branch: string,
  ): Promise<void> {
    await this.agentsVcsService.switchBranch(agentId, branch);
  }

  /**
   * Create a new branch.
   * @param agentId - The UUID of the agent
   * @param createBranchDto - Branch creation data
   */
  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createBranchDto: CreateBranchDto,
  ): Promise<void> {
    await this.agentsVcsService.createBranch(agentId, createBranchDto);
  }

  /**
   * Delete a branch.
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to delete
   */
  @Delete('branches/:branch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBranch(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('branch') branch: string,
  ): Promise<void> {
    await this.agentsVcsService.deleteBranch(agentId, branch);
  }

  /**
   * Resolve a merge conflict.
   * @param agentId - The UUID of the agent
   * @param resolveConflictDto - Conflict resolution data
   */
  @Post('conflicts/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resolveConflict(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() resolveConflictDto: ResolveConflictDto,
  ): Promise<void> {
    await this.agentsVcsService.resolveConflict(agentId, resolveConflictDto);
  }
}
