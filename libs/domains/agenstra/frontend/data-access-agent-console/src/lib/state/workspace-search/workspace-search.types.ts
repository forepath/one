export type WorkspaceIndexStatusState = 'missing' | 'indexing' | 'ready' | 'error';

/** Full = path + content; files = path / file name only. */
export type WorkspaceSearchMode = 'full' | 'files';

export interface WorkspaceIndexStatusDto {
  status: WorkspaceIndexStatusState;
  docCount: number;
  message?: string | null;
}

export interface WorkspaceSearchMatchDto {
  line: number;
  snippet: string;
}

export interface WorkspaceSearchHitDto {
  path: string;
  fileName: string;
  fileType: string;
  size: number;
  /** Content matches (full mode). Empty/omitted when only the path matched. */
  matches?: WorkspaceSearchMatchDto[];
  /** First match snippet (compat); prefer `matches`. */
  snippet?: string | null;
  /** First match line (compat); prefer `matches`. */
  line?: number | null;
}

export interface WorkspaceSearchResponseDto {
  status: WorkspaceIndexStatusState;
  hits: WorkspaceSearchHitDto[];
  total: number;
}
