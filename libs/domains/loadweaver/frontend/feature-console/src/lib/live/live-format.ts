import type { LiveReplicaTarget, TerminalSessionRecord } from '@forepath/loadweaver/frontend/data-access-console';

/** Replicas of a project grouped by `deployment/service` (the picker's optgroups). */
export function replicaGroups(
  replicas: readonly LiveReplicaTarget[],
  project: string | null,
): { label: string; replicas: LiveReplicaTarget[] }[] {
  const groups = new Map<string, LiveReplicaTarget[]>();

  for (const replica of replicas) {
    if (project && replica.project !== project) continue;

    const label = project
      ? `${replica.deployment}/${replica.service}`
      : `${replica.project}/${replica.deployment}/${replica.service}`;

    groups.set(label, [...(groups.get(label) ?? []), replica]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, list]) => ({ label, replicas: list }));
}

/** `api/0 on n2 (running)`. */
export function replicaLabel(replica: LiveReplicaTarget): string {
  const where = replica.node ? ` · ${replica.node}` : '';
  const state = replica.state && replica.state !== 'unknown' ? ` (${replica.state})` : '';

  return `${replica.service}/${replica.index}${where}${state}`;
}

/** `replica/shop/web/api/0` → `shop/web/api/0`; `node/n1` → `node n1`. */
export function sessionTargetLabel(session: Pick<TerminalSessionRecord, 'target'>): string {
  if (session.target.startsWith('replica/')) return session.target.slice('replica/'.length);

  if (session.target.startsWith('node/'))
    return $localize`:@@lwConsoleLive-nodeShell:node shell ${session.target.slice('node/'.length)}:node:`;

  return session.target;
}

/** `1h 2m`, `8m 38s`, `12s`; `null` while it runs. */
export function sessionDuration(from: string, to: string | null): string | null {
  if (!to) return null;

  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));

  if (!Number.isFinite(seconds)) return null;

  if (seconds < 60) return `${seconds}s`;

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** `rwxr-xr-x` of permission bits. */
export function formatMode(mode: number): string {
  return [6, 3, 0]
    .map((shift) => {
      const bits = (mode >> shift) & 7;

      return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
    })
    .join('');
}

/** The CLI command that forwards a local port to a replica's port (tunnels aren't opened from the browser). */
export function portForwardCommand(
  replica: string,
  remote: number | null,
  local: number | null = null,
  ttl: number | null = null,
): string {
  const port =
    remote && remote > 0 ? (local && local > 0 && local !== remote ? `${local}:${remote}` : `${remote}`) : '<port>';

  return `loadweaver port-forward ${replica} ${port}${ttl && ttl > 0 ? ` --ttl ${ttl}` : ''}`;
}

/** Bootstrap icon (without `bi-`) of a file entry. */
export function fileIcon(name: string, type: string): string {
  if (type === 'directory') return 'folder';

  if (type === 'symlink') return 'link-45deg';

  const ext = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';
  const icons: Record<string, string> = {
    json: 'filetype-json',
    yml: 'filetype-yml',
    yaml: 'filetype-yml',
    md: 'filetype-md',
    sh: 'filetype-sh',
    js: 'filetype-js',
    ts: 'filetype-tsx',
    html: 'filetype-html',
    css: 'filetype-css',
    py: 'filetype-py',
    xml: 'filetype-xml',
    sql: 'filetype-sql',
    png: 'file-earmark-image',
    jpg: 'file-earmark-image',
    jpeg: 'file-earmark-image',
    gif: 'file-earmark-image',
    svg: 'file-earmark-image',
    webp: 'file-earmark-image',
    pdf: 'file-earmark-pdf',
    gz: 'file-earmark-zip',
    zip: 'file-earmark-zip',
    tar: 'file-earmark-zip',
    log: 'file-earmark-text',
    txt: 'file-earmark-text',
  };

  return icons[ext] ?? 'file-earmark';
}

/** The only type blobs handed to the browser get: never rendered inline (no HTML / SVG in the console's origin). */
export const DOWNLOAD_BLOB_TYPE = 'application/octet-stream';

/**
 * Saves a blob or text as a download (after an authenticated fetch). The content is always re-typed as
 * `application/octet-stream` and saved through a `download` link, so nothing (HTML, SVG, …) can render in the console's
 * origin even when the blob URL is opened directly.
 */
export function saveFile(document: Document, content: Blob | string, name: string): void {
  const view = document.defaultView;

  if (!view?.URL?.createObjectURL) return;

  const blob = new Blob([content], { type: DOWNLOAD_BLOB_TYPE });
  const url = view.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body?.appendChild(link);
  link.click();
  link.remove();
  view.URL.revokeObjectURL(url);
}
