/**
 * DTO for git branch information.
 */
export class GitBranchDto {
  /**
   * Branch name (without refs/heads/ prefix).
   */
  name!: string;

  /**
   * Full branch reference (e.g., 'refs/heads/main').
   */
  ref!: string;

  /**
   * Whether this is the current branch.
   */
  isCurrent!: boolean;

  /**
   * Whether this is a remote branch.
   */
  isRemote!: boolean;

  /**
   * Remote name (if remote branch).
   */
  remote?: string;

  /**
   * Commit hash (short).
   */
  commit!: string;

  /**
   * Commit message (first line).
   */
  message!: string;

  /**
   * Number of commits ahead of remote (for local branches).
   */
  aheadCount?: number;

  /**
   * Number of commits behind remote (for local branches).
   */
  behindCount?: number;
}
