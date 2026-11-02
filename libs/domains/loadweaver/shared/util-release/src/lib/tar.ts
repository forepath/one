/**
 * A minimal streaming tar (ustar / pax) reader and writer for release bundles (3.26): regular files and directories
 * only, so a bundle can never carry links or device files. Written here instead of adding a dependency; the format
 * subset is small and fully covered by the unit tests.
 */

const BLOCK = 512;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export interface TarEntry {
  /** Normalized path (no leading `./`). */
  name: string;
  size: number;
  type: 'file' | 'directory';
  mode: number;
  /** The entry's bytes; must be consumed (or `skip`ped) before the next entry is read. */
  body: AsyncIterable<Buffer>;
}

export interface TarReadOptions {
  /** Largest accepted entry (bytes); bigger entries fail the read. */
  maxEntryBytes?: number;
}

function octal(field: Buffer): number {
  const text = field
    .toString('ascii')
    .replace(/\0[\s\S]*$/, '')
    .trim();

  if (text === '') return 0;

  if (!/^[0-7]+$/.test(text)) throw new Error('tar: invalid numeric field');

  return parseInt(text, 8);
}

function cString(field: Buffer): string {
  const end = field.indexOf(0);

  return textDecoder.decode(end >= 0 ? field.subarray(0, end) : field);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;

  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];

  return sum === octal(header.subarray(148, 156));
}

/** Safe relative entry names only: no absolute paths, no `..`, no empty segments. */
export function normalizeEntryName(name: string): string {
  const trimmed = name.replace(/^(\.\/)+/, '').replace(/\/+$/, '');

  if (
    trimmed === '' ||
    trimmed.startsWith('/') ||
    trimmed.split('/').some((s) => s === '' || s === '.' || s === '..') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\\]/.test(trimmed)
  )
    throw new Error(`tar: unsafe entry name ${JSON.stringify(name)}`);

  return trimmed;
}

/** Parses pax records (`<len> key=value\n`). */
function paxRecords(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;

  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);

    if (space < 0) break;

    const length = Number(data.subarray(offset, space).toString('ascii'));

    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length)
      throw new Error('tar: bad pax record');

    const record = textDecoder.decode(data.subarray(space + 1, offset + length - 1));
    const eq = record.indexOf('=');

    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);

    offset += length;
  }

  return records;
}

/** Buffers a byte source so exact amounts can be read from it. */
class ByteReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private done = false;
  private readonly iterator: AsyncIterator<Uint8Array | string>;

  constructor(source: AsyncIterable<Uint8Array | string>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(min: number): Promise<void> {
    while (this.buffered < min && !this.done) {
      const next = await this.iterator.next();

      if (next.done) {
        this.done = true;
        break;
      }

      const chunk = typeof next.value === 'string' ? Buffer.from(next.value) : Buffer.from(next.value);

      if (chunk.length === 0) continue;

      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
  }

  /** Exactly `n` bytes, or fewer at the end of the source. */
  async read(n: number): Promise<Buffer> {
    await this.fill(n);

    const out = Buffer.concat(this.chunks, this.buffered);
    const head = out.subarray(0, Math.min(n, out.length));
    const rest = out.subarray(head.length);

    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;

    return head;
  }

  /** Up to `max` bytes (at least one unless the source ended), without concatenating large chunks. */
  async some(max: number): Promise<Buffer> {
    await this.fill(1);

    if (this.buffered === 0) return Buffer.alloc(0);

    const first = this.chunks[0];

    if (first.length <= max) {
      this.chunks.shift();
      this.buffered -= first.length;

      return first;
    }

    this.chunks[0] = first.subarray(max);
    this.buffered -= max;

    return first.subarray(0, max);
  }

  async skip(n: number): Promise<void> {
    let left = n;

    while (left > 0) {
      const part = await this.some(Math.min(left, 1024 * 1024));

      if (part.length === 0) throw new Error('tar: truncated archive');

      left -= part.length;
    }
  }
}

/**
 * Reads a tar stream entry by entry. Each entry's `body` streams its bytes; unread bodies are skipped when the next
 * entry is requested. Links, devices and FIFOs are refused, as are unsafe names, bad header checksums and truncation.
 */
export async function* readTar(
  source: AsyncIterable<Uint8Array | string>,
  options: TarReadOptions = {},
): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  const maxEntryBytes = options.maxEntryBytes ?? Number.MAX_SAFE_INTEGER;
  let pending: { left: number; padding: number } | null = null;
  let longName: string | null = null;
  let pax: Record<string, string> = {};

  for (;;) {
    if (pending) {
      await reader.skip(pending.left + pending.padding);
      pending = null;
    }

    const header = await reader.read(BLOCK);

    if (header.length === 0) throw new Error('tar: archive ends without end-of-archive marker');

    if (header.length < BLOCK) throw new Error('tar: truncated header');

    if (header.every((b) => b === 0)) return;

    if (!checksumOk(header)) throw new Error('tar: header checksum mismatch');

    const typeflag = String.fromCharCode(header[156] || 0x30);
    const size = octal(header.subarray(124, 136));
    const padding = (BLOCK - (size % BLOCK)) % BLOCK;

    if (typeflag === 'x' || typeflag === 'L') {
      if (size > 64 * 1024) throw new Error('tar: extended header too large');

      const data = await reader.read(size);

      if (data.length < size) throw new Error('tar: truncated extended header');

      await reader.skip(padding);

      if (typeflag === 'x') pax = paxRecords(data);
      else longName = cString(data);

      continue;
    }

    if (typeflag === 'g') {
      await reader.skip(size + padding);
      continue;
    }

    const prefix = cString(header.subarray(345, 500));
    const rawName =
      pax['path'] ??
      longName ??
      (prefix ? `${prefix}/${cString(header.subarray(0, 100))}` : cString(header.subarray(0, 100)));
    const entrySize = pax['size'] !== undefined ? Number(pax['size']) : size;

    longName = null;
    pax = {};

    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '5')
      throw new Error(`tar: entry ${JSON.stringify(rawName)} is not a regular file or directory`);

    if (!Number.isSafeInteger(entrySize) || entrySize < 0) throw new Error('tar: invalid entry size');

    if (entrySize > maxEntryBytes) throw new Error(`tar: entry ${JSON.stringify(rawName)} exceeds the size limit`);

    const name = normalizeEntryName(rawName);
    const state = { left: entrySize, padding: (BLOCK - (entrySize % BLOCK)) % BLOCK };

    pending = state;

    const body = async function* (): AsyncGenerator<Buffer> {
      while (state.left > 0) {
        const part = await reader.some(Math.min(state.left, 1024 * 1024));

        if (part.length === 0) throw new Error('tar: truncated entry');

        state.left -= part.length;
        yield part;
      }
    };

    yield {
      name,
      size: entrySize,
      type: typeflag === '5' ? 'directory' : 'file',
      mode: octal(header.subarray(100, 108)) & 0o7777,
      body: body(),
    };
  }
}

/** Collects an entry body (small entries: manifest, signature). */
export async function readAll(body: AsyncIterable<Buffer>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of body) {
    size += chunk.length;

    if (size > maxBytes) throw new Error('entry too large');

    chunks.push(chunk);
  }

  return Buffer.concat(chunks, size);
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}

/** A ustar header for a regular file (`name` up to 255 bytes, split into prefix / name at a slash). */
export function tarHeader(name: string, size: number, options: { mode?: number; mtime?: number } = {}): Buffer {
  const normalized = normalizeEntryName(name);
  const bytes = Buffer.from(normalized, 'utf8');
  let prefix = '';
  let base = normalized;

  if (bytes.length > 100) {
    const cut = normalized.lastIndexOf('/', normalized.length - 1);
    let split = -1;

    for (let i = cut; i > 0; i = normalized.lastIndexOf('/', i - 1)) {
      if (Buffer.byteLength(normalized.slice(0, i)) <= 155 && Buffer.byteLength(normalized.slice(i + 1)) <= 100) {
        split = i;
        break;
      }
    }

    if (split < 0) throw new Error(`tar: name too long: ${normalized}`);

    prefix = normalized.slice(0, split);
    base = normalized.slice(split + 1);
  }

  if (size > 0o77777777777) throw new Error('tar: entry too large for ustar');

  const header = Buffer.alloc(BLOCK, 0);

  header.write(base, 0, 100, 'utf8');
  writeOctal(header, 100, 8, options.mode ?? 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, options.mtime ?? 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');

  let sum = 0;

  for (const b of header) sum += b;

  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

  return header;
}

/** Zero padding after an entry of `size` bytes. */
export function tarPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK, 0);
}

/** The end-of-archive marker (two zero blocks). */
export const TAR_END = Buffer.alloc(2 * BLOCK, 0);

/** A complete in-memory tar (tests, small bundles). */
export function buildTar(entries: { name: string; data: Buffer | string; mode?: number }[]): Buffer {
  const parts: Buffer[] = [];

  for (const e of entries) {
    const data = typeof e.data === 'string' ? Buffer.from(e.data) : e.data;

    parts.push(tarHeader(e.name, data.length, { mode: e.mode }), data, tarPadding(data.length));
  }

  parts.push(TAR_END);

  return Buffer.concat(parts);
}
