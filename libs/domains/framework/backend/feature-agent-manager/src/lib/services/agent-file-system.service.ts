import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { FileContentDto } from '../dto/file-content.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import type { AgentFileManagerContext } from '../utils/agent-file-manager-context';
import { expandProviderPathTildeInContainer } from '../utils/provider-container-path.utils';

import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { DockerService } from './docker.service';

/**
 * Service for agent file system operations.
 * Provides read, write, list, create, and delete operations on agent container files.
 */
@Injectable()
export class AgentFileSystemService {
  private readonly logger = new Logger(AgentFileSystemService.name);
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly DEFAULT_BASE_PATH = '/app';
  private static readonly CONFIG_NOT_SUPPORTED = 'Agent provider does not support agent-wide configuration file access';

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
  ) {}

  private notifyGitStateMayHaveChanged(agentId: string): void {
    this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentId);
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
   * Uses docker cp to copy the file to a temporary location, then reads it as base64.
   * This approach avoids corruption issues that can occur with shell commands, especially for binary files.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file (from the provider's base path, defaults to /app)
   * @param context - `app` (workspace) or `config` (provider config directory)
   * @returns File content (base64-encoded) and encoding type
   * @throws NotFoundException if agent or file is not found
   * @throws BadRequestException if path is invalid or file is too large
   */
  async readFile(agentId: string, filePath: string, context: AgentFileManagerContext = 'app'): Promise<FileContentDto> {
    await this.agentsRepository.findByIdOrThrow(agentId);
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

      // Get file stats to check size
      const stats = fs.statSync(tempFilePath);

      if (stats.size > this.MAX_FILE_SIZE) {
        throw new BadRequestException(`File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE} bytes`);
      }

      // Read file as binary buffer
      const fileBuffer = fs.readFileSync(tempFilePath);
      // Encode to base64
      const base64Content = fileBuffer.toString('base64');
      // Try to determine if it's text by attempting to decode as UTF-8
      // If it decodes successfully and has reasonable text content, mark as utf-8
      let encoding: 'utf-8' | 'base64' = 'base64';

      try {
        const textContent = fileBuffer.toString('utf-8');
        // Check if it's likely text: low percentage of control characters (excluding common whitespace)
        const sampleSize = Math.min(512, textContent.length);

        if (sampleSize > 0) {
          const sample = textContent.substring(0, sampleSize);
          let controlCharCount = 0;

          for (let i = 0; i < sample.length; i++) {
            const charCode = sample.charCodeAt(i);

            // Count control characters (excluding common whitespace: tab, LF, CR)
            if (
              (charCode >= 0 && charCode <= 8) || // Null, bell, backspace, etc.
              charCode === 11 || // Vertical tab
              charCode === 12 || // Form feed
              (charCode >= 14 && charCode <= 31) || // Other control chars (excluding CR/LF)
              (charCode >= 127 && charCode <= 159) // DEL and C1 control chars
            ) {
              controlCharCount++;
            }
          }

          // If less than 10% are control characters, it's likely text
          const controlCharThreshold = 0.1;

          if (controlCharCount / sampleSize <= controlCharThreshold) {
            encoding = 'utf-8';
            this.logger.debug(`File ${filePath} detected as text (${stats.size} bytes)`);
          } else {
            this.logger.debug(
              `File ${filePath} detected as binary (${stats.size} bytes, ${((controlCharCount / sampleSize) * 100).toFixed(1)}% control chars)`,
            );
          }
        }
      } catch {
        // If UTF-8 decoding fails, it's definitely binary
        encoding = 'base64';
        this.logger.debug(`File ${filePath} detected as binary (${stats.size} bytes, UTF-8 decode failed)`);
      }

      return {
        content: base64Content,
        encoding,
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
   * Sanitize string by removing invalid filesystem characters.
   * Keeps only valid characters: letters, numbers, dots, dashes, underscores, slashes, and spaces.
   * Used for file names, directory names, paths, and other filesystem-related strings.
   * @param str - The string to sanitize
   * @returns Sanitized string
   */
  private sanitizeFilesystemString(str: string): string {
    if (!str || typeof str !== 'string') {
      return '';
    }

    // Keep only alphanumeric, dots, dashes, underscores, slashes, and spaces
    // Remove everything else (control characters, shell special chars, etc.)
    return str.replace(/[^a-zA-Z0-9.\-_/ ]/g, '').trim();
  }

  /**
   * Write file content to agent container.
   * Accepts base64-encoded content to support both text and binary files.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file (from the provider's base path, defaults to /app)
   * @param content - The file content as base64-encoded string
   * @param encoding - Optional encoding indicator ('utf-8' or 'base64')
   * @param context - `app` or `config`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or content is too large
   */
  async writeFile(
    agentId: string,
    filePath: string,
    content: string,
    encoding?: 'utf-8' | 'base64',
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    await this.agentsRepository.findByIdOrThrow(agentId);
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
    // Content is already base64-encoded, so we check the approximate decoded size
    // Base64 is ~33% larger: original_size ≈ base64_length * 3/4
    const approximateOriginalSize = (content.length * 3) / 4;

    if (approximateOriginalSize > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File content size exceeds maximum allowed size of ${this.MAX_FILE_SIZE} bytes`);
    }

    try {
      const escapedPath = this.escapeForShell(containerPath);

      // Write file using base64 decode
      // The content is already base64-encoded, so we just decode it
      // Use sh -c to run the command in a shell so redirection works
      // The base64 content is sent to stdin, which base64 -d reads and decodes
      await this.dockerService.sendCommandToContainer(
        agentEntity.containerId,
        `sh -c "base64 -d > ${escapedPath}"`,
        content,
      );

      this.logger.debug(`File written: ${filePath} for agent ${agentId} (encoding: ${encoding || 'utf-8'})`);
      this.notifyGitStateMayHaveChanged(agentId);
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
    await this.agentsRepository.findByIdOrThrow(agentId);
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
      output = output.replace(/[^a-zA-Z0-9.\-_/ \n]/g, '').trim();

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

      // Process all items in a single command using find with -exec
      // This is more efficient than one command per item
      const escapedItems = items.map((item) => this.escapeForShell(item)).join(' ');
      const processCommand = `sh -c "for item in ${escapedItems}; do
        fullpath=${escapedPath}/\\$item
        if [ -d \\"\\$fullpath\\" ]; then
          echo \\"directory|\\$item|0|\\$(stat -c %Y \\"\\$fullpath\\" 2>/dev/null || echo 0)\\"
        else
          echo \\"file|\\$item|\\$(stat -c %s \\"\\$fullpath\\" 2>/dev/null || echo 0)|\\$(stat -c %Y \\"\\$fullpath\\" 2>/dev/null || echo 0)\\"
        fi
      done"`;
      let processOutput = await this.dockerService.sendCommandToContainer(agentEntity.containerId, processCommand);

      // Remove invalid characters that might come from Docker protocol parsing
      // Keep pipe separator (|) for parsing, newlines, and valid filename characters
      processOutput = processOutput.replace(/[^a-zA-Z0-9.\-_/ |\n]/g, '').trim();

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
   * Create a file or directory in agent container.
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to create (from the provider's base path, defaults to /app)
   * @param type - The type to create ('file' or 'directory')
   * @param content - Optional content for file creation
   * @param context - `app` or `config`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or file already exists
   */
  async createFileOrDirectory(
    agentId: string,
    filePath: string,
    type: 'file' | 'directory',
    content?: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    await this.agentsRepository.findByIdOrThrow(agentId);
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
        // Create directory
        await this.dockerService.sendCommandToContainer(
          agentEntity.containerId,
          `mkdir -p ${this.escapeForShell(containerPath)}`,
        );
      } else {
        // Create file with optional content
        if (content !== undefined) {
          // Content should be base64-encoded
          await this.writeFile(agentId, filePath, content, 'utf-8', context);
        } else {
          // Create empty file
          await this.dockerService.sendCommandToContainer(
            agentEntity.containerId,
            `touch ${this.escapeForShell(containerPath)}`,
          );
        }
      }

      this.logger.debug(`Created ${type}: ${filePath} for agent ${agentId}`);

      if (type === 'directory' || content === undefined) {
        this.notifyGitStateMayHaveChanged(agentId);
      }
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
    await this.agentsRepository.findByIdOrThrow(agentId);
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
    await this.agentsRepository.findByIdOrThrow(agentId);
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
