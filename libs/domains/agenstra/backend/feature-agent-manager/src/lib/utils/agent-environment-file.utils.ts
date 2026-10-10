/**
 * Mounted agent environment contract shared by the agent manager and the worker image.
 *
 * Images that carry {@link AGENT_ENVIRONMENT_IMAGE_LABEL} read {@link AGENT_ENVIRONMENT_FILE_PATH} in their
 * entrypoint (NUL-separated `KEY=VALUE` entries) and export every entry before starting any process.
 * The file lives on a per-container named volume so it survives restarts without being part of `Config.Env`.
 */
export const AGENT_ENVIRONMENT_IMAGE_LABEL = 'io.agenstra.environment-mount';
export const AGENT_ENVIRONMENT_IMAGE_LABEL_VERSION = '1';
export const AGENT_ENVIRONMENT_VOLUME_LABEL = 'io.agenstra.environment-volume';
export const AGENT_ENVIRONMENT_VOLUME_PREFIX = 'agenstra-env-';
export const AGENT_ENVIRONMENT_MOUNT_TARGET = '/etc/agenstra/environment';
export const AGENT_ENVIRONMENT_FILE_NAME = 'environment';
export const AGENT_ENVIRONMENT_FILE_PATH = `${AGENT_ENVIRONMENT_MOUNT_TARGET}/${AGENT_ENVIRONMENT_FILE_NAME}`;
/** Upper bound for the environment file (Linux caps argv + envp of a single exec at a few MiB anyway). */
export const AGENT_ENVIRONMENT_FILE_MAX_BYTES = 4 * 1024 * 1024;

const TAR_BLOCK_SIZE = 512;

/**
 * Conventional variable names (plus `.` and `-`, which some tools use). Rejects everything that could be
 * misread by the environment file format or a consumer: `=`/NUL separators, option-like names (`-i`) and
 * exported Bash functions (`BASH_FUNC_name%%`), which Bash would import as executable code.
 * The worker entrypoint applies the same rule.
 */
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Throws when a variable name does not match {@link ENVIRONMENT_VARIABLE_NAME_PATTERN}. */
export function assertValidEnvironmentVariableName(name: string): void {
  if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid environment variable name '${name.replace(/\0/g, '\\0')}'`);
  }
}

/**
 * Serializes an environment map into the NUL-separated `KEY=VALUE` file format.
 * Keys are sorted so identical environments produce identical files.
 */
export function serializeEnvironmentFile(env: Record<string, string>): Buffer {
  const entries = Object.keys(env)
    .sort()
    .map((key) => {
      assertValidEnvironmentVariableName(key);
      const value = env[key] ?? '';

      if (value.includes('\0')) {
        throw new Error(`Environment variable '${key}' must not contain NUL characters`);
      }

      return `${key}=${value}\0`;
    });

  return Buffer.from(entries.join(''), 'utf-8');
}

/** Parses the NUL-separated `KEY=VALUE` file format; malformed entries are ignored. */
export function parseEnvironmentFile(content: Buffer | string): Record<string, string> {
  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  const env: Record<string, string> = {};

  for (const entry of text.split('\0')) {
    const separator = entry.indexOf('=');

    if (separator <= 0 || entry.startsWith('-')) {
      continue;
    }

    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }

  return env;
}

/** Converts an environment map into Docker `KEY=VALUE` strings (e.g. exec `Env`). */
export function toDockerEnvList(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

/** Parses Docker `Config.Env` strings into a map (first `=` separates name and value). */
export function parseDockerEnvList(envList: readonly string[] | undefined | null): Record<string, string> {
  const env: Record<string, string> = {};

  for (const entry of envList ?? []) {
    const [key, ...valueParts] = entry.split('=');

    if (key) {
      env[key] = valueParts.join('=');
    }
  }

  return env;
}

function writeTarString(header: Buffer, value: string, offset: number, length: number): void {
  header.write(value, offset, Math.min(Buffer.byteLength(value), length), 'utf-8');
}

function writeTarOctal(header: Buffer, value: number, offset: number, length: number): void {
  writeTarString(header, `${value.toString(8).padStart(length - 1, '0')}\0`, offset, length);
}

/**
 * Builds a single-file ustar archive as expected by Docker's `PUT /containers/{id}/archive`.
 * Ownership is root (Docker ignores tar ownership unless `copyUIDGID` is requested).
 */
export function buildSingleFileTar(fileName: string, content: Buffer, mode = 0o600): Buffer {
  if (!fileName || fileName.includes('/') || Buffer.byteLength(fileName) > 100) {
    throw new Error(`Invalid tar entry name '${fileName}'`);
  }

  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);

  writeTarString(header, fileName, 0, 100);
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, content.length, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  writeTarString(header, 'ustar\0', 257, 6);
  writeTarString(header, '00', 263, 2);
  writeTarString(header, 'root', 265, 32);
  writeTarString(header, 'root', 297, 32);

  let checksum = 0;

  for (const byte of header) {
    checksum += byte;
  }

  writeTarString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);

  const padding = (TAR_BLOCK_SIZE - (content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;

  return Buffer.concat([header, content, Buffer.alloc(padding, 0), Buffer.alloc(TAR_BLOCK_SIZE * 2, 0)]);
}

function readTarOctal(block: Buffer, offset: number, length: number): number {
  const field = block.subarray(offset, offset + length).toString('ascii');
  const nul = field.indexOf('\0');
  const raw = (nul >= 0 ? field.slice(0, nul) : field).trim();

  if (!raw) {
    return 0;
  }

  if (!/^[0-7]+$/.test(raw)) {
    throw new Error('Unsupported tar header encoding');
  }

  return parseInt(raw, 8);
}

/**
 * Returns the content of the first regular file in a tar archive (as returned by Docker's
 * `GET /containers/{id}/archive` for a file path). PAX / GNU long-name meta entries are skipped.
 * @throws Error when the archive is malformed, has no regular file or the file exceeds `maxBytes`.
 */
export function extractFirstFileFromTar(archive: Buffer, maxBytes = AGENT_ENVIRONMENT_FILE_MAX_BYTES): Buffer {
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_SIZE);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const size = readTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + TAR_BLOCK_SIZE;
    const dataEnd = dataStart + size;

    if (dataEnd > archive.length) {
      throw new Error('Truncated tar archive');
    }

    if (type === '0' || type === '7') {
      if (size > maxBytes) {
        throw new Error(`Archived file exceeds ${maxBytes} bytes`);
      }

      return Buffer.from(archive.subarray(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  throw new Error('Tar archive does not contain a regular file');
}
