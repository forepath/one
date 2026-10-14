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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { CreateFileDto } from '../dto/create-file.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentFileSystemService } from '../services/agent-file-system.service';

/**
 * Trusted system file channel for agent containers (agent-controller only).
 *
 * Used by the agent-controller to materialize OpenCode layer files and context attachments, which may
 * live outside the agent workspace (e.g. `~/.config/opencode`, `/opt/agenstra/context`). Paths outside
 * the workspace are written as root and hardened read-only for the agent runtime user.
 *
 * The agent-controller never forwards end-user file requests here — user file access goes through
 * `agents/:agentId/files`, which is confined to the agent workspace.
 */
@Controller('agents/:agentId/system-files')
export class AgentsSystemFilesController {
  constructor(private readonly agentFileSystemService: AgentFileSystemService) {}

  /**
   * List directory contents (absolute system paths or workspace-relative paths).
   */
  @Get()
  async listDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') path?: string,
    @Query('refresh') refresh?: string,
  ): Promise<FileNodeDto[]> {
    return await this.agentFileSystemService.listSystemDirectory(agentId, path || '.', refresh === 'true');
  }

  /**
   * Write file content from a raw body Buffer (single request, max 10MB).
   */
  @Put('*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async writeFile(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Req() req: Request,
  ): Promise<void> {
    const normalizedPath = this.normalizeRequiredPath(path);

    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Expected raw binary body');
    }

    await this.agentFileSystemService.writeSystemFile(agentId, normalizedPath, req.body);
  }

  /**
   * Create an empty file or directory.
   */
  @Post('*path')
  @HttpCode(HttpStatus.CREATED)
  async createFileOrDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() createFileDto: CreateFileDto,
  ): Promise<void> {
    const normalizedPath = this.normalizeRequiredPath(path);

    await this.agentFileSystemService.createSystemFileOrDirectory(agentId, normalizedPath, createFileDto.type);
  }

  /**
   * Delete a file or directory.
   */
  @Delete('*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFileOrDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
  ): Promise<void> {
    const normalizedPath = this.normalizeRequiredPath(path);

    await this.agentFileSystemService.deleteSystemFileOrDirectory(agentId, normalizedPath);
  }

  private normalizeRequiredPath(path: string | string[] | Record<string, unknown> | undefined): string {
    let normalizedPath: string | undefined;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      throw new BadRequestException('File path must be a string or array, got object');
    }

    if (!normalizedPath) {
      throw new BadRequestException('File path is required');
    }

    return normalizedPath;
  }
}
