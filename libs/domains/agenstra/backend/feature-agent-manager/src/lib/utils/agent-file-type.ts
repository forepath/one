/**
 * Server-authoritative file classification for agent workspace files.
 */
export type AgentFileType = 'text' | 'binary' | 'pdf' | 'image' | 'video' | 'audio';

export interface ClassifiedFile {
  fileType: AgentFileType;
  contentType: string;
}

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const VIDEO_EXT_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

const AUDIO_EXT_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};

function extensionOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');

  if (dot < 0) {
    return '';
  }

  return base.slice(dot).toLowerCase();
}

function startsWithBytes(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) {
    return false;
  }

  return bytes.every((b, i) => buffer[i] === b);
}

function looksLikeSvg(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf-8').trimStart().toLowerCase();

  return sample.startsWith('<svg') || sample.startsWith('<?xml');
}

function looksLikeMp4(buffer: Buffer): boolean {
  // ISO BMFF: size(4) + 'ftyp'
  return buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

function looksLikeWav(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  );
}

function looksLikeMp3(buffer: Buffer): boolean {
  if (startsWithBytes(buffer, [0x49, 0x44, 0x33])) {
    // ID3
    return true;
  }

  // MPEG frame sync 0xFFEx
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

/**
 * Classify file bytes (+ path) into AgentFileType and a concrete Content-Type.
 */
export function classifyAgentFile(filePath: string, buffer: Buffer): ClassifiedFile {
  const ext = extensionOf(filePath);

  if (ext === '.pdf' || buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { fileType: 'pdf', contentType: 'application/pdf' };
  }

  const videoMime = VIDEO_EXT_MIME[ext];
  const audioMime = AUDIO_EXT_MIME[ext];

  // Prefer explicit extensions before shared container magics (e.g. ftyp for mp4/m4a).
  if (videoMime) {
    return { fileType: 'video', contentType: videoMime };
  }

  if (audioMime) {
    return { fileType: 'audio', contentType: audioMime };
  }

  if (looksLikeMp4(buffer) || startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    // WebM/Matroska EBML header 1A 45 DF A3
    if (looksLikeMp4(buffer)) {
      return { fileType: 'video', contentType: 'video/mp4' };
    }

    return { fileType: 'video', contentType: 'video/webm' };
  }

  if (
    looksLikeWav(buffer) ||
    looksLikeMp3(buffer) ||
    startsWithBytes(buffer, [0x66, 0x4c, 0x61, 0x43]) || // fLaC
    startsWithBytes(buffer, [0x4f, 0x67, 0x67, 0x53]) // OggS
  ) {
    if (looksLikeWav(buffer)) {
      return { fileType: 'audio', contentType: 'audio/wav' };
    }

    if (startsWithBytes(buffer, [0x66, 0x4c, 0x61, 0x43])) {
      return { fileType: 'audio', contentType: 'audio/flac' };
    }

    if (startsWithBytes(buffer, [0x4f, 0x67, 0x67, 0x53])) {
      return { fileType: 'audio', contentType: 'audio/ogg' };
    }

    return { fileType: 'audio', contentType: 'audio/mpeg' };
  }

  const imageMime = IMAGE_EXT_MIME[ext];

  if (
    imageMime ||
    startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWithBytes(buffer, [0xff, 0xd8, 0xff]) ||
    startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38]) ||
    startsWithBytes(buffer, [0x42, 0x4d]) ||
    (startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      buffer.length >= 12 &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') ||
    looksLikeSvg(buffer)
  ) {
    if (imageMime) {
      return { fileType: 'image', contentType: imageMime };
    }

    if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47])) {
      return { fileType: 'image', contentType: 'image/png' };
    }

    if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
      return { fileType: 'image', contentType: 'image/jpeg' };
    }

    if (startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38])) {
      return { fileType: 'image', contentType: 'image/gif' };
    }

    if (startsWithBytes(buffer, [0x42, 0x4d])) {
      return { fileType: 'image', contentType: 'image/bmp' };
    }

    if (looksLikeSvg(buffer)) {
      return { fileType: 'image', contentType: 'image/svg+xml' };
    }

    return { fileType: 'image', contentType: 'image/webp' };
  }

  // Empty files are editable text
  if (buffer.length === 0) {
    return { fileType: 'text', contentType: 'text/plain; charset=utf-8' };
  }

  try {
    const textContent = buffer.toString('utf-8');
    const sampleSize = Math.min(512, textContent.length);
    const sample = textContent.substring(0, sampleSize);
    let controlCharCount = 0;

    for (let i = 0; i < sample.length; i++) {
      const charCode = sample.charCodeAt(i);

      if (
        (charCode >= 0 && charCode <= 8) ||
        charCode === 11 ||
        charCode === 12 ||
        (charCode >= 14 && charCode <= 31) ||
        (charCode >= 127 && charCode <= 159)
      ) {
        controlCharCount++;
      }
    }

    if (controlCharCount / sampleSize <= 0.1) {
      return { fileType: 'text', contentType: 'text/plain; charset=utf-8' };
    }
  } catch {
    // fall through to binary
  }

  return { fileType: 'binary', contentType: 'application/octet-stream' };
}

export function parseContentRangeHeader(
  header: string | undefined,
): { start: number; end: number; total: number } | null {
  if (!header) {
    return null;
  }

  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header.trim());

  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) {
    return null;
  }

  if (start < 0 || end < start || total <= 0 || end >= total) {
    return null;
  }

  return { start, end, total };
}

export function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) {
    return null;
  }

  const match = /^bytes\s*=\s*(\d*)-(\d*)$/i.exec(header.trim());

  if (!match) {
    return 'unsatisfiable';
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (startRaw === '' && endRaw === '') {
    return 'unsatisfiable';
  }

  let start: number;
  let end: number;

  if (startRaw === '') {
    // suffix: last N bytes
    const suffix = Number(endRaw);

    if (!Number.isFinite(suffix) || suffix <= 0) {
      return 'unsatisfiable';
    }

    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return 'unsatisfiable';
  }

  end = Math.min(end, size - 1);

  return { start, end };
}

export function contentDispositionAttachment(filePath: string): string {
  const basename = filePath.split(/[/\\]/).pop() || 'download';
  const escaped = basename.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const encoded = encodeURIComponent(basename);

  return `attachment; filename="${escaped}"; filename*=UTF-8''${encoded}`;
}
