import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CreateFileDto } from '../dto/create-file.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { MoveFileDto } from '../dto/move-file.dto';
import { AgentFileSystemService } from '../services/agent-file-system.service';
import { parseAgentFileManagerContext } from '../utils/agent-file-manager-context';
import { contentDispositionAttachment, parseContentRangeHeader, parseRangeHeader } from '../utils/agent-file-type';

/**
 * Controller for agent file system operations.
 * Provides endpoints for reading, writing, listing, creating, deleting, and moving files in agent containers.
 */
@Controller('agents/:agentId/files')
export class AgentsFilesController {
  constructor(private readonly agentFileSystemService: AgentFileSystemService) {}

  /**
   * Probe file metadata (type, content-type, size) without transferring the body.
   */
  @Head('*path')
  @HttpCode(HttpStatus.OK)
  async headFile(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('context') contextRaw?: string,
  ): Promise<void> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeRequiredPath(path);
    const result = await this.agentFileSystemService.probeFile(agentId, normalizedPath, context);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-File-Type', result.fileType);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.size));
  }

  /**
   * Read file content from agent container as a binary stream.
   * Supports Range requests (206) and optional download disposition.
   */
  @Get('*path')
  async readFile(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
    @Headers('range') rangeHeader?: string,
    @Query('context') contextRaw?: string,
    @Query('download') download?: string,
  ): Promise<StreamableFile> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeOptionalListPath(path);
    const result = await this.agentFileSystemService.readFile(agentId, normalizedPath, context);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-File-Type', result.fileType);
    res.setHeader('Content-Type', result.contentType);

    if (download === 'true') {
      res.setHeader('Content-Disposition', contentDispositionAttachment(normalizedPath));
    }

    const range = parseRangeHeader(rangeHeader, result.size);

    if (range === 'unsatisfiable') {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${result.size}`);

      return new StreamableFile(Buffer.alloc(0));
    }

    if (range) {
      const chunk = result.buffer.subarray(range.start, range.end + 1);

      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${result.size}`);
      res.setHeader('Content-Length', String(chunk.length));

      return new StreamableFile(chunk);
    }

    res.setHeader('Content-Length', String(result.size));

    return new StreamableFile(result.buffer);
  }

  /**
   * Write file content to agent container from a raw body Buffer.
   * Optional Content-Range + X-Upload-Id enable chunked uploads.
   */
  @Put('*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async writeFile(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Req() req: Request,
    @Query('context') contextRaw?: string,
    @Headers('content-range') contentRangeHeader?: string,
    @Headers('x-upload-id') uploadId?: string,
    @Headers('x-file-type') _fileType?: string,
  ): Promise<void> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeRequiredPath(path);

    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Expected raw binary body');
    }

    const buffer: Buffer = req.body;
    const contentRange = parseContentRangeHeader(contentRangeHeader);

    if (contentRange) {
      await this.agentFileSystemService.writeFileChunk(
        agentId,
        normalizedPath,
        buffer,
        contentRange,
        uploadId,
        context,
      );

      return;
    }

    await this.agentFileSystemService.writeFile(agentId, normalizedPath, buffer, context);
  }

  /**
   * List directory contents in agent container.
   * @param agentId - The UUID of the agent
   * @param path - Optional directory path (defaults to '.')
   * @returns Array of file nodes
   */
  @Get()
  async listDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') path?: string,
    @Query('context') contextRaw?: string,
  ): Promise<FileNodeDto[]> {
    const context = parseAgentFileManagerContext(contextRaw);

    return await this.agentFileSystemService.listDirectory(agentId, path || '.', context);
  }

  /**
   * Create an empty file or directory in agent container.
   * Write content separately via PUT raw bytes.
   */
  @Post('*path')
  @HttpCode(HttpStatus.CREATED)
  async createFileOrDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() createFileDto: CreateFileDto,
    @Query('context') contextRaw?: string,
  ): Promise<void> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeRequiredPath(path);

    await this.agentFileSystemService.createFileOrDirectory(agentId, normalizedPath, createFileDto.type, context);
  }

  /**
   * Delete a file or directory from agent container.
   * @param agentId - The UUID of the agent
   * @param path - The file path (wildcard parameter for nested paths)
   */
  @Delete('*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFileOrDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Query('context') contextRaw?: string,
  ): Promise<void> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeRequiredPath(path);

    await this.agentFileSystemService.deleteFileOrDirectory(agentId, normalizedPath, context);
  }

  /**
   * Move a file or directory in agent container.
   * @param agentId - The UUID of the agent
   * @param path - The source file path (wildcard parameter for nested paths)
   * @param moveFileDto - The move operation data (destination path)
   */
  @Patch('*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async moveFileOrDirectory(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() moveFileDto: MoveFileDto,
    @Query('context') contextRaw?: string,
  ): Promise<void> {
    const context = parseAgentFileManagerContext(contextRaw);
    const normalizedPath = this.normalizeRequiredPath(path);

    if (!moveFileDto.destination) {
      throw new BadRequestException('Destination path is required');
    }

    await this.agentFileSystemService.moveFileOrDirectory(agentId, normalizedPath, moveFileDto.destination, context);
  }

  private normalizeOptionalListPath(path: string | string[] | Record<string, unknown> | undefined): string {
    if (typeof path === 'string') {
      return path;
    }

    if (Array.isArray(path)) {
      return path.join('/');
    }

    return '.';
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
