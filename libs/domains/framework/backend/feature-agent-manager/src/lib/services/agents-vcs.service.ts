import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CreateBranchDto } from '../dto/create-branch.dto';
import { GitBranchDto } from '../dto/git-branch.dto';
import { GitDiffDto } from '../dto/git-diff.dto';
import { GitFileStatusDto, GitStatusDto } from '../dto/git-status.dto';
import { ResolveConflictDto } from '../dto/resolve-conflict.dto';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentFileSystemService } from './agent-file-system.service';
import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

/**
 * Service for agent VCS (Version Control System) operations.
 * Provides git operations executed in agent Docker containers.
 */
@Injectable()
export class AgentsVcsService {
  private readonly logger = new Logger(AgentsVcsService.name);
  private readonly BASE_PATH = '/app';
  private readonly MAX_DIFF_SIZE = 10 * 1024 * 1024; // 10MB

  // Commit author from environment variables
  private readonly commitAuthorName: string;
  private readonly commitAuthorEmail: string;

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly agentFileSystemService: AgentFileSystemService,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
  ) {
    // Get commit author from environment variables
    this.commitAuthorName = process.env.GIT_COMMIT_AUTHOR_NAME || 'Agenstra Agent';
    this.commitAuthorEmail = process.env.GIT_COMMIT_AUTHOR_EMAIL || 'agent@agenstra.local';
  }

  private notifyGitStateMayHaveChanged(agentId: string): void {
    this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentId);
  }

  /**
   * Clean command output by removing control characters and null bytes.
   * Preserves leading/trailing whitespace unless explicitly trimmed.
   */
  private cleanOutput(output: string, trim = true): string {
    if (!output) return '';

    // Remove null bytes and other problematic control characters
    let cleaned = output
      .replace(/\0/g, '') // Remove null bytes
      .replace(/\r/g, '') // Remove carriage returns
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);

        // Keep printable ASCII (32-126) and newlines/tabs
        return (code >= 32 && code <= 126) || code === 9 || code === 10;
      })
      .join('');

    // Remove trailing newlines but preserve leading spaces (important for git porcelain)
    cleaned = cleaned.replace(/\n+$/, '');

    return trim ? cleaned.trim() : cleaned;
  }

  /**
   * Normalize git status code to ensure it contains only valid git status characters.
   * Valid characters: space, M, A, D, R, C, U, ?, T
   * Invalid characters are replaced with space.
   */
  private normalizeStatusCode(statusCode: string): string {
    if (!statusCode || statusCode.length === 0) {
      return '  ';
    }

    // Ensure exactly 2 characters
    const normalized = statusCode.padEnd(2, ' ').substring(0, 2);
    // Valid git status characters
    const validChars = new Set([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?', 'T']);

    // Replace invalid characters with space
    return normalized
      .split('')
      .map((char) => (validChars.has(char) ? char : ' '))
      .join('');
  }

  /**
   * Execute a git command in the agent's container.
   * @param containerId - The container ID
   * @param command - Git command (without 'git' prefix)
   * @param workingDir - Working directory (defaults to BASE_PATH)
   * @param preserveLeadingSpaces - If true, don't trim leading spaces (for porcelain format)
   * @returns Command output (cleaned)
   */
  private async executeGitCommand(
    containerId: string,
    command: string,
    workingDir: string = this.BASE_PATH,
    preserveLeadingSpaces = false,
    disablePrompts = false,
    checkExitCode = false,
  ): Promise<string> {
    // Escape the command for shell execution
    const escapedCommand = command.replace(/'/g, "'\\''");
    // Set environment variables to disable interactive prompts if requested
    let envPrefix = '';

    if (disablePrompts) {
      // GIT_TERMINAL_PROMPT=0: Disable terminal prompts (Git will fail instead of prompting)
      // GIT_ASKPASS='false': Use 'false' command which always exits with error code 1
      // This prevents Git from hanging on interactive credential prompts and causes immediate failure
      envPrefix = "GIT_TERMINAL_PROMPT=0 GIT_ASKPASS='false' ";
    }

    const fullCommand = `cd '${workingDir}' && ${envPrefix}git ${escapedCommand}`;
    const output = await this.dockerService.sendCommandToContainer(
      containerId,
      `sh -c "${fullCommand}"`,
      undefined,
      checkExitCode,
    );

    return this.cleanOutput(output, !preserveLeadingSpaces);
  }

  /**
   * Get git status for the agent's repository.
   * @param agentId - The UUID of the agent
   * @returns Git status information
   */
  async getStatus(agentId: string): Promise<GitStatusDto> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Get current branch
      const currentBranchOutput = await this.executeGitCommand(agentEntity.containerId, 'rev-parse --abbrev-ref HEAD');
      const currentBranch = this.cleanBranchName(currentBranchOutput);
      // Get branch tracking info
      // First check if remote branch exists
      let aheadCount = 0;
      let behindCount = 0;

      try {
        // Check if remote branch exists
        const remoteBranchExists = await this.executeGitCommand(
          agentEntity.containerId,
          `ls-remote --heads origin ${this.escapePath(currentBranch)} 2>/dev/null || echo ""`,
        );

        if (remoteBranchExists.trim()) {
          // Remote branch exists - get ahead/behind counts
          const trackingInfoOutput = await this.executeGitCommand(
            agentEntity.containerId,
            `rev-list --left-right --count ${this.escapePath(currentBranch)}...origin/${this.escapePath(currentBranch)} 2>/dev/null || echo "0 0"`,
          );
          const [ahead, behind] = trackingInfoOutput
            .trim()
            .split(/\s+/)
            .map((n) => parseInt(n, 10) || 0);

          aheadCount = ahead;
          behindCount = behind;
        } else {
          // Remote branch doesn't exist - count commits not on remote default branch
          // Try to find the default branch (main or master)
          let defaultBranch = 'main';

          try {
            const defaultBranchOutput = await this.executeGitCommand(
              agentEntity.containerId,
              `symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`,
            );
            const detectedDefault = this.cleanBranchName(defaultBranchOutput);

            if (detectedDefault) {
              defaultBranch = detectedDefault;
            }
          } catch {
            // Fallback to main
          }

          // Count commits on current branch that aren't on origin/default
          const commitCountOutput = await this.executeGitCommand(
            agentEntity.containerId,
            `rev-list --count ${this.escapePath(currentBranch)} --not origin/${this.escapePath(defaultBranch)} 2>/dev/null || echo "0"`,
          );

          aheadCount = parseInt(commitCountOutput.trim(), 10) || 0;
          behindCount = 0;
        }
      } catch {
        // If we can't determine, assume no unpushed commits
        aheadCount = 0;
        behindCount = 0;
      }

      // Get git status --porcelain output (preserve leading spaces!)
      const statusOutput = await this.executeGitCommand(
        agentEntity.containerId,
        'status --porcelain',
        this.BASE_PATH,
        true,
      );
      // Git porcelain format: "XY path" where XY are exactly 2 characters
      // Examples: " M file.txt" (unstaged), "M  file.txt" (staged), "MM file.txt" (both)
      const files: GitFileStatusDto[] = [];
      const lines = statusOutput.split('\n').filter((line) => line.length > 0);
      // Valid git status characters for porcelain format
      const validGitStatusChars = new Set([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?', 'T']);

      for (const line of lines) {
        this.logger.debug(`Raw line: ${line}`);

        // Find where the git status code starts (may have shell artifacts like "- " prefix)
        // Git porcelain format: exactly 2 valid status characters followed by whitespace and path
        let statusCodeStart = -1;

        for (let i = 0; i <= line.length - 2; i++) {
          const char1 = line[i];
          const char2 = line[i + 1];

          // Check if both characters are valid git status characters
          if (validGitStatusChars.has(char1) && validGitStatusChars.has(char2)) {
            // Check if next character is whitespace (indicating start of path)
            if (i + 2 < line.length && (line[i + 2] === ' ' || line[i + 2] === '\t')) {
              statusCodeStart = i;
              break;
            }
          }
        }

        // If we couldn't find a valid status code, skip this line
        if (statusCodeStart === -1) {
          this.logger.warn(`Could not find valid git status code in line: ${line}`);
          continue;
        }

        // Extract the status code (exactly 2 characters)
        const rawStatusCode = line.substring(statusCodeStart, statusCodeStart + 2);

        this.logger.debug(`Found status code at position ${statusCodeStart}: "${rawStatusCode}"`);

        // Find path start (skip whitespace after status code)
        let pathStart = statusCodeStart + 2;

        while (pathStart < line.length && (line[pathStart] === ' ' || line[pathStart] === '\t')) {
          pathStart++;
        }

        if (pathStart >= line.length) {
          continue;
        }

        const path = line.substring(pathStart).trim();

        if (!path) {
          continue;
        }

        // Extract status characters from RAW status code for accurate type detection
        // Use raw code to detect type, as normalization might affect valid status codes
        const stagedStatus = rawStatusCode[0] || ' ';
        const unstagedStatus = rawStatusCode[1] || ' ';
        // Determine file type based on raw status code
        let type: 'staged' | 'unstaged' | 'untracked' | 'both';

        if (stagedStatus === '?' && unstagedStatus === '?') {
          type = 'untracked';
        } else if (stagedStatus !== ' ' && unstagedStatus !== ' ') {
          type = 'both';
        } else if (stagedStatus !== ' ') {
          type = 'staged';
        } else {
          type = 'unstaged';
        }

        // Normalize status code for the response (to clean invalid characters)
        const normalizedStatusCode = this.normalizeStatusCode(rawStatusCode);
        // Check if binary file
        const isBinary = await this.isBinaryFile(agentEntity.containerId, path);

        files.push({
          path,
          status: normalizedStatusCode,
          type,
          isBinary,
        });
      }

      // Check if working tree is clean
      const isClean = files.length === 0;

      return {
        currentBranch,
        isClean,
        hasUnpushedCommits: aheadCount > 0,
        aheadCount,
        behindCount,
        files,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };

      this.logger.error(`Error getting git status for agent ${agentId}: ${err.message}`, err.stderr);
      throw new BadRequestException(`Failed to get git status: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Check if a file is binary.
   */
  private async isBinaryFile(containerId: string, filePath: string): Promise<boolean> {
    try {
      const output = await this.executeGitCommand(containerId, `check-attr -z binary -- ${this.escapePath(filePath)}`);

      return output.includes('binary: set');
    } catch {
      // If check-attr fails, try diff --check
      try {
        const diffOutput = await this.executeGitCommand(
          containerId,
          `diff --check --quiet -- ${this.escapePath(filePath)} 2>&1 || true`,
        );

        return diffOutput.includes('Binary files differ');
      } catch {
        return false;
      }
    }
  }

  /**
   * Validate if a branch name is valid according to Git rules.
   * Git branch names:
   * - Cannot start with a dot (.)
   * - Cannot contain sequences of dots (..)
   * - Cannot end with a dot (.)
   * - Cannot end with a slash (/)
   * - Cannot contain certain special characters (backticks, spaces, control chars, etc.)
   * - Should only contain: alphanumeric, dots, hyphens, underscores, forward slashes
   */
  private isValidBranchName(branchName: string): boolean {
    if (!branchName || branchName.length === 0) return false;

    // Cannot start with a dot
    if (branchName.startsWith('.')) return false;

    // Cannot end with a dot or slash
    if (branchName.endsWith('.') || branchName.endsWith('/')) return false;

    // Cannot contain sequences of dots
    if (branchName.includes('..')) return false;

    // Cannot contain invalid characters
    // Valid characters: alphanumeric, dots, hyphens, underscores, forward slashes
    // Exclude: backticks, spaces, control characters, and other special chars
    const validBranchNamePattern = /^[a-zA-Z0-9._\-/]+$/;

    if (!validBranchNamePattern.test(branchName)) return false;

    // Additional checks: no leading/trailing spaces (should be caught by pattern, but double-check)
    if (branchName.trim() !== branchName) return false;

    return true;
  }

  /**
   * Clean branch name by removing leading/trailing whitespace and asterisks,
   * and filtering out invalid characters.
   * Git branch output can include prefixes like "* " for current branch or "  " for others.
   *
   * This method is strict: if the original name (after removing whitespace/asterisks) contains
   * invalid characters, the branch is rejected entirely rather than having those characters removed.
   */
  private cleanBranchName(branchName: string): string {
    if (!branchName) return '';

    // First, clean the output (remove control characters, null bytes, etc.)
    const cleaned = this.cleanOutput(branchName)
      .replace(/^[\s*]+/, '') // Remove leading whitespace and asterisks
      .replace(/[\s*]+$/, '') // Remove trailing whitespace and asterisks
      .trim();
    // Check if the cleaned name (before removing invalid chars) contains invalid characters
    // If it does, reject the branch entirely - don't try to sanitize it
    const hasInvalidChars = /[^a-zA-Z0-9._\-/]/.test(cleaned);

    if (hasInvalidChars) {
      // Branch name contains invalid characters - reject it
      return '';
    }

    // Now validate the cleaned name structure (dots, endings, etc.)
    if (!this.isValidBranchName(cleaned)) {
      return '';
    }

    return cleaned;
  }

  /**
   * Escape a file path for shell usage.
   */
  private escapePath(path: string): string {
    return path.replace(/'/g, "'\\''").replace(/\s/g, '\\ ');
  }

  /**
   * List all branches (local and remote).
   * @param agentId - The UUID of the agent
   * @returns Array of branch information
   */
  async getBranches(agentId: string): Promise<GitBranchDto[]> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Get current branch
      const currentBranchOutput = await this.executeGitCommand(agentEntity.containerId, 'rev-parse --abbrev-ref HEAD');
      const currentBranch = this.cleanBranchName(currentBranchOutput);
      // Get local branches
      const localBranchesOutput = await this.executeGitCommand(agentEntity.containerId, 'branch');
      const localBranchNames = localBranchesOutput
        .split('\n')
        .map((line) => this.cleanBranchName(line))
        .filter((line) => line.length > 0);
      // Get remote branches
      const remoteBranchesOutput = await this.executeGitCommand(agentEntity.containerId, 'branch -r');
      const remoteBranchRefs = remoteBranchesOutput
        .split('\n')
        .map((line) => this.cleanBranchName(line))
        .filter((line) => line.length > 0 && !line.includes('HEAD'));
      const branches: GitBranchDto[] = [];

      // Process local branches
      for (const branchName of localBranchNames) {
        if (!branchName) continue;

        // Clean branch name to ensure no leading/trailing whitespace or special chars
        const cleanBranchName = this.cleanBranchName(branchName);

        // Skip invalid branch names (empty or containing invalid characters)
        if (!cleanBranchName || !this.isValidBranchName(cleanBranchName)) {
          this.logger.warn(`Skipping invalid branch name: ${JSON.stringify(branchName)}`);
          continue;
        }

        const isCurrent = cleanBranchName === currentBranch;
        // Get commit info - use single quotes to prevent shell interpretation of %s
        const commitOutput = await this.executeGitCommand(
          agentEntity.containerId,
          `log -1 --format='%h|%s' ${this.escapePath(cleanBranchName)}`,
        );
        const [commit, ...messageParts] = commitOutput.split('|');
        const message = this.cleanOutput(messageParts.join('|') || '');
        // Get tracking info
        let aheadCount: number | undefined;
        let behindCount: number | undefined;

        try {
          // Check if remote branch exists
          const remoteBranchExists = await this.executeGitCommand(
            agentEntity.containerId,
            `ls-remote --heads origin ${this.escapePath(cleanBranchName)} 2>/dev/null || echo ""`,
          );

          if (remoteBranchExists.trim()) {
            // Remote branch exists - get ahead/behind counts
            const trackingOutput = await this.executeGitCommand(
              agentEntity.containerId,
              `rev-list --left-right --count ${this.escapePath(cleanBranchName)}...origin/${this.escapePath(cleanBranchName)} 2>/dev/null || echo "0 0"`,
            );
            const [ahead, behind] = trackingOutput
              .trim()
              .split(/\s+/)
              .map((n) => parseInt(n, 10) || 0);

            aheadCount = ahead;
            behindCount = behind;
          } else {
            // Remote branch doesn't exist - count commits not on remote default branch
            // Try to find the default branch (main or master)
            let defaultBranch = 'main';

            try {
              const defaultBranchOutput = await this.executeGitCommand(
                agentEntity.containerId,
                `symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`,
              );
              const detectedDefault = this.cleanBranchName(defaultBranchOutput);

              if (detectedDefault) {
                defaultBranch = detectedDefault;
              }
            } catch {
              // Fallback to main
            }

            // Count commits on current branch that aren't on origin/default
            const commitCountOutput = await this.executeGitCommand(
              agentEntity.containerId,
              `rev-list --count ${this.escapePath(cleanBranchName)} --not origin/${this.escapePath(defaultBranch)} 2>/dev/null || echo "0"`,
            );

            aheadCount = parseInt(commitCountOutput.trim(), 10) || 0;
            behindCount = 0;
          }
        } catch {
          // No tracking branch or error - assume no unpushed commits
          aheadCount = undefined;
          behindCount = undefined;
        }

        branches.push({
          name: cleanBranchName,
          ref: `refs/heads/${cleanBranchName}`,
          isCurrent,
          isRemote: false,
          commit: this.cleanOutput(commit || ''),
          message,
          aheadCount,
          behindCount,
        });
      }

      // Process remote branches
      for (const remoteRef of remoteBranchRefs) {
        if (!remoteRef) continue;

        // Handle both formats: "origin/branch" and "remotes/origin/branch"
        let match = remoteRef.match(/^remotes\/([^/]+)\/(.+)$/);

        if (!match) {
          match = remoteRef.match(/^([^/]+)\/(.+)$/);
        }

        if (!match) continue;

        const [, remoteName, branchName] = match;
        // Clean branch name - remove any remaining whitespace or special characters
        const cleanBranchName = this.cleanBranchName(branchName);

        // Skip invalid branch names (empty or containing invalid characters)
        if (!cleanBranchName || !this.isValidBranchName(cleanBranchName)) {
          this.logger.warn(`Skipping invalid remote branch name: ${JSON.stringify(branchName)}`);
          continue;
        }

        // Skip if we already have this as a local branch
        if (localBranchNames.includes(cleanBranchName)) continue;

        // Get commit info - use single quotes to prevent shell interpretation
        const commitOutput = await this.executeGitCommand(
          agentEntity.containerId,
          `log -1 --format='%h|%s' ${this.escapePath(remoteRef)}`,
        );
        const [commit, ...messageParts] = commitOutput.split('|');
        const message = this.cleanOutput(messageParts.join('|') || '');

        branches.push({
          name: cleanBranchName,
          ref: `refs/remotes/${remoteRef}`,
          isCurrent: false,
          isRemote: true,
          remote: this.cleanOutput(remoteName),
          commit: this.cleanOutput(commit || ''),
          message,
        });
      }

      return branches;
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error getting branches for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to get branches: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Get diff for a specific file.
   * @param agentId - The UUID of the agent
   * @param filePath - The file path relative to repository root
   * @returns File diff information
   */
  async getFileDiff(agentId: string, filePath: string): Promise<GitDiffDto> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Check if file is binary
      const isBinary = await this.isBinaryFile(agentEntity.containerId, filePath);

      if (isBinary) {
        // For binary files, only return size information
        const originalSize = await this.getFileSize(agentEntity.containerId, filePath, 'HEAD');
        const modifiedSize = await this.getFileSize(agentEntity.containerId, filePath, 'WORKING');

        return {
          path: filePath,
          originalContent: '',
          modifiedContent: '',
          encoding: 'base64',
          isBinary: true,
          originalSize,
          modifiedSize,
        };
      }

      // For text files, get actual diff content
      // Get original content from HEAD
      let originalContent = '';

      try {
        const originalOutput = await this.executeGitCommand(
          agentEntity.containerId,
          `show HEAD:${this.escapePath(filePath)} 2>/dev/null || echo ""`,
        );

        originalContent = Buffer.from(originalOutput).toString('base64');
      } catch {
        // File doesn't exist in HEAD (new file)
        originalContent = '';
      }

      // Get modified content from working tree
      const modifiedContentDto = await this.agentFileSystemService.readFile(agentId, filePath);
      const modifiedContent = modifiedContentDto.content; // Already base64-encoded

      return {
        path: filePath,
        originalContent,
        modifiedContent,
        encoding: 'utf-8',
        isBinary: false,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error getting diff for file ${filePath} in agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to get file diff: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Get file size for a specific revision.
   */
  private async getFileSize(containerId: string, filePath: string, revision: string): Promise<number | undefined> {
    try {
      let output: string;

      if (revision === 'WORKING') {
        const escapedPath = this.escapePath(filePath);

        output = await this.dockerService.sendCommandToContainer(
          containerId,
          `sh -c "cd '${this.BASE_PATH}' && stat -c %s '${escapedPath}' 2>/dev/null || echo '0'"`,
        );
      } else {
        const escapedPath = this.escapePath(filePath);

        output = await this.executeGitCommand(
          containerId,
          `cat-file -s ${revision}:${escapedPath} 2>/dev/null || echo "0"`,
        );
      }

      const size = parseInt(output.trim(), 10);

      return isNaN(size) ? undefined : size;
    } catch {
      return undefined;
    }
  }

  /**
   * Stage files.
   * @param agentId - The UUID of the agent
   * @param files - Array of file paths to stage (empty array stages all)
   */
  async stageFiles(agentId: string, files: string[]): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      if (files.length === 0) {
        // Stage all changes
        await this.executeGitCommand(agentEntity.containerId, 'add -A');
      } else {
        // Stage specific files
        const escapedFiles = files.map((f) => this.escapePath(f)).join(' ');

        await this.executeGitCommand(agentEntity.containerId, `add ${escapedFiles}`);
      }

      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error staging files for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to stage files: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Unstage files.
   * @param agentId - The UUID of the agent
   * @param files - Array of file paths to unstage (empty array unstages all)
   */
  async unstageFiles(agentId: string, files: string[]): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      if (files.length === 0) {
        // Unstage all changes
        await this.executeGitCommand(agentEntity.containerId, 'reset HEAD');
      } else {
        // Unstage specific files
        const escapedFiles = files.map((f) => this.escapePath(f)).join(' ');

        await this.executeGitCommand(agentEntity.containerId, `reset HEAD ${escapedFiles}`);
      }

      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error unstaging files for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to unstage files: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Commit staged changes.
   * @param agentId - The UUID of the agent
   * @param message - Commit message
   */
  async commit(agentId: string, message: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    if (!message || !message.trim()) {
      throw new BadRequestException('Commit message is required');
    }

    try {
      // Escape commit message for shell
      const escapedMessage = message.replace(/'/g, "'\\''");

      await this.executeGitCommand(
        agentEntity.containerId,
        `-c user.name='${this.commitAuthorName}' -c user.email='${this.commitAuthorEmail}' commit -m '${escapedMessage}'`,
      );
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error committing changes for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to commit: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Push changes to remote.
   * @param agentId - The UUID of the agent
   */
  async push(agentId: string, force = false): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Get current branch
      const currentBranchOutput = await this.executeGitCommand(agentEntity.containerId, 'rev-parse --abbrev-ref HEAD');
      const currentBranch = this.cleanBranchName(currentBranchOutput);
      // Check if remote branch exists
      const remoteBranchExists = await this.executeGitCommand(
        agentEntity.containerId,
        `ls-remote --heads origin ${this.escapePath(currentBranch)} 2>/dev/null || echo ""`,
      );
      // If remote branch doesn't exist, use -u to set up tracking
      const pushFlags: string[] = [];

      if (force) {
        pushFlags.push('--force-with-lease');
      }

      if (!remoteBranchExists.trim()) {
        pushFlags.push('-u');
      }

      const pushCommand = `push ${[...pushFlags, 'origin', this.escapePath(currentBranch)].join(' ')}`.trim();

      // Execute push with disablePrompts=true to prevent interactive credential prompts
      // This will cause Git to fail immediately if credentials aren't available
      // Also enable exit code checking to properly detect and report push failures
      await this.executeGitCommand(agentEntity.containerId, pushCommand, this.BASE_PATH, false, true, true);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error ${force ? 'force ' : ''}pushing changes for agent ${agentId}: ${err.message}`);

      // Check if error is related to authentication
      const errorMessage = err.message || '';

      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('fatal: could not read Username') ||
        errorMessage.includes('fatal: could not read Password') ||
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('fatal: could not read Username for')
      ) {
        throw new BadRequestException(
          `Failed to push${
            force ? ' (force)' : ''
          }: No valid credentials available. Please configure Git credentials (GIT_USERNAME and GIT_TOKEN) or SSH key (GIT_PRIVATE_KEY).`,
        );
      }

      throw new BadRequestException(`Failed to push${force ? ' (force)' : ''}: ${errorMessage || 'Unknown error'}`);
    }
  }

  /**
   * Pull changes from remote.
   * @param agentId - The UUID of the agent
   */
  async pull(agentId: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Get current branch
      const currentBranchOutput = await this.executeGitCommand(agentEntity.containerId, 'rev-parse --abbrev-ref HEAD');
      const currentBranch = this.cleanBranchName(currentBranchOutput);

      // Execute pull with disablePrompts=true to prevent interactive credential prompts
      // Also enable exit code checking to properly detect and report pull failures
      await this.executeGitCommand(
        agentEntity.containerId,
        `pull origin ${this.escapePath(currentBranch)}`,
        this.BASE_PATH,
        false,
        true,
        true,
      );
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error pulling changes for agent ${agentId}: ${err.message}`);

      // Check if error is related to authentication
      const errorMessage = err.message || '';

      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('fatal: could not read Username') ||
        errorMessage.includes('fatal: could not read Password') ||
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('fatal: could not read Username for')
      ) {
        throw new BadRequestException(
          'Failed to pull: No valid credentials available. Please configure Git credentials (GIT_USERNAME and GIT_TOKEN) or SSH key (GIT_PRIVATE_KEY).',
        );
      }

      throw new BadRequestException(`Failed to pull: ${errorMessage || 'Unknown error'}`);
    }
  }

  /**
   * Fetch changes from remote.
   * @param agentId - The UUID of the agent
   */
  async fetch(agentId: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Execute fetch with disablePrompts=true to prevent interactive credential prompts
      // Also enable exit code checking to properly detect and report fetch failures
      await this.executeGitCommand(agentEntity.containerId, 'fetch origin', this.BASE_PATH, false, true, true);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error fetching changes for agent ${agentId}: ${err.message}`);

      // Check if error is related to authentication
      const errorMessage = err.message || '';

      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('fatal: could not read Username') ||
        errorMessage.includes('fatal: could not read Password') ||
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('fatal: could not read Username for')
      ) {
        throw new BadRequestException(
          'Failed to fetch: No valid credentials available. Please configure Git credentials (GIT_USERNAME and GIT_TOKEN) or SSH key (GIT_PRIVATE_KEY).',
        );
      }

      throw new BadRequestException(`Failed to fetch: ${errorMessage || 'Unknown error'}`);
    }
  }

  /**
   * Rebase current branch onto another branch.
   * @param agentId - The UUID of the agent
   * @param branch - Branch to rebase onto
   */
  async rebase(agentId: string, branch: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      const cleanBranchName = this.cleanBranchName(branch);

      await this.executeGitCommand(agentEntity.containerId, `rebase ${this.escapePath(cleanBranchName)}`);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error rebasing for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to rebase: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Switch to a different branch.
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to switch to
   */
  async switchBranch(agentId: string, branch: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      const cleanBranchName = this.cleanBranchName(branch);

      await this.executeGitCommand(agentEntity.containerId, `checkout ${this.escapePath(cleanBranchName)}`);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      this.logger.error(`Error switching branch for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to switch branch: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Create a new branch.
   * @param agentId - The UUID of the agent
   * @param dto - Branch creation DTO
   */
  async createBranch(agentId: string, dto: CreateBranchDto): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      let branchName = dto.name.trim();

      // Apply conventional commit prefix if requested
      if (dto.useConventionalPrefix && dto.conventionalType) {
        const prefix = `${dto.conventionalType}/`;

        if (!branchName.startsWith(prefix)) {
          branchName = `${prefix}${branchName}`;
        }
      }

      // Validate branch name
      if (!/^[a-zA-Z0-9/_-]+$/.test(branchName)) {
        throw new BadRequestException('Invalid branch name. Only alphanumeric characters, /, _, and - are allowed.');
      }

      // Create branch from base branch if specified
      const baseBranch = dto.baseBranch || 'HEAD';

      await this.executeGitCommand(agentEntity.containerId, `checkout -b ${this.escapePath(branchName)} ${baseBranch}`);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error creating branch for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to create branch: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Delete a branch.
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to delete
   */
  async deleteBranch(agentId: string, branch: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      // Check if it's the current branch
      const currentBranchOutput = await this.executeGitCommand(agentEntity.containerId, 'rev-parse --abbrev-ref HEAD');
      const currentBranch = this.cleanBranchName(currentBranchOutput);
      const cleanBranchName = this.cleanBranchName(branch);

      if (currentBranch === cleanBranchName) {
        throw new BadRequestException('Cannot delete the current branch');
      }

      await this.executeGitCommand(agentEntity.containerId, `branch -D ${this.escapePath(cleanBranchName)}`);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error deleting branch for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to delete branch: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Resolve a merge conflict.
   * @param agentId - The UUID of the agent
   * @param dto - Conflict resolution DTO
   */
  async resolveConflict(agentId: string, dto: ResolveConflictDto): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    try {
      const escapedPath = this.escapePath(dto.path);

      switch (dto.strategy) {
        case 'yours':
          // Accept incoming (theirs)
          await this.executeGitCommand(agentEntity.containerId, `checkout --theirs ${escapedPath}`);
          await this.executeGitCommand(agentEntity.containerId, `add ${escapedPath}`);
          break;
        case 'mine':
          // Accept current (ours)
          await this.executeGitCommand(agentEntity.containerId, `checkout --ours ${escapedPath}`);
          await this.executeGitCommand(agentEntity.containerId, `add ${escapedPath}`);
          break;
        case 'both':
          // Keep both (manual resolution required - user edits file, then stages)
          // Just stage the file after user edits
          await this.executeGitCommand(agentEntity.containerId, `add ${escapedPath}`);
          break;
        default:
          throw new BadRequestException(`Unknown conflict resolution strategy: ${dto.strategy}`);
      }

      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error resolving conflict for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to resolve conflict: ${err.message || 'Unknown error'}`);
    }
  }

  /**
   * Fetch, checkout `baseBranch`, hard-reset to `origin/baseBranch`, and clean untracked files.
   * Intended for autonomous ticket orchestration after access checks upstream.
   */
  async prepareCleanWorkspace(agentId: string, baseBranch: string): Promise<void> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const b = baseBranch.trim();

    if (!/^[a-zA-Z0-9/_-]+$/.test(b)) {
      throw new BadRequestException('Invalid base branch name');
    }

    const containerId = agentEntity.containerId;
    const escaped = this.escapePath(b);

    try {
      await this.executeGitCommand(containerId, 'fetch origin', this.BASE_PATH, false, true, true);
      await this.executeGitCommand(containerId, `checkout ${escaped}`, this.BASE_PATH, false, true, true);
      await this.executeGitCommand(containerId, `reset --hard origin/${escaped}`, this.BASE_PATH, false, true, true);
      await this.executeGitCommand(containerId, 'clean -fd', this.BASE_PATH, false, true, true);
      this.notifyGitStateMayHaveChanged(agentId);
    } catch (error: unknown) {
      const err = error as { message?: string };

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`prepareCleanWorkspace failed for agent ${agentId}: ${err.message}`);
      throw new BadRequestException(`Failed to prepare clean workspace: ${err.message || 'Unknown error'}`);
    }
  }
}
