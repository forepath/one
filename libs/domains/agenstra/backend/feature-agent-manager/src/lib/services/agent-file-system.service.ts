import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AgentFileProbeResult, AgentFileReadResult } from '../dto/agent-file-read-result';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentEntity } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import type { AgentFileManagerContext } from '../utils/agent-file-manager-context';
import {
  DEFAULT_AGENT_WORKSPACE_ROOT,
  normalizeWorkspaceRoot,
  resolveSystemFilePath,
  resolveWorkspaceFilePath,
  type ResolvedSystemFilePath,
  type ResolvedWorkspaceFilePath,
} from '../utils/agent-file-path.utils';
import { classifyAgentFile } from '../utils/agent-file-type';
import { expandProviderPathTildeInContainer } from '../utils/provider-container-path.utils';

import {
  AGENT_PATH_CONTAINMENT_SCRIPT,
  AGENT_PATH_INSIDE_MARKER,
  AGENT_PATH_OUTSIDE_MARKER,
  AGENT_SYSTEM_FS_SCRIPT,
} from './agent-file-system.scripts';
import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { AgentDirectoryIndexService } from './agent-directory-index.service';
import { AgentsService } from './agents.service';
import { AgentRuntime } from '../runtime/agent-runtime';
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
 * How the final path component is treated by the canonical containment check:
 * - `follow`: resolve every symlink, including the target itself (reads, writes, creates, move destinations).
 * - `nofollow`: resolve the parent only and keep the final name (deleting / moving a symlink itself).
 * - `exact`: the canonical path must equal the lexical path — no symlinks anywhere (privileged system paths).
 */
type PathContainmentMode = 'follow' | 'nofollow' | 'exact';

/** Agent container plus the provider workspace root used for path resolution. */
interface AgentFileTarget {
  agentEntity: AgentEntity;
  containerId: string;
  workspaceRoot: string;
}

/**
 * Service for agent file system operations.
 * Provides read, write, list, create, and delete operations on agent container files.
 *
 * Security model:
 * - Public (user-reachable) operations are confined to the agent workspace (`/app`): paths are resolved
 *   lexically, then canonically inside the container (`realpath`, so parent/target symlinks cannot escape),
 *   and every command runs as the unprivileged runtime user that owns the workspace.
 * - `*System*` operations serve trusted internal writers only (OpenCode layer files, context attachments)
 *   via the dedicated `system-files` API. Paths outside the workspace are written as root and hardened
 *   (root-owned, read-only for the runtime user) and must not contain symlinks.
 */
@Injectable()
export class AgentFileSystemService {
  private readonly logger = new Logger(AgentFileSystemService.name);
  /** Per-request / per-chunk size cap (10MB). */
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  /** Maximum assembled size for chunked uploads (100MB). */
  private readonly MAX_ASSEMBLED_FILE_SIZE = 100 * 1024 * 1024;
  private readonly DEFAULT_BASE_PATH = DEFAULT_AGENT_WORKSPACE_ROOT;
  /** Docker exec User for workspace FS ops — the OpenCode runtime user that owns the workspace. */
  private static readonly WORKSPACE_EXEC_USER = 'agenstra';
  /** Docker exec User for privileged FS ops outside the workspace (worker has no sudo mkdir/tee). */
  private static readonly ROOT_EXEC_USER = '0';
  /** Fixed system PATH for root execs (the image PATH starts with agent-writable dirs such as `~/.opencode/bin`). */
  private static readonly ROOT_EXEC_PATH = 'PATH=/usr/sbin:/usr/bin:/sbin:/bin';
  /**
   * Exec environment overrides for root execs. Root commands run via `/usr/bin/env -i` (see {@link commandFor}),
   * so the command itself sees a clean environment; these overrides neutralize loader / libc hooks that legacy
   * containers may carry in their Docker `Env` (agent-defined variables) for the `env` process itself.
   */
  private static readonly ROOT_EXEC_ENV = [
    AgentFileSystemService.ROOT_EXEC_PATH,
    'LD_PRELOAD=',
    'LD_LIBRARY_PATH=',
    'LD_AUDIT=',
    'LD_DEBUG=',
    'LD_DEBUG_OUTPUT=',
    'LD_PROFILE=',
    'GLIBC_TUNABLES=',
    'GCONV_PATH=',
    'LOCPATH=',
    'LC_ALL=C',
    'BASH_ENV=',
    'ENV=',
    'CDPATH=',
  ];
  private static readonly UPLOAD_TTL_MS = 30 * 60 * 1000;
  private readonly uploadStaging = new Map<string, UploadStagingEntry>();

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly runtime: AgentRuntime,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
    private readonly workspaceChangeNotifier: WorkspaceChangeNotifierService,
    private readonly directoryIndex: AgentDirectoryIndexService,
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
      this.runtime.getContainerHomeDirectory(id),
    );
  }

  /**
   * Load the agent and its container, failing when no container is associated.
   * @throws NotFoundException if the agent or its container is missing
   */
  private async getAgentFileTarget(agentId: string): Promise<AgentFileTarget> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    return {
      agentEntity,
      containerId: agentEntity.containerId,
      workspaceRoot: normalizeWorkspaceRoot(this.getBasePath(agentEntity.agentType)),
    };
  }

  /**
   * Verify inside the container that the canonical (symlink-resolved) target stays within `boundary`.
   * @throws BadRequestException when the target escapes the boundary or cannot be resolved
   */
  private async assertCanonicalPathContained(
    containerId: string,
    boundary: string,
    containerPath: string,
    mode: PathContainmentMode,
    user: string,
  ): Promise<void> {
    const output = await this.runtime.sendCommandToContainer(
      containerId,
      this.commandFor(user, [
        'sh',
        '-c',
        AGENT_PATH_CONTAINMENT_SCRIPT,
        'sh',
        boundary,
        containerPath,
        mode,
        this.parentDirectoryOf(containerPath) || '/',
        containerPath.slice(containerPath.lastIndexOf('/') + 1),
      ]),
      undefined,
      true,
      this.execOptionsFor(user),
    );

    if (!output.includes(AGENT_PATH_INSIDE_MARKER) || output.includes(AGENT_PATH_OUTSIDE_MARKER)) {
      throw new BadRequestException(
        mode === 'exact'
          ? 'System file paths must not traverse symbolic links'
          : 'Path resolves outside the agent workspace',
      );
    }
  }

  /**
   * Resolve a user-supplied path into the workspace: lexical confinement plus canonical containment check.
   * @throws BadRequestException if the path is invalid or escapes the workspace (incl. via symlinks)
   */
  private async resolveWorkspacePath(
    target: AgentFileTarget,
    rawPath: string,
    mode: Exclude<PathContainmentMode, 'exact'>,
  ): Promise<ResolvedWorkspaceFilePath> {
    const resolved = resolveWorkspaceFilePath(rawPath, target.workspaceRoot);

    await this.assertWorkspaceContainment(target, resolved, mode);

    return resolved;
  }

  private async assertWorkspaceContainment(
    target: AgentFileTarget,
    resolved: ResolvedWorkspaceFilePath,
    mode: Exclude<PathContainmentMode, 'exact'>,
  ): Promise<void> {
    await this.assertCanonicalPathContained(
      target.containerId,
      target.workspaceRoot,
      resolved.containerPath,
      mode,
      AgentFileSystemService.WORKSPACE_EXEC_USER,
    );
  }

  /** Privileged system paths must be symlink-free so root never writes through an agent-planted link. */
  private async assertSystemPathExact(target: AgentFileTarget, resolved: ResolvedSystemFilePath): Promise<void> {
    await this.assertCanonicalPathContained(
      target.containerId,
      '/',
      resolved.containerPath,
      'exact',
      AgentFileSystemService.ROOT_EXEC_USER,
    );
  }

  /** Exec options for a container user; root execs get a fixed system PATH. */
  /** Root commands run through `env -i` with a fixed PATH: nothing from the container environment reaches them. */
  private commandFor(user: string, command: string[]): string[] {
    return user === AgentFileSystemService.ROOT_EXEC_USER
      ? ['/usr/bin/env', '-i', AgentFileSystemService.ROOT_EXEC_PATH, ...command]
      : command;
  }

  private execOptionsFor(user: string): { user: string; env?: string[] } {
    return user === AgentFileSystemService.ROOT_EXEC_USER
      ? { user, env: AgentFileSystemService.ROOT_EXEC_ENV }
      : { user };
  }

  private escapeForShell(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  private parentDirectoryOf(containerPath: string): string {
    return containerPath.includes('/') ? containerPath.slice(0, containerPath.lastIndexOf('/')) : '';
  }

  /**
   * Run a workspace FS command (argv, never shell-parsed) as the workspace runtime user.
   */
  private async runWorkspaceFsCommand(containerId: string, command: string[], input?: string): Promise<void> {
    await this.runtime.sendCommandToContainer(
      containerId,
      command,
      input,
      true,
      this.execOptionsFor(AgentFileSystemService.WORKSPACE_EXEC_USER),
    );
  }

  /**
   * Run a privileged system file operation as root via {@link AGENT_SYSTEM_FS_SCRIPT}.
   * Injected paths stay root-owned and world-readable but not writable by the OpenCode runtime user
   * (prevents agent manipulation of VFS context).
   * @throws BadRequestException when the path traverses a symlink or leaves the expected directory chain
   */
  private async runSystemFsOperation(
    containerId: string,
    operation: 'write' | 'touch' | 'mkdir' | 'delete',
    containerPath: string,
    input?: string,
  ): Promise<void> {
    let output: string;

    try {
      output = await this.runtime.sendCommandToContainer(
        containerId,
        this.commandFor(AgentFileSystemService.ROOT_EXEC_USER, [
          'sh',
          '-c',
          AGENT_SYSTEM_FS_SCRIPT,
          'sh',
          operation,
          containerPath,
        ]),
        input,
        true,
        this.execOptionsFor(AgentFileSystemService.ROOT_EXEC_USER),
      );
    } catch (error: unknown) {
      if ((error as { message?: string }).message?.includes(AGENT_PATH_OUTSIDE_MARKER)) {
        throw new BadRequestException('System file paths must not traverse symbolic links');
      }

      throw error;
    }

    if (!output.includes(AGENT_PATH_INSIDE_MARKER) || output.includes(AGENT_PATH_OUTSIDE_MARKER)) {
      throw new BadRequestException('System file paths must not traverse symbolic links');
    }
  }

  /**
   * Read file content from the agent workspace.
   * Bytes are streamed via `cat` executed as the workspace runtime user (never with daemon/root privileges).
   * @param agentId - The UUID of the agent
   * @param filePath - Path relative to the workspace root (absolute paths must point inside the workspace)
   * @param context - `app` (workspace)
   * @returns Raw buffer, file type, content type, and size
   * @throws NotFoundException if agent or file is not found
   * @throws BadRequestException if path is invalid/outside the workspace or file exceeds MAX_ASSEMBLED_FILE_SIZE
   */
  async readFile(
    agentId: string,
    filePath: string,
    _context: AgentFileManagerContext = 'app',
  ): Promise<AgentFileReadResult> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = await this.resolveWorkspacePath(target, filePath, 'follow');

    try {
      // Align with chunked upload ceiling so downloaded assemblies remain readable.
      const fileBuffer = await this.runtime.readFileBytesFromContainer(target.containerId, resolved.containerPath, {
        user: AgentFileSystemService.WORKSPACE_EXEC_USER,
        maxBytes: this.MAX_ASSEMBLED_FILE_SIZE,
      });
      const classified = classifyAgentFile(filePath, fileBuffer);

      this.logger.debug(`File ${filePath} classified as ${classified.fileType} (${fileBuffer.length} bytes)`);

      return {
        buffer: fileBuffer,
        fileType: classified.fileType,
        contentType: classified.contentType,
        size: fileBuffer.length,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const err = error as { message?: string };

      if (err.message?.includes('No such file') || err.message?.includes('not found')) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      if (err.message?.includes('Is a directory') || err.message?.includes('Not a regular file')) {
        throw new BadRequestException(`Path is not a regular file: ${filePath}`);
      }

      if (err.message?.includes('Permission denied')) {
        throw new BadRequestException(`Permission denied: ${filePath}`);
      }

      this.logger.error(`Error reading file ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Probe file metadata without transferring the full body.
   * Uses separate `stat` + peek commands (avoids fragile `$()` / demux-sensitive markers).
   */
  async probeFile(
    agentId: string,
    filePath: string,
    _context: AgentFileManagerContext = 'app',
  ): Promise<AgentFileProbeResult> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = await this.resolveWorkspacePath(target, filePath, 'follow');
    const containerPath = resolved.containerPath;
    const peekBytes = 8192;
    const execOptions = this.execOptionsFor(AgentFileSystemService.WORKSPACE_EXEC_USER);

    try {
      const existsOutput = await this.runtime.sendCommandToContainer(
        target.containerId,
        ['sh', '-c', 'test -f "$1" && echo EXISTS || echo NOTFOUND', 'sh', containerPath],
        undefined,
        false,
        execOptions,
      );

      if (existsOutput.includes('NOTFOUND') || !existsOutput.includes('EXISTS')) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      // Small stdout only — parse first integer (docker demux can inject stray chars).
      const sizeRaw = await this.runtime.sendCommandToContainer(
        target.containerId,
        ['stat', '-c', '%s', '--', containerPath],
        undefined,
        false,
        execOptions,
      );
      const sizeMatch = /(\d+)/.exec(sizeRaw);

      if (!sizeMatch) {
        throw new BadRequestException(`Unable to probe file metadata for: ${filePath}`);
      }

      const size = Number(sizeMatch[1]);
      const peekRaw = await this.runtime.sendCommandToContainer(
        target.containerId,
        ['sh', '-c', `head -c ${peekBytes} -- "$1" | base64 -w 0`, 'sh', containerPath],
        undefined,
        false,
        execOptions,
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
   * @param context - `app`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or content is too large
   */
  async writeFile(
    agentId: string,
    filePath: string,
    buffer: Buffer,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    this.assertSingleWriteBuffer(buffer);

    await this.writeBufferToContainer(agentId, filePath, buffer, context);
  }

  private assertSingleWriteBuffer(buffer: Buffer): void {
    if (!Buffer.isBuffer(buffer)) {
      throw new BadRequestException('File content must be a Buffer');
    }

    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File content size exceeds maximum allowed size of ${this.MAX_FILE_SIZE} bytes`);
    }
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

    if (range.start === 0) {
      // Reject invalid / out-of-workspace targets before buffering any upload bytes.
      const target = await this.getAgentFileTarget(agentId);

      resolveWorkspaceFilePath(filePath, target.workspaceRoot);
    }

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
   * Write buffer into the workspace via base64 decode on stdin (internal transport only).
   */
  private async writeBufferToContainer(
    agentId: string,
    filePath: string,
    buffer: Buffer,
    context: AgentFileManagerContext,
  ): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = await this.resolveWorkspacePath(target, filePath, 'follow');

    await this.writeBufferToPath(agentId, target.containerId, filePath, resolved.containerPath, buffer, false);
    this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'upsert', 'write', context);
  }

  /**
   * Shared write transport: workspace paths use `mkdir -p` + `base64 -d > path` as the runtime user;
   * privileged system paths use the race-safe root install of {@link runSystemFsOperation}.
   */
  private async writeBufferToPath(
    agentId: string,
    containerId: string,
    filePath: string,
    containerPath: string,
    buffer: Buffer,
    privileged: boolean,
  ): Promise<void> {
    try {
      const base64Wire = buffer.toString('base64');

      if (privileged) {
        await this.runSystemFsOperation(containerId, 'write', containerPath, base64Wire);
      } else {
        const parentDir = this.parentDirectoryOf(containerPath);

        // Ensure parent directories exist (mkdir -p) before writing the file.
        if (parentDir && parentDir !== '/' && parentDir.length > 0) {
          await this.runWorkspaceFsCommand(containerId, ['mkdir', '-p', '--', parentDir]);
        }

        await this.runWorkspaceFsCommand(
          containerId,
          ['sh', '-c', 'base64 -d > "$1"', 'sh', containerPath],
          base64Wire,
        );
      }

      this.logger.debug(`File written: ${filePath} for agent ${agentId} (${buffer.length} bytes)`);
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
   * @param context - `app`
   * @throws NotFoundException if agent or directory is not found
   * @throws BadRequestException if path is invalid or outside the workspace
   */
  async listDirectory(
    agentId: string,
    directoryPath = '.',
    _context: AgentFileManagerContext = 'app',
    refresh = false,
  ): Promise<FileNodeDto[]> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = resolveWorkspaceFilePath(directoryPath, target.workspaceRoot, { allowRoot: true });

    return this.directoryIndex.getOrLoad(
      agentId,
      target.containerId,
      JSON.stringify([resolved.containerPath, directoryPath]),
      async () => {
        await this.assertWorkspaceContainment(target, resolved, 'follow');

        return this.listDirectoryLive(
          agentId,
          target.containerId,
          resolved.containerPath,
          directoryPath,
          AgentFileSystemService.WORKSPACE_EXEC_USER,
        );
      },
      refresh,
    );
  }

  private async listDirectoryLive(
    agentId: string,
    containerId: string,
    containerPath: string,
    directoryPath: string,
    user: string,
  ): Promise<FileNodeDto[]> {
    try {
      // Use a simpler approach: ls to list, then process with find for each item
      // This avoids the complex while loop that might fail silently
      const escapedPath = this.escapeForShell(containerPath);
      // Get list of items using ls -1 (one per line)
      const listCommand = ['ls', '-a', '-1', '--', containerPath];
      let output = await this.runtime.sendCommandToContainer(
        containerId,
        this.commandFor(user, listCommand),
        undefined,
        true,
        this.execOptionsFor(user),
      );

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
      const processCommand = [
        'sh',
        '-c',
        `for item in ${escapedItems}; do
        fullpath=${escapedPath}/"$item"
        metadata=$(stat -c '%Y|%s' "$fullpath") || {
          if [ ! -e "$fullpath" ] && [ ! -L "$fullpath" ] && [ -x ${escapedPath} ]; then
            continue
          fi
          exit 1
        }
        modified=\${metadata%%|*}
        size=\${metadata#*|}
        if [ -d "$fullpath" ]; then
          printf 'directory|%s|0|%s\\n' "$item" "$modified"
        else
          printf 'file|%s|%s|%s\\n' "$item" "$size" "$modified"
        fi
      done`,
      ];
      let processOutput = await this.runtime.sendCommandToContainer(
        containerId,
        this.commandFor(user, processCommand),
        undefined,
        true,
        this.execOptionsFor(user),
      );

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
   * @param context - `app`
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if path is invalid or outside the workspace
   */
  async createFileOrDirectory(
    agentId: string,
    filePath: string,
    type: 'file' | 'directory',
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = await this.resolveWorkspacePath(target, filePath, 'follow');

    await this.createAtPath(agentId, target.containerId, filePath, resolved.containerPath, type, false);
    this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'upsert', 'create', context);
  }

  private async createAtPath(
    agentId: string,
    containerId: string,
    filePath: string,
    containerPath: string,
    type: 'file' | 'directory',
    privileged: boolean,
  ): Promise<void> {
    try {
      if (privileged) {
        await this.runSystemFsOperation(containerId, type === 'directory' ? 'mkdir' : 'touch', containerPath);
      } else if (type === 'directory') {
        await this.runWorkspaceFsCommand(containerId, ['mkdir', '-p', '--', containerPath]);
      } else {
        const parentDir = this.parentDirectoryOf(containerPath);

        if (parentDir && parentDir !== '/' && parentDir.length > 0) {
          await this.runWorkspaceFsCommand(containerId, ['mkdir', '-p', '--', parentDir]);
        }

        await this.runWorkspaceFsCommand(containerId, ['touch', '--', containerPath]);
      }

      this.logger.debug(`Created ${type}: ${filePath} for agent ${agentId}`);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error creating ${type} ${filePath} for agent ${agentId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Delete a file or directory from agent container.
   * A symlink inside the workspace is removed itself (its target is never touched).
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to delete (from the provider's base path, defaults to /app)
   * @param context - `app`
   * @throws NotFoundException if agent or file is not found
   * @throws BadRequestException if path is invalid or outside the workspace
   */
  async deleteFileOrDirectory(
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = await this.resolveWorkspacePath(target, filePath, 'nofollow');

    await this.deleteAtPath(agentId, target.containerId, filePath, resolved.containerPath, false);
    this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'delete', 'delete', context);
  }

  private async deleteAtPath(
    agentId: string,
    containerId: string,
    filePath: string,
    containerPath: string,
    privileged: boolean,
  ): Promise<void> {
    try {
      // Use rm -rf to delete file or directory (never follows a final-component symlink)
      if (privileged) {
        await this.runSystemFsOperation(containerId, 'delete', containerPath);
      } else {
        await this.runWorkspaceFsCommand(containerId, ['rm', '-rf', '--', containerPath]);
      }

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
   * @param context - `app`
   * @throws NotFoundException if agent, source file, or destination directory is not found
   * @throws BadRequestException if paths are invalid or outside the workspace
   */
  async moveFileOrDirectory(
    agentId: string,
    sourcePath: string,
    destinationPath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    // Validate both paths lexically before any in-container check runs.
    const source = resolveWorkspaceFilePath(sourcePath, target.workspaceRoot);
    const destination = resolveWorkspaceFilePath(destinationPath, target.workspaceRoot);

    await this.assertWorkspaceContainment(target, source, 'nofollow');
    await this.assertWorkspaceContainment(target, destination, 'follow');

    try {
      // Use mv command to move file or directory
      await this.runtime.sendCommandToContainer(
        target.containerId,
        ['mv', '--', source.containerPath, destination.containerPath],
        undefined,
        false,
        this.execOptionsFor(AgentFileSystemService.WORKSPACE_EXEC_USER),
      );

      this.logger.debug(`Moved: ${sourcePath} to ${destinationPath} for agent ${agentId}`);
      this.notifyGitStateMayHaveChanged(agentId);
      this.notifyWorkspacePathChange(agentId, source.relativePath, 'delete', 'move', context);
      this.notifyWorkspacePathChange(agentId, destination.relativePath, 'upsert', 'move', context);
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
   * Write a file for trusted system writers (OpenCode layer files, context attachments).
   * Workspace paths behave like {@link writeFile}; absolute paths outside the workspace are written as root,
   * hardened read-only for the runtime user, and must not traverse symlinks.
   * Never expose this through user-facing routes.
   */
  async writeSystemFile(agentId: string, filePath: string, buffer: Buffer): Promise<void> {
    this.assertSingleWriteBuffer(buffer);

    const target = await this.getAgentFileTarget(agentId);
    const resolved = resolveSystemFilePath(filePath, target.workspaceRoot);

    if (resolved.scope === 'workspace') {
      await this.assertWorkspaceContainment(target, resolved, 'follow');
      await this.writeBufferToPath(agentId, target.containerId, filePath, resolved.containerPath, buffer, false);
      this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'upsert', 'write');

      return;
    }

    await this.writeBufferToPath(agentId, target.containerId, filePath, resolved.containerPath, buffer, true);
    this.workspaceChangeNotifier.notifyDirectoryTreeChanged(agentId);
  }

  /**
   * Create an empty file or directory for trusted system writers (see {@link writeSystemFile}).
   */
  async createSystemFileOrDirectory(agentId: string, filePath: string, type: 'file' | 'directory'): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = resolveSystemFilePath(filePath, target.workspaceRoot);

    if (resolved.scope === 'workspace') {
      await this.assertWorkspaceContainment(target, resolved, 'follow');
      await this.createAtPath(agentId, target.containerId, filePath, resolved.containerPath, type, false);
      this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'upsert', 'create');

      return;
    }

    await this.createAtPath(agentId, target.containerId, filePath, resolved.containerPath, type, true);
    this.workspaceChangeNotifier.notifyDirectoryTreeChanged(agentId);
  }

  /**
   * Delete a file or directory for trusted system writers (see {@link writeSystemFile}).
   */
  async deleteSystemFileOrDirectory(agentId: string, filePath: string): Promise<void> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = resolveSystemFilePath(filePath, target.workspaceRoot);

    if (resolved.scope === 'workspace') {
      await this.assertWorkspaceContainment(target, resolved, 'nofollow');
      await this.deleteAtPath(agentId, target.containerId, filePath, resolved.containerPath, false);
      this.notifyWorkspacePathChange(agentId, resolved.relativePath, 'delete', 'delete');

      return;
    }

    await this.deleteAtPath(agentId, target.containerId, filePath, resolved.containerPath, true);
    this.workspaceChangeNotifier.notifyDirectoryTreeChanged(agentId);
  }

  /**
   * List a directory for trusted system writers (see {@link writeSystemFile}).
   * Node paths keep the requested prefix (absolute requests yield absolute node paths).
   */
  async listSystemDirectory(agentId: string, directoryPath = '.', refresh = false): Promise<FileNodeDto[]> {
    const target = await this.getAgentFileTarget(agentId);
    const resolved = resolveSystemFilePath(directoryPath, target.workspaceRoot, { allowRoot: true });

    return this.directoryIndex.getOrLoad(
      agentId,
      target.containerId,
      JSON.stringify([resolved.containerPath, directoryPath]),
      async () => {
        if (resolved.scope === 'workspace') {
          await this.assertWorkspaceContainment(target, resolved, 'follow');

          return this.listDirectoryLive(
            agentId,
            target.containerId,
            resolved.containerPath,
            directoryPath,
            AgentFileSystemService.WORKSPACE_EXEC_USER,
          );
        }

        await this.assertSystemPathExact(target, resolved);

        return this.listDirectoryLive(
          agentId,
          target.containerId,
          resolved.containerPath,
          directoryPath,
          AgentFileSystemService.ROOT_EXEC_USER,
        );
      },
      refresh,
    );
  }
}
