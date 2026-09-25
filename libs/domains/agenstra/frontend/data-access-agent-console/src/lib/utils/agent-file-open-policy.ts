import {
  AGENT_FILE_MAX_ASSEMBLED_BYTES,
  AGENT_FILE_MAX_CHUNK_BYTES,
  type FileProbeDto,
} from '../state/files/files.types';

/**
 * Whether opening a file should follow HEAD with a full GET body.
 * Skips body for opaque binary; keeps text under the single-chunk editor budget;
 * allows media (pdf/image/audio/video) up to the assembled upload ceiling for preview.
 */
export function shouldFetchFileBodyOnOpen(probe: FileProbeDto): boolean {
  if (probe.fileType === 'binary') {
    return false;
  }

  if (probe.size > AGENT_FILE_MAX_ASSEMBLED_BYTES) {
    return false;
  }

  if (probe.fileType === 'text' && probe.size > AGENT_FILE_MAX_CHUNK_BYTES) {
    return false;
  }

  return true;
}
