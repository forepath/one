import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AgentFileProbeResult, AgentFileReadResult } from '../dto/agent-file-read-result';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import type { AgentFileManagerContext } from '../utils/agent-file-manager-context';
import { classifyAgentFile } from '../utils/agent-file-type';
import { expandProviderPathTildeInContainer } from '../utils/provider-container-path.utils';

import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';

/** Inclusive byte range for a chunked upload (Content-Range semantics). */
export interface AgentFileChunkRange {
  start: number;
  end: number;
  total: number;
}

interface UploadStagingEntry {
  total: number;
  nextOffset: number;
  chunks: Buffer[];
  updatedAt: number;
}

/**
 * Service for agent file system operations.
 * Provides read, write, list, create, and delete operations on agent container files.
 */
@Injectable()
export class AgentFileSystemService {
  private readonly logger = new Logger(AgentFileSystemService.name);
  /** Per-request / per-chunk size cap (10MB). */
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  /** Maximum assembled size for chunked uploads (100MB). */
  private readonly MAX_ASSEMBLED_FILE_SIZE = 100 * 1024 * 1024;
  private readonly DEFAULT_BASE_PATH = '/app';
  private static readonly CONFIG_NOT_SUPPORTED = 'Agent provider does not support agent-wide configuration file access';
  private static readonly UPLOAD_TTL_MS = 30 * 60 * 1000;
  private readonly uploadStaging = new Map<string, UploadStagingEntry>();

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
    private readonly workspaceChangeNotifier: WorkspaceChangeNotifierService,
  ) {}

  private notifyGitStateMayHaveChanged(agentId: string): void {
    this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentId);
  }

  private notifyWorkspacePathChange(
    agentId: string,
    path: string,
    op: 'upsert' | 'delete',
    reason: string,
    context: AgentFileManagerContext = 'app',
  ): void {
    if (context !== 'app') {
      return;
    }

    this.workspaceChangeNotifier.notifyPathChanges(agentId, [{ path, op }], reason);
  }

  /**
   * Sanitize and validate a file path to prevent directory traversal attacks.
   * @param path - The file path to sanitize
   * @returns The sanitized path
   * @throws BadRequestException if path contains invalid characters or traversal attempts
   */
  private sanitizePath(path: string): string {
    // Validate that path is a string
    if (typeof path !== 'string') {
      throw new BadRequestException(`Path must be a string, got ${typeof path}`);
    }

    if (!path || path.trim().length === 0) {
      throw new BadRequestException('Path cannot be empty');
    }

    // Remove leading slashes and normalize
    const normalized = path.replace(/^\/+/, '').trim();

    // Check for directory traversal attempts
    if (normalized.includes('..') || normalized.includes('../')) {
      throw new BadRequestException('Path traversal is not allowed');
    }

    // Check for null bytes
    if (normalized.includes('\0')) {
      throw new BadRequestException('Path cannot contain null bytes');
    }

    return normalized;
  }

  /**
   * Get the base path for an agent based on its provider.
   * Falls back to the default '/app' if the provider doesn't specify one.
   * @param agentType - The agent type identifier
   * @returns The base path string
   */
  private getBasePath(agentType: string): string {
    try {
      const provider = this.agentProviderFactory.getProvider(agentType);

      if (provider.getBasePath) {
        const basePath = provider.getBasePath();

        if (basePath) {
          return basePath;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to get provider for agent type '${agentType}', using default base path: ${error}`);
    }

    return this.DEFAULT_BASE_PATH;
  }

  /**
   * Expand leading `~` in a provider path using the container user's HOME.
   */
  private async expandTildeInProviderPath(providerPath: string, containerId: string): Promise<string> {
    return expandProviderPathTildeInContainer(providerPath, containerId, (id) =>
      this.dockerService.getContainerHomeDirectory(id),
    );
  }

  /**
   * Resolve absolute filesystem root inside the container for the given context.
   */
  private async resolveFilesystemRoot(
    agentType: string,
    context: AgentFileManagerContext,
    containerId: string,
  ): Promise<string> {
    if (context === 'app') {
      return this.getBasePath(agentType);
    }

    try {
      const provider = this.agentProviderFactory.getProvider(agentType);

      if (!provider.getConfigBasePath) {
        throw new BadRequestException(AgentFileSystemService.CONFIG_NOT_SUPPORTED);
      }

      const raw = provider.getConfigBasePath();

      if (!raw?.trim()) {
        throw new BadRequestException(AgentFileSystemService.CONFIG_NOT_SUPPORTED);
      }

      return await this.expandTildeInProviderPath(raw.trim(), containerId);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn(`Failed to resolve config base for agent type '${agentType}': ${error}`);
      throw new BadRequestException(AgentFileSystemService.CONFIG_NOT_SUPPORTED);
    }
  }

  /**
   * Build the full container path from a relative path and context root.
   */
  private async buildContainerPath(
    relativePath: string,
    agentType: string,
    context: AgentFileManagerContext,
    containerId: string,
  ): Promise<string> {
    const sanitized = this.sanitizePath(relativePath);
    const root = (await this.resolveFilesystemRoot(agentType, context, containerId)).replace(/\/+$/, '');

    return `${root}/${sanitized}`;
  }

  /**
   * Read file content from agent container.
   * Uses docker cp to copy the file to a temporary location, then returns raw bytes + classification.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file (from the provider's base path, defaults to /app)
   * @param context - `app` (workspace) or `config` (provider config directory)
   * @returns Raw buffer, file type, content type, and size
   * @throws NotFoundException if agent or file is not found
   * @throws BadRequestException if path is invalid or file exceeds MAX_ASSEMBLED_FILE_SIZE
   */
  async readFile(
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<AgentFileReadResult> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      filePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );
    let tempFilePath: string | null = null;

    try {
      // Create a temporary file path
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-file-read-'));
      const fileName = path.basename(filePath) || 'file';

      tempFilePath = path.join(tempDir, fileName);

      // Copy file from container to temporary location using docker cp
      await this.dockerService.copyFileFromContainer(agentEntity.containerId, containerPath, tempFilePath);

      // Check if file exists
      if (!fs.existsSync(tempFilePath)) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      // Align with chunked upload ceiling so downloaded assemblies remain readable.
      const stats = fs.statSync(tempFilePath);

      if (stats.size > this.MAX_ASSEMBLED_FILE_SIZE) {
        throw new BadRequestException(
          `File size exceeds maximum allowed size of ${this.MAX_ASSEMBLED_FILE_SIZE} bytes`,
        );
      }

      const fileBuffer = fs.readFileSync(tempFilePath);
      const classified = classifyAgentFile(filePath, fileBuffer);

      this.logger.debug(`File ${filePath} classified as ${classified.fileType} (${stats.size} bytes)`);

      return {
        buffer: fileBuffer,
        fileType: classified.fileType,
        contentType: classified.contentType,
        size: stats.size,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const err = error as { message?: string };

      if (err.message?.includes('No such file') || err.message?.includes('not found')) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      this.logger.error(`Error reading file ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    } finally {
      // Clean up temporary file and directory
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          const tempDir = path.dirname(tempFilePath);

          fs.unlinkSync(tempFilePath);

          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (cleanupError: unknown) {
          const cleanupErr = cleanupError as { message?: string };

          this.logger.warn(`Failed to clean up temporary file ${tempFilePath}: ${cleanupErr.message}`);
        }
      }
    }
  }

  /**
   * Probe file metadata without transferring the full body.
   * Uses separate `stat` + peek commands (avoids fragile `$()` / demux-sensitive markers).
   */
  async probeFile(
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<AgentFileProbeResult> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      filePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );
    const escapedPath = this.escapeForShell(containerPath);
    const peekBytes = 8192;

    try {
      const existsOutput = await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `sh -c "test -f ${escapedPath} && echo EXISTS || echo NOTFOUND"`,
      );

      if (existsOutput.includes('NOTFOUND') || !existsOutput.includes('EXISTS')) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      // Small stdout only — parse first integer (docker demux can inject stray chars).
      const sizeRaw = await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `stat -c %s -- ${escapedPath}`,
      );
      const sizeMatch = /(\d+)/.exec(sizeRaw);

      if (!sizeMatch) {
        throw new BadRequestException(`Unable to probe file metadata for: ${filePath}`);
      }

      const size = Number(sizeMatch[1]);
      const peekRaw = await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `sh -c "head -c ${peekBytes} -- ${escapedPath} | base64 -w 0"`,
      );
      // Strip demux junk; keep only base64 alphabet.
      const peekBase64 = peekRaw.replace(/[^A-Za-z0-9+/=]/g, '');
      const peekBuffer = peekBase64 ? Buffer.from(peekBase64, 'base64') : Buffer.alloc(0);
      const classified = classifyAgentFile(filePath, peekBuffer);

      this.logger.debug(`Probed ${filePath} as ${classified.fileType} (${size} bytes)`);

      return {
        fileType: classified.fileType,
        contentType: classified.contentType,
        size,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const err = error as { message?: string };

      if (
        err.message?.includes('No such file') ||
        err.message?.includes('not found') ||
        err.message?.includes('NOTFOUND')
      ) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      this.logger.error(`Error probing file ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Sanitize string by removing invalid filesystem characters.
   * Keeps common filename characters including spaces and parentheses (e.g. "Copy (1).txt").
   * Strips control characters and the pipe delimiter used by listDirectory parsing.
   * @param str - The string to sanitize
   * @returns Sanitized string
   */
  private sanitizeFilesystemString(str: string): string {
    if (!str || typeof str !== 'string') {
      return '';
    }

    // Allow letters, numbers, and common filename punctuation; strip control chars and '|'
    return str.replace(/[^a-zA-Z0-9.\-_/ ()[\]{}+#@&=,~'!]/g, '').trim();
  }

  /**
   * Characters allowed in listDirectory shell/Docker output before parsing.
   * Same as sanitizeFilesystemString plus pipe (field separator) and newlines.
   */
  private static readonly LIST_OUTPUT_ALLOWED = /[^a-zA-Z0-9.\-_/ ()[\]{}+#@&=,~'!|\n]/g;

  /**
   * Write raw file bytes to agent container (single request, max MAX_FILE_SIZE).
   * Internally pipes base64 over the docker shell channel (base64 -d).
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file
   * @param buffer - Raw file bytes
   * @param context - `app` or `config`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or content is too large
   */
  async writeFile(
    agentId: string,
    filePath: string,
    buffer: Buffer,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    if (!Buffer.isBuffer(buffer)) {
      throw new BadRequestException('File content must be a Buffer');
    }

    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File content size exceeds maximum allowed size of ${this.MAX_FILE_SIZE} bytes`);
    }

    await this.writeBufferToContainer(agentId, filePath, buffer, context);
  }

  /**
   * Accept a sequential chunk of a multi-part upload and finalize when complete.
   * Chunks must start at offset 0 and arrive in order (next start === previous end + 1).
   */
  async writeFileChunk(
    agentId: string,
    filePath: string,
    buffer: Buffer,
    range: AgentFileChunkRange,
    uploadId?: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    if (!Buffer.isBuffer(buffer)) {
      throw new BadRequestException('File content must be a Buffer');
    }

    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`Chunk size exceeds maximum allowed size of ${this.MAX_FILE_SIZE} bytes`);
    }

    const expectedLength = range.end - range.start + 1;

    if (buffer.length !== expectedLength) {
      throw new BadRequestException(
        `Chunk length ${buffer.length} does not match Content-Range span ${expectedLength}`,
      );
    }

    if (range.total > this.MAX_ASSEMBLED_FILE_SIZE) {
      throw new BadRequestException(
        `Assembled file size exceeds maximum allowed size of ${this.MAX_ASSEMBLED_FILE_SIZE} bytes`,
      );
    }

    this.cleanupExpiredUploads();

    const stagingKey = this.uploadStagingKey(agentId, filePath, uploadId);
    let staging = this.uploadStaging.get(stagingKey);

    if (range.start === 0) {
      staging = {
        total: range.total,
        nextOffset: 0,
        chunks: [],
        updatedAt: Date.now(),
      };
      this.uploadStaging.set(stagingKey, staging);
    }

    if (!staging) {
      throw new BadRequestException('Upload not started; first chunk must begin at byte 0');
    }

    if (range.total !== staging.total) {
      this.uploadStaging.delete(stagingKey);
      throw new BadRequestException('Content-Range total does not match ongoing upload');
    }

    if (range.start !== staging.nextOffset) {
      throw new BadRequestException(
        `Chunks must be sequential; expected start ${staging.nextOffset}, got ${range.start}`,
      );
    }

    staging.chunks.push(buffer);
    staging.nextOffset = range.end + 1;
    staging.updatedAt = Date.now();

    if (range.end !== range.total - 1) {
      return;
    }

    const assembled = Buffer.concat(staging.chunks, staging.total);

    this.uploadStaging.delete(stagingKey);

    if (assembled.length !== staging.total) {
      throw new BadRequestException(
        `Assembled size ${assembled.length} does not match declared total ${staging.total}`,
      );
    }

    if (assembled.length > this.MAX_ASSEMBLED_FILE_SIZE) {
      throw new BadRequestException(
        `Assembled file size exceeds maximum allowed size of ${this.MAX_ASSEMBLED_FILE_SIZE} bytes`,
      );
    }

    await this.writeBufferToContainer(agentId, filePath, assembled, context);
  }

  private uploadStagingKey(agentId: string, filePath: string, uploadId?: string): string {
    return `${agentId}:${filePath}:${uploadId ?? 'default'}`;
  }

  private cleanupExpiredUploads(): void {
    const now = Date.now();

    for (const [key, entry] of this.uploadStaging.entries()) {
      if (now - entry.updatedAt > AgentFileSystemService.UPLOAD_TTL_MS) {
        this.uploadStaging.delete(key);
      }
    }
  }

  /**
   * Write buffer to container via base64 decode on stdin (internal transport only).
   */
  private async writeBufferToContainer(
    agentId: string,
    filePath: string,
    buffer: Buffer,
    context: AgentFileManagerContext,
  ): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      filePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );

    try {
      const escapedPath = this.escapeForShell(containerPath);
      const base64Wire = buffer.toString('base64');

      await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `sh -c "base64 -d > ${escapedPath}"`,
        base64Wire,
      );

      this.logger.debug(`File written: ${filePath} for agent ${agentId} (${buffer.length} bytes)`);
      this.notifyGitStateMayHaveChanged(agentId);
      this.notifyWorkspacePathChange(agentId, filePath, 'upsert', 'write', context);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error writing file ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * List directory contents in agent container.
   * @param agentId - The UUID of the agent
   * @param directoryPath - The relative path to the directory (from the provider's base path, defaults to /app), defaults to '.'
   * @returns Array of file nodes
   * @param context - `app` or `config`
   * @throws NotFoundException if agent or directory is not found
   * @throws BadRequestException if path is invalid
   */
  async listDirectory(
    agentId: string,
    directoryPath = '.',
    context: AgentFileManagerContext = 'app',
  ): Promise<FileNodeDto[]> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      directoryPath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );

    try {
      // Use a simpler approach: ls to list, then process with find for each item
      // This avoids the complex while loop that might fail silently
      const escapedPath = this.escapeForShell(containerPath);
      // Get list of items using ls -1 (one per line)
      const listCommand = `sh -c "ls -a -1 ${escapedPath} 2>/dev/null"`;
      let output = await this.dockerService.sendCommandToContainer(agentEntity.containerId, listCommand);

      // Remove invalid characters that might come from Docker protocol parsing
      output = output.replace(AgentFileSystemService.LIST_OUTPUT_ALLOWED, '').trim();

      this.logger.debug(`List directory output for ${containerPath}: ${output.substring(0, 200)}`);

      const nodes: FileNodeDto[] = [];
      const items = output
        .split('\n')
        .filter((item) => item.trim().length > 0 && item.trim() !== '.' && item.trim() !== '..')
        .map((item) => this.sanitizeFilesystemString(item))
        .filter((item) => item.length > 0);

      // If no items found, return empty array
      if (items.length === 0) {
        this.logger.debug(`No items found in ${containerPath}`);

        return [];
      }

      // Quote $item when joining to the directory path so names with spaces resolve.
      // Without quotes, `fullpath='/app'/$item` word-splits on spaces and stat fails → entry skipped.
      const escapedItems = items.map((item) => this.escapeForShell(item)).join(' ');
      const processCommand = `sh -c "for item in ${escapedItems}; do
        fullpath=${escapedPath}/\\"\\$item\\"
        if [ -d \\"\\$fullpath\\" ]; then
          echo \\"directory|\\$item|0|\\$(stat -c %Y \\"\\$fullpath\\" 2>/dev/null || echo 0)\\"
        else
          echo \\"file|\\$item|\\$(stat -c %s \\"\\$fullpath\\" 2>/dev/null || echo 0)|\\$(stat -c %Y \\"\\$fullpath\\" 2>/dev/null || echo 0)\\"
        fi
      done"`;
      let processOutput = await this.dockerService.sendCommandToContainer(agentEntity.containerId, processCommand);

      // Remove invalid characters that might come from Docker protocol parsing
      // Keep pipe separator (|) for parsing, newlines, and valid filename characters
      processOutput = processOutput.replace(AgentFileSystemService.LIST_OUTPUT_ALLOWED, '').trim();

      this.logger.debug(`Process output: ${processOutput.substring(0, 200)}`);

      const lines = processOutput.split('\n').filter((line) => line.trim().length > 0);

      this.logger.debug(`Parsing ${lines.length} lines from process output`);

      for (const line of lines) {
        // Filter out lines that don't match our expected format (type|name|size|modified)
        // Remove any shell artifacts or invalid characters from the line (but keep the pipe separators)
        // We need to be careful - only remove shell artifacts that aren't part of the data
        const cleanedLine = line.trim();
        const parts = cleanedLine.split('|');

        if (parts.length >= 2) {
          // Sanitize type and name, but be less aggressive - only remove truly invalid characters
          const rawType = parts[0].trim();
          const rawName = parts[1].trim();
          // Normalize type: extract "file" or "directory" from rawType, handling cases like "1file" or "directory"
          // This handles shell artifacts or prefixes that might appear before the actual type
          let type: 'file' | 'directory' | null = null;
          const normalizedRawType = rawType.toLowerCase();

          if (normalizedRawType.includes('directory')) {
            type = 'directory';
          } else if (normalizedRawType.includes('file')) {
            type = 'file';
          }

          const name = this.sanitizeFilesystemString(rawName);

          // Skip if type or name is invalid after sanitization
          if (!type || !name) {
            this.logger.warn(
              `Skipping invalid entry: rawType=${rawType}, rawName=${rawName}, type=${type}, name=${name}`,
            );
            continue;
          }

          const size = parts[2] ? parseInt(parts[2].trim(), 10) : undefined;
          const modifiedTimestamp = parts[3] ? parseInt(parts[3].trim(), 10) : undefined;

          // Skip entries where stat failed (timestamp is 0 or invalid) - indicates file doesn't exist
          // This filters out phantom entries that appear in ls output but don't actually exist
          // The stat command returns 0 when the file doesn't exist (due to the || echo 0 fallback)
          if (!modifiedTimestamp || modifiedTimestamp <= 0) {
            this.logger.debug(
              `Skipping non-existent entry: name=${name}, type=${type}, size=${size}, modified=${modifiedTimestamp}`,
            );
            continue;
          }

          // Build relative path (sanitize the directory path as well)
          const sanitizedDirPath = directoryPath === '.' ? '' : this.sanitizeFilesystemString(directoryPath);
          const relativePath = sanitizedDirPath ? `${sanitizedDirPath}/${name}` : name;

          nodes.push({
            name,
            type,
            path: relativePath,
            size: type === 'file' ? size : undefined,
            modifiedAt: new Date(modifiedTimestamp * 1000),
          });
        }
      }

      // Sort: directories first, then files, both alphabetically
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });

      return nodes;
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (err.message?.includes('No such file') || err.message?.includes('not found')) {
        throw new NotFoundException(`Directory not found: ${directoryPath}`);
      }

      this.logger.error(`Error listing directory ${directoryPath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Create an empty file or directory in agent container.
   * Write content separately via PUT raw bytes.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to create (from the provider's base path, defaults to /app)
   * @param type - The type to create ('file' or 'directory')
   * @param context - `app` or `config`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or file already exists
   */
  async createFileOrDirectory(
    agentId: string,
    filePath: string,
    type: 'file' | 'directory',
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      filePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );

    try {
      if (type === 'directory') {
        await this.dockerService.sendCommandToContainer(
          agentEntity.containerId,
          `mkdir -p ${this.escapeForShell(containerPath)}`,
        );
      } else {
        await this.dockerService.sendCommandToContainer(
          agentEntity.containerId,
          `touch ${this.escapeForShell(containerPath)}`,
        );
      }

      this.logger.debug(`Created ${type}: ${filePath} for agent ${agentId}`);
      this.notifyGitStateMayHaveChanged(agentId);
      this.notifyWorkspacePathChange(agentId, filePath, 'upsert', 'create', context);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error creating ${type} ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Delete a file or directory from agent container.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to delete (from the provider's base path, defaults to /app)
   * @param context - `app` or `config`
   * @throws NotFoundException if agent or file is not found
   * @throws BadRequestException if path is invalid
   */
  async deleteFileOrDirectory(
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerPath = await this.buildContainerPath(
      filePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );

    try {
      // Use rm -rf to delete file or directory
      await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `rm -rf ${this.escapeForShell(containerPath)}`,
      );

      this.logger.debug(`Deleted: ${filePath} for agent ${agentId}`);
      this.notifyGitStateMayHaveChanged(agentId);
      this.notifyWorkspacePathChange(agentId, filePath, 'delete', 'delete', context);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (err.message?.includes('No such file') || err.message?.includes('not found')) {
        throw new NotFoundException(`File or directory not found: ${filePath}`);
      }

      this.logger.error(`Error deleting ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Move a file or directory in agent container.
   * @param agentId - The UUID of the agent
   * @param sourcePath - The relative path to the source file/directory (from the provider's base path, defaults to /app)
   * @param destinationPath - The relative path to the destination (from the provider's base path, defaults to /app)
   * @param context - `app` or `config`
   * @throws NotFoundException if agent, source file, or destination directory is not found
   * @throws BadRequestException if paths are invalid
   */
  async moveFileOrDirectory(
    agentId: string,
    sourcePath: string,
    destinationPath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const sourceContainerPath = await this.buildContainerPath(
      sourcePath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );
    const destinationContainerPath = await this.buildContainerPath(
      destinationPath,
      agentEntity.agentType,
      context,
      agentEntity.containerId,
    );

    try {
      // Use mv command to move file or directory
      await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `mv ${this.escapeForShell(sourceContainerPath)} ${this.escapeForShell(destinationContainerPath)}`,
      );

      this.logger.debug(`Moved: ${sourcePath} to ${destinationPath} for agent ${agentId}`);
      this.notifyGitStateMayHaveChanged(agentId);
      this.notifyWorkspacePathChange(agentId, sourcePath, 'delete', 'move', context);
      this.notifyWorkspacePathChange(agentId, destinationPath, 'upsert', 'move', context);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (err.message?.includes('No such file') || err.message?.includes('not found')) {
        throw new NotFoundException(`Source file or directory not found: ${sourcePath}`);
      }

      this.logger.error(`Error moving ${sourcePath} to ${destinationPath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Escape a string for safe shell usage.
   * @param str - The string to escape
   * @returns The escaped string safe for shell usage
   */
  private escapeForShell(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}
