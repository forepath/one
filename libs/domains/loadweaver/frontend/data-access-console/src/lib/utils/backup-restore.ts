import { stringify } from 'yaml';

import type { Backup, RestoreRequest } from '../types/backups.types';
import { LOADWEAVER_API_VERSION } from './resource-yaml';

/** Splits a volume id (`<project>/<deployment>/<volume>`); null when it isn't one. */
export function parseVolumeId(id: string): { project: string; deployment: string; volume: string } | null {
  const [project, deployment, volume, ...rest] = id.split('/');

  return project && deployment && volume && rest.length === 0 ? { project, deployment, volume } : null;
}

/** A relative path inside a backup / volume: no leading or trailing `/`, no empty, `.` or `..` segments. */
export function normalizeRelativePath(path: string | null | undefined): string {
  return (path ?? '')
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join('/');
}

export function isValidRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    !path.startsWith('/') &&
    !path.split('/').some((s) => s === '' || s === '..')
  );
}

/** A `Restore` resource name: `restore-<backup id prefix>-<base-36 time>` (RFC 1123, unique enough per project). */
export function restoreName(backup: Pick<Backup, 'id'>, now: Date = new Date()): string {
  const id = backup.id.replace(/[^a-z0-9]/g, '').slice(0, 8);

  return `restore-${id}-${now.getTime().toString(36)}`.slice(0, 63);
}

/**
 * The `Restore` resource (YAML) the wizard plans: the whole backup into a volume of the project (`replace` / `merge`)
 * or one path of it (`path`, `targetPath`, `overwrite`).
 */
export function restoreResourceYaml(request: RestoreRequest, name: string = restoreName(request.backup)): string {
  const path = normalizeRelativePath(request.path);
  const targetPath = normalizeRelativePath(request.targetPath);
  const description = request.description?.trim();

  return stringify(
    {
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'Restore',
      metadata: { name, project: request.backup.project },
      spec: {
        ...(description ? { description } : {}),
        backup: request.backup.id,
        target: {
          deployment: request.deployment,
          volume: request.volume,
          mode: request.mode,
          ...(path ? { path, ...(targetPath && targetPath !== path ? { targetPath } : {}) } : {}),
          ...(path ? { overwrite: !!request.overwrite } : {}),
        },
      },
    },
    { lineWidth: 0 },
  );
}
