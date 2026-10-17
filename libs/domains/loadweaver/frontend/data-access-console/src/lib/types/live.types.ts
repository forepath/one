/**
 * Live interaction (3.19): terminals (`socket/terminals`), the file browser (`/live/files`), terminal session records
 * and recordings (`/live/sessions`), open debug tunnels (`/live/tunnels`).
 */

/** What a terminal or the file browser can open, derived from the (access-scoped) topology. */
export interface LiveReplicaTarget {
  /** `project/deployment/service/index`. */
  id: string;
  project: string;
  deployment: string;
  service: string;
  index: number;
  node: string | null;
  state: string;
}

/** `project/deployment/volume`. */
export interface LiveVolumeTarget {
  id: string;
  project: string;
  deployment: string;
  name: string;
}

export interface LiveTargets {
  replicas: LiveReplicaTarget[];
  volumes: LiveVolumeTarget[];
  /** Nodes (cluster roles only): candidates for a node shell. */
  nodes: string[];
}

/** `createTerminal`'s target. */
export type TerminalTarget = { replica: string } | { node: string };

export interface CreateTerminalRequest {
  sessionId: string;
  target: TerminalTarget;
  /** An absolute path, e.g. `/bin/ash`; default `bash -l` / `sh -l`. */
  shell?: string;
  cols: number;
  rows: number;
}

/** What `socket/terminals` tells the page (connection state included). */
export type TerminalSocketEvent =
  | { type: 'connection'; connected: boolean; error?: string }
  | { type: 'created'; sessionId: string; recorded: boolean }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'closed'; sessionId: string; exitCode: number | null; error?: string }
  | { type: 'error'; sessionId?: string; message: string };

/** `GET /live/sessions` (newest first, at most 1000). Node shells: `project: null`, target `node/<name>`. */
export interface TerminalSessionRecord {
  id: string;
  userId: string | null;
  project: string | null;
  /** `replica/<project/deployment/service/index>` or `node/<name>`. */
  target: string;
  node: string;
  recorded: boolean;
  hasRecording: boolean;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
}

/** `GET /live/tunnels`: open, unexpired debug tunnels. */
export interface TunnelRecord {
  id: string;
  userId: string | null;
  project: string;
  replica: string;
  node: string;
  port: number;
  openedAt: string;
  expiresAt: string;
}

/** `replica:<project/deployment/service/index>` or `volume:<project/deployment/volume>`. */
export type LiveFileTarget = `replica:${string}` | `volume:${string}`;

/** `GET /live/files`: folders first, at most 10,000 entries. */
export interface LiveFileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: string;
  /** Permission bits. */
  mode: number;
}

/** `X-File-Type` (from the extension; files without one count as text). */
export type LiveFileType = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'binary';

/** A (possibly ranged) read of a file. */
export interface LiveFileContent {
  data: Blob;
  /** The file's full size (from `Content-Range`, else the data's size). */
  size: number;
  /** The read stopped before the end of the file. */
  partial: boolean;
  fileType: LiveFileType | null;
}

/** Result of a write: `X-Loadweaver-Warning` (container filesystem writes are lost on restart). */
export interface LiveFileWriteResult {
  warning: string | null;
  /** The last chunk (204) or a whole write; `false` for an intermediate chunk (202). */
  complete: boolean;
}

/** A change in the file browser (audited as `files.<action>`). */
export type LiveFileOperation =
  | { kind: 'create'; path: string; type: 'file' | 'directory' }
  | { kind: 'delete'; path: string }
  | { kind: 'move' | 'copy'; path: string; destination: string; overwrite: boolean };
