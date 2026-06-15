// Types based on backend DTOs
export type GitFileStatusType = 'staged' | 'unstaged' | 'untracked' | 'both';

export interface GitFileStatus {
  path: string;
  status: string;
  type: GitFileStatusType;
  isBinary?: boolean;
  size?: number;
}

export interface GitStatus {
  currentBranch: string;
  isClean: boolean;
  hasUnpushedCommits: boolean;
  aheadCount: number;
  behindCount: number;
  files: GitFileStatus[];
}

export interface GitBranch {
  name: string;
  ref: string;
  isCurrent: boolean;
  isRemote: boolean;
  remote?: string;
  commit: string;
  message: string;
  aheadCount?: number;
  behindCount?: number;
}

export interface GitDiff {
  path: string;
  originalContent: string;
  modifiedContent: string;
  encoding: 'utf-8' | 'base64';
  isBinary: boolean;
  originalSize?: number;
  modifiedSize?: number;
}

export interface StageFilesDto {
  files: string[];
}

export interface UnstageFilesDto {
  files: string[];
}

export interface CommitDto {
  message: string;
}

export interface RebaseDto {
  branch: string;
}

export interface CreateBranchDto {
  name: string;
  useConventionalPrefix?: boolean;
  conventionalType?: 'feat' | 'fix' | 'chore' | 'docs' | 'style' | 'refactor' | 'test' | 'perf';
  baseBranch?: string;
}

export interface ResolveConflictDto {
  path: string;
  strategy: 'yours' | 'mine' | 'both';
}
