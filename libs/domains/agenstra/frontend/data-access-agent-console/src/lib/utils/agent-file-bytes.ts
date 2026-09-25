import type { AgentFileType, FileContentDto, WriteFileDto } from '../state/files/files.types';

/**
 * Encode an ArrayBuffer as a base64 string (browser-safe).
 * Avoids String.fromCharCode spread which overflows the call stack on large chunks.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let chunkBinary = '';

    for (let i = 0; i < chunk.length; i++) {
      chunkBinary += String.fromCharCode(chunk[i]);
    }

    binary += chunkBinary;
  }

  return btoa(binary);
}

/**
 * Decode a base64 string to an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Encode UTF-8 text as an ArrayBuffer.
 */
export function utf8ToArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);

  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

/**
 * Decode an ArrayBuffer as UTF-8 text.
 */
export function arrayBufferToUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * Map MIME type (or content-type) to an AgentFileType hint for uploads.
 */
export function mimeToAgentFileType(mime: string | undefined | null): AgentFileType | undefined {
  if (!mime) {
    return undefined;
  }

  const normalized = mime.toLowerCase().split(';')[0].trim();

  if (normalized === 'application/pdf') {
    return 'pdf';
  }

  if (normalized.startsWith('image/')) {
    return 'image';
  }

  if (normalized.startsWith('video/')) {
    return 'video';
  }

  if (normalized.startsWith('audio/')) {
    return 'audio';
  }

  if (normalized.startsWith('text/') || normalized === 'application/json' || normalized === 'application/xml') {
    return 'text';
  }

  return 'binary';
}

/**
 * Build NgRx metadata from a WriteFileDto (no body bytes — caller stores via AgentFileBodyStore).
 */
export function writeFileDtoToFileContent(dto: WriteFileDto, bodyRef?: string | null): FileContentDto {
  const fileType: AgentFileType = dto.fileType ?? 'binary';
  const contentType = dto.contentType ?? 'application/octet-stream';
  const text = fileType === 'text' ? arrayBufferToUtf8(dto.bytes) : undefined;

  return {
    fileType,
    contentType,
    text,
    size: dto.bytes.byteLength,
    bodyRef: bodyRef ?? null,
    bodyOmitted: !bodyRef,
    revision: Date.now(),
  };
}
