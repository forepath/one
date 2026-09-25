// Types based on OpenAPI spec - File System Operations

/** Filesystem root for API calls: workspace (`app`) vs provider agent config (`config`). */
export type FileManagerContext = 'app' | 'config';

/** Logical file kind returned by the controller (`X-File-Type`). */
export type AgentFileType = 'text' | 'binary' | 'pdf' | 'image' | 'video' | 'audio';

export interface FileContentDto {
  fileType: AgentFileType;
  contentType: string;
  /** UTF-8 text when fileType === 'text'; omit/empty for media. */
  text?: string;
  size: number;
  /**
   * Opaque key into {@link AgentFileBodyStore} for binary/media (and text round-trip).
   * Absent when `bodyOmitted` or body could not be stored.
   */
  bodyRef?: string | null;
  /** True when open used HEAD only, or body exceeded durable/RAM storage limits. */
  bodyOmitted?: boolean;
  /**
   * Client-side generation for the body behind bodyRef.
   * Bumps on every successful read/write so previews reload when the key is unchanged.
   */
  revision?: number;
}

/** Metadata from HEAD probe before optionally fetching the body. */
export interface FileProbeDto {
  fileType: AgentFileType;
  contentType: string;
  size: number;
}

export interface FileNodeDto {
  name: string;
  type: 'file' | 'directory';
  path: string; // Relative path from /app
  size?: number; // File size in bytes (only for files)
  modifiedAt?: string; // ISO 8601 timestamp
}

export interface WriteFileDto {
  bytes: ArrayBuffer;
  fileType?: AgentFileType;
  contentType?: string;
}

export interface CreateFileDto {
  type: 'file' | 'directory';
}

export interface MoveFileDto {
  destination: string; // Destination path relative to /app (supports nested paths)
}

export interface ListDirectoryParams {
  path?: string; // Directory path relative to context root (defaults to '.')
  /** When `config`, server requires workspace management rights. */
  context?: FileManagerContext;
}

/** Max bytes for a single PUT / chunk (matches manager policy). */
export const AGENT_FILE_MAX_CHUNK_BYTES = 10 * 1024 * 1024;

/** Max assembled size for chunked uploads (matches manager policy). */
export const AGENT_FILE_MAX_ASSEMBLED_BYTES = 100 * 1024 * 1024;

/** Preferred FE chunk size for multi-part uploads (within 1–4MB). */
export const AGENT_FILE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
