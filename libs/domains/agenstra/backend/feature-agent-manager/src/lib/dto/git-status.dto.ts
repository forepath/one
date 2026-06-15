/**
 * DTO for git status response.
 * Represents the current state of the git repository.
 */
export class GitStatusDto {
  /**
   * Current branch name.
   */
  currentBranch!: string;

  /**
   * Whether the working tree is clean (no changes).
   */
  isClean!: boolean;

  /**
   * Whether there are unpushed commits (ahead of remote).
   */
  hasUnpushedCommits!: boolean;

  /**
   * Number of commits ahead of remote.
   */
  aheadCount!: number;

  /**
   * Number of commits behind remote.
   */
  behindCount!: number;

  /**
   * List of files with their git status.
   */
  files!: GitFileStatusDto[];
}

/**
 * DTO for individual file git status.
 */
export class GitFileStatusDto {
  /**
   * File path relative to repository root.
   */
  path!: string;

  /**
   * Git status code (e.g., 'M', 'A', 'D', '??', 'MM', etc.).
   * See git status --porcelain format.
   */
  status!: string;

  /**
   * Status type: 'staged', 'unstaged', 'untracked', 'both'.
   */
  type!: 'staged' | 'unstaged' | 'untracked' | 'both';

  /**
   * Whether this is a binary file.
   */
  isBinary?: boolean;

  /**
   * File size in bytes (for binary files).
   */
  size?: number;
}
