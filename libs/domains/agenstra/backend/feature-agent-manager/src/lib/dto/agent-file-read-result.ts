import type { AgentFileType } from '../utils/agent-file-type';

/**
 * Result of reading a file from an agent container (raw bytes + classification).
 */
export interface AgentFileReadResult {
  buffer: Buffer;
  fileType: AgentFileType;
  contentType: string;
  size: number;
}

/**
 * Lightweight file metadata for HEAD probes (no body transfer).
 */
export interface AgentFileProbeResult {
  fileType: AgentFileType;
  contentType: string;
  size: number;
}
