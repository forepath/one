/**
 * How the agent workspace Git repository is initialized at creation time.
 */
export enum GitRepositorySetupMode {
  CLONE = 'clone',
  EMPTY = 'empty',
}

export function resolveGitRepositorySetupMode(
  dtoMode?: GitRepositorySetupMode,
  envMode?: string,
): GitRepositorySetupMode {
  if (dtoMode === GitRepositorySetupMode.EMPTY || dtoMode === GitRepositorySetupMode.CLONE) {
    return dtoMode;
  }

  if (envMode === GitRepositorySetupMode.EMPTY) {
    return GitRepositorySetupMode.EMPTY;
  }

  return GitRepositorySetupMode.CLONE;
}
