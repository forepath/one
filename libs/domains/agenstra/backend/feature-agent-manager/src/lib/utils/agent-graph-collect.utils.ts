import { AGENT_GRAPH_EXCLUDED_DIRECTORIES, normalizeAgentGraphRelativePath } from './agent-graph-files.utils';
import type { AgentGraphListedEntry } from './agent-graph-builder.utils';

/**
 * Worker-side commands and their output parsers for environment graphs. Both commands only read: a `find` listing
 * and a `tar` stream to stdout. Nothing is written into the container and the archive is parsed in memory (never
 * extracted), so hostile file names / archive members cannot touch the manager's file system.
 */

/** `find` listing of the working directory: `F\tsize\tmtime\tpath`, `D\tpath`, `X\tpath` (excluded dir), NUL separated. */
export function buildAgentGraphListingCommand(workingDirectory: string, maxEntries: number): string[] {
  const excluded = AGENT_GRAPH_EXCLUDED_DIRECTORIES.map((name) => `-name '${name}'`).join(' -o ');
  const script =
    `cd -- "$1" || exit 3; ` +
    `find . -mindepth 1 -xdev \\( -type d \\( ${excluded} \\) -printf 'X\\t%P\\0' -prune \\) ` +
    `-o \\( -type f -printf 'F\\t%s\\t%T@\\t%P\\0' \\) ` +
    `-o \\( -type d -printf 'D\\t%P\\0' \\) 2>/dev/null | head -z -n "$2"; exit 0`;

  return ['sh', '-c', script, 'sh', workingDirectory, String(Math.max(1, Math.floor(maxEntries)))];
}

export function parseAgentGraphListing(output: Buffer): AgentGraphListedEntry[] {
  const entries: AgentGraphListedEntry[] = [];

  for (const record of output.toString('utf8').split('\0')) {
    if (!record) {
      continue;
    }

    const kind = record[0];
    const fields = record.split('\t');

    if (kind === 'F' && fields.length >= 4) {
      const path = normalizeAgentGraphRelativePath(fields.slice(3).join('\t'));
      const size = Number(fields[1]);
      const mtime = Math.floor(Number(fields[2]));

      if (path) {
        entries.push({
          path,
          kind: 'file',
          size: Number.isFinite(size) ? size : 0,
          mtime: Number.isFinite(mtime) ? mtime : 0,
        });
      }
    } else if ((kind === 'D' || kind === 'X') && fields.length >= 2) {
      const path = normalizeAgentGraphRelativePath(fields.slice(1).join('\t'));

      if (path) {
        entries.push({ path, kind: kind === 'D' ? 'dir' : 'excluded' });
      }
    }
  }

  return entries;
}

/** Linux keeps single argv strings below 128 KiB and the whole argv below ~2 MiB; stay far below both. */
const MAX_ARCHIVE_ARGS_BYTES = 96 * 1024;
const MAX_ARCHIVE_ARGS = 500;

/** Split paths into batches that fit one `tar` exec's argv. */
export function batchAgentGraphArchivePaths(paths: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;

  for (const path of paths) {
    const size = Buffer.byteLength(path) + 3;

    if (current.length > 0 && (current.length >= MAX_ARCHIVE_ARGS || bytes + size > MAX_ARCHIVE_ARGS_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }

    current.push(path);
    bytes += size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/**
 * `tar` stream of the given regular files (relative to the working directory). Symbolic links are archived as links
 * (never followed) and skipped by the parser. Exit codes 1 / 2 (file changed / vanished) still yield usable output.
 */
export function buildAgentGraphArchiveCommand(workingDirectory: string, paths: string[]): string[] {
  return [
    'sh',
    '-c',
    'cd -- "$1" || exit 3; shift; exec tar -cf - --no-recursion -- "$@" 2>/dev/null',
    'sh',
    workingDirectory,
    ...paths.map((path) => `./${path}`),
  ];
}

export const AGENT_GRAPH_ARCHIVE_ACCEPTED_EXIT_CODES = [0, 1, 2];

function readString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);

  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8');
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const slice = block.subarray(offset, offset + length);

  // Base-256 (GNU) sizes only occur for files > 8 GiB, far above any parse limit.
  if (slice[0] & 0x80) {
    return Number.MAX_SAFE_INTEGER;
  }

  const text = readString(block, offset, length).trim();

  return text ? parseInt(text, 8) : 0;
}

function parsePaxPath(data: Buffer): string | undefined {
  const text = data.toString('utf8');
  let index = 0;

  while (index < text.length) {
    const space = text.indexOf(' ', index);

    if (space === -1) {
      break;
    }

    const length = parseInt(text.slice(index, space), 10);

    if (!Number.isFinite(length) || length <= 0) {
      break;
    }

    const record = text.slice(space + 1, index + length - 1);

    if (record.startsWith('path=')) {
      return record.slice(5);
    }

    index += length;
  }

  return undefined;
}

/**
 * Regular-file members of a (possibly truncated) ustar / GNU / pax archive as `relative path → UTF-8 text`.
 * Members larger than `maxFileBytes`, binary members (NUL bytes) and links are skipped.
 */
export function parseAgentGraphArchive(archive: Buffer, maxFileBytes: number): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  let longName: string | undefined;
  let paxName: string | undefined;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!Number.isFinite(size) || size < 0 || dataEnd > archive.length) {
      break;
    }

    const data = archive.subarray(dataStart, dataEnd);

    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = readString(data, 0, data.length);
      continue;
    }

    if (type === 'x') {
      paxName = parsePaxPath(data);
      continue;
    }

    if (type === 'g') {
      continue;
    }

    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const rawPath = longName ?? paxName ?? (prefix ? `${prefix}/${name}` : name);

    longName = undefined;
    paxName = undefined;

    if ((type !== '0' && type !== '7') || size > maxFileBytes) {
      continue;
    }

    const path = normalizeAgentGraphRelativePath(rawPath);

    if (!path || data.includes(0)) {
      continue;
    }

    files.set(path, data.toString('utf8'));
  }

  return files;
}
