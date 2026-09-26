export const WORKSPACE_FILES_ENTITY = 'workspace-files';

export type WorkspaceIndexStatusState = 'missing' | 'indexing' | 'ready' | 'error';

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

export interface WorkspaceIndexPathChange {
  path: string;
  op: 'upsert' | 'delete';
}

export const WORKSPACE_FILES_MAPPINGS: Record<string, unknown> = {
  properties: {
    clientId: { type: 'keyword' },
    agentId: { type: 'keyword' },
    path: { type: 'keyword', fields: { text: { type: 'text' } } },
    pathParts: { type: 'keyword' },
    fileName: { type: 'keyword', fields: { text: { type: 'text' } } },
    content: { type: 'text' },
    fileType: { type: 'keyword' },
    size: { type: 'long' },
    mtime: { type: 'date' },
    indexedAt: { type: 'date' },
    contentOmitted: { type: 'boolean' },
  },
};

/** Full search: path, file name, and text content. */
export const WORKSPACE_SEARCH_TEXT_FIELDS = ['path.text', 'fileName.text', 'content'];

/** File-path search only (substring match on path / file name, no content). */
export const WORKSPACE_SEARCH_PATH_FIELDS = ['path.text', 'fileName.text'];

export type WorkspaceSearchMode = 'full' | 'files';

/** Soft cap for indexed text bodies (~10MB). */
export const WORKSPACE_INDEX_CONTENT_MAX_BYTES = 10 * 1024 * 1024;
