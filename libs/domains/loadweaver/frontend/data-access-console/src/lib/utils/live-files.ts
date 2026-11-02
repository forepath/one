import type { TopologyGraph } from '../types/topology.types';
import type {
  LiveFileTarget,
  LiveFileType,
  LiveReplicaTarget,
  LiveTargets,
  LiveVolumeTarget,
} from '../types/live.types';

/** Whole uploads up to this size; larger files go in `Content-Range` chunks (3.19). */
export const LIVE_UPLOAD_WHOLE_MAX = 10 * 1024 * 1024;
/** The chunk size of larger uploads (each request at most 10 MB). */
export const LIVE_UPLOAD_CHUNK = 8 * 1024 * 1024;
/** Uploads, downloads and unranged reads stop at 100 MB. */
export const LIVE_FILE_MAX = 100 * 1024 * 1024;

const REPLICA_ID = /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/;
const VOLUME_ID = /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/;

/** A replica id `project/deployment/service/index`. */
export function isReplicaId(id: string | null | undefined): id is string {
  return !!id && REPLICA_ID.test(id);
}

/** A file target `replica:<id>` / `volume:<id>` with a valid id. */
export function isLiveFileTarget(value: string | null | undefined): value is LiveFileTarget {
  if (!value) return false;

  if (value.startsWith('replica:')) return REPLICA_ID.test(value.slice('replica:'.length));

  if (value.startsWith('volume:')) return VOLUME_ID.test(value.slice('volume:'.length));

  return false;
}

/** `/a/b` + `c` → `/a/b/c`. */
export function joinLivePath(directory: string, name: string): string {
  return `${normalizeLivePath(directory).replace(/\/$/, '')}/${name.replace(/^\/+/, '')}`;
}

/** Absolute, no duplicate or trailing slashes (except the root). */
export function normalizeLivePath(path: string | null | undefined): string {
  const parts = (path ?? '').split('/').filter((part) => part !== '' && part !== '.');

  return `/${parts.join('/')}`;
}

/** The parent directory (`/` for the root). */
export function parentLivePath(path: string): string {
  const parts = normalizeLivePath(path).split('/').filter(Boolean);

  return `/${parts.slice(0, -1).join('/')}`;
}

export function liveBaseName(path: string): string {
  return normalizeLivePath(path).split('/').filter(Boolean).at(-1) ?? '/';
}

/** Breadcrumbs of a path: the root, then each directory on the way. */
export function livePathCrumbs(path: string): { label: string; path: string }[] {
  const parts = normalizeLivePath(path).split('/').filter(Boolean);

  return [
    { label: '/', path: '/' },
    ...parts.map((part, i) => ({ label: part, path: `/${parts.slice(0, i + 1).join('/')}` })),
  ];
}

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
const VIDEO = ['mp4', 'webm', 'mov', 'mkv'];
const AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];
const TEXT = [
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'sh',
  'py',
  'go',
  'rs',
  'java',
  'sql',
  'log',
  'csv',
];

/** The API's `X-File-Type` rule (from the extension; no extension counts as text), for listings without a HEAD. */
export function liveFileType(path: string): LiveFileType {
  const name = liveBaseName(path);
  const ext = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';

  if (IMAGE.includes(ext)) return 'image';

  if (VIDEO.includes(ext)) return 'video';

  if (AUDIO.includes(ext)) return 'audio';

  if (ext === 'pdf') return 'pdf';

  if (TEXT.includes(ext) || !name.includes('.')) return 'text';

  return 'binary';
}

const LANGUAGES: Record<string, string> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sh: 'shell',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  toml: 'ini',
  js: 'javascript',
  ts: 'typescript',
  xml: 'xml',
  svg: 'xml',
  html: 'html',
  css: 'css',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sql: 'sql',
};

/** The editor language of a text file. */
export function liveFileLanguage(path: string): string {
  const name = liveBaseName(path);

  if (/^dockerfile$/i.test(name)) return 'dockerfile';

  const ext = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';

  return LANGUAGES[ext] ?? 'plaintext';
}

/** The `Content-Range` chunks of an upload (`bytes start-end/total`, end inclusive). */
export function uploadChunks(
  size: number,
  chunk = LIVE_UPLOAD_CHUNK,
): { start: number; end: number; header: string }[] {
  const chunks: { start: number; end: number; header: string }[] = [];

  for (let start = 0; start < size; start += chunk) {
    const end = Math.min(start + chunk, size) - 1;

    chunks.push({ start, end, header: `bytes ${start}-${end}/${size}` });
  }

  return chunks;
}

/** An upload id (`[A-Za-z0-9_-]{1,64}`) tying the chunks together. */
export function newUploadId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return random.slice(0, 64);
}

/** The full size from `Content-Range: bytes 0-1023/4096` (`null` without one). */
export function contentRangeTotal(header: string | null): number | null {
  const match = header ? /\/(\d+)\s*$/.exec(header) : null;

  return match ? Number(match[1]) : null;
}

/** Replicas, volumes and nodes the caller can see, from the (access-scoped) topology graph. */
export function liveTargetsFromTopology(graph: TopologyGraph): LiveTargets {
  const replicas: LiveReplicaTarget[] = [];
  const volumes: LiveVolumeTarget[] = [];
  const nodes: string[] = [];

  for (const element of graph.elements) {
    const id = element.id.slice(element.id.indexOf(':') + 1);

    if (element.kind === 'replica' && isReplicaId(id)) {
      const [project, deployment, service, index] = id.split('/');

      replicas.push({
        id,
        project,
        deployment,
        service,
        index: Number(index),
        node: element.parent?.startsWith('node:') ? element.parent.slice('node:'.length) : null,
        state: typeof element.data?.['state'] === 'string' ? (element.data['state'] as string) : 'unknown',
      });
    } else if (element.kind === 'volume' && VOLUME_ID.test(id)) {
      const [project, deployment, name] = id.split('/');

      volumes.push({ id, project, deployment, name });
    } else if (element.kind === 'node') nodes.push(id);
  }

  replicas.sort(
    (a, b) =>
      a.id.split('/').slice(0, 3).join('/').localeCompare(b.id.split('/').slice(0, 3).join('/')) || a.index - b.index,
  );
  volumes.sort((a, b) => a.id.localeCompare(b.id));
  nodes.sort();

  return { replicas, volumes, nodes };
}
