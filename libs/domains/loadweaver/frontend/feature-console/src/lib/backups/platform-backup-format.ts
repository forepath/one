import type {
  BackupsService,
  DrInfoDocument,
  PlatformBackupKind,
  PlatformBackupKindStatus,
  PlatformBackupRunResult,
  PlatformCopyRunResult,
  PlatformCutover,
  PlatformCutoverState,
  PlatformRestore,
  PlatformRestoreState,
} from '@forepath/loadweaver/frontend/data-access-console';
import { tap, type Observable } from 'rxjs';

import { saveFile } from '../live/live-format';

type Tone = 'success' | 'warning' | 'danger' | 'secondary' | 'info' | 'primary';

export function platformKindLabel(kind: PlatformBackupKind | string): string {
  switch (kind) {
    case 'postgres':
      return $localize`:@@lwConsolePlatformBackups-kindPostgres:Postgres (control-plane database)`;
    case 'opensearch':
      return $localize`:@@lwConsolePlatformBackups-kindOpensearch:OpenSearch (logs, audit, search)`;
    case 'etcd':
      return $localize`:@@lwConsolePlatformBackups-kindEtcd:etcd (cluster coordination)`;
    default:
      return kind;
  }
}

/** Run / copy statuses (`succeeded`, `failed`, `running`, `unavailable`, `busy`) as a badge tone. */
export function platformStatusTone(status: string | null): Tone {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'primary';
    case 'busy':
    case 'unavailable':
      return 'warning';
    default:
      return 'secondary';
  }
}

export function platformStatusLabel(status: string | null): string {
  switch (status) {
    case null:
      return $localize`:@@lwConsolePlatformBackups-statusNever:Never`;
    case 'succeeded':
      return $localize`:@@lwConsolePlatformBackups-statusSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@lwConsolePlatformBackups-statusFailed:Failed`;
    case 'running':
      return $localize`:@@lwConsolePlatformBackups-statusRunning:Running`;
    case 'busy':
      return $localize`:@@lwConsolePlatformBackups-statusBusy:Already running`;
    case 'unavailable':
      return $localize`:@@lwConsolePlatformBackups-statusUnavailable:Unavailable`;
    default:
      return status;
  }
}

export const PLATFORM_RESTORE_TONE: Record<PlatformRestoreState, Tone> = {
  requested: 'info',
  restoring: 'primary',
  ready: 'success',
  failed: 'danger',
  discarded: 'secondary',
  adopted: 'success',
};

export function platformRestoreLabel(state: PlatformRestoreState | string): string {
  switch (state) {
    case 'requested':
      return $localize`:@@lwConsolePlatformBackups-restoreRequested:Requested`;
    case 'restoring':
      return $localize`:@@lwConsolePlatformBackups-restoreRestoring:Restoring`;
    case 'ready':
      return $localize`:@@lwConsolePlatformBackups-restoreReady:Ready`;
    case 'failed':
      return $localize`:@@lwConsolePlatformBackups-restoreFailed:Failed`;
    case 'discarded':
      return $localize`:@@lwConsolePlatformBackups-restoreDiscarded:Discarded`;
    case 'adopted':
      return $localize`:@@lwConsolePlatformBackups-restoreAdopted:Adopted (now the live database)`;
    default:
      return state;
  }
}

export const PLATFORM_CUTOVER_TONE: Record<PlatformCutoverState, Tone> = {
  planned: 'warning',
  approved: 'info',
  switching: 'primary',
  done: 'success',
  failed: 'danger',
  cancelled: 'secondary',
};

export function platformCutoverLabel(state: PlatformCutoverState | string): string {
  switch (state) {
    case 'planned':
      return $localize`:@@lwConsolePlatformBackups-cutoverPlanned:Planned, waiting for a second admin`;
    case 'approved':
      return $localize`:@@lwConsolePlatformBackups-cutoverApproved:Approved, about to switch`;
    case 'switching':
      return $localize`:@@lwConsolePlatformBackups-cutoverSwitching:Switching`;
    case 'done':
      return $localize`:@@lwConsolePlatformBackups-cutoverDone:Done`;
    case 'failed':
      return $localize`:@@lwConsolePlatformBackups-cutoverFailed:Failed`;
    case 'cancelled':
      return $localize`:@@lwConsolePlatformBackups-cutoverCancelled:Cancelled`;
    default:
      return state;
  }
}

/** Restores still in progress. */
export function isRestoreActive(restore: PlatformRestore): boolean {
  return restore.state === 'requested' || restore.state === 'restoring';
}

/** Cut-overs that can still be acted on or are executing. */
export function isCutoverOpen(cutover: PlatformCutover): boolean {
  return cutover.state === 'planned' || cutover.state === 'approved' || cutover.state === 'switching';
}

/** Something changes on its own: the page polls faster. */
export function platformBusy(
  kinds: PlatformBackupKindStatus[],
  restores: PlatformRestore[],
  cutovers: PlatformCutover[],
): boolean {
  return (
    kinds.some((k) => k.running) ||
    restores.some(isRestoreActive) ||
    cutovers.some((c) => c.state === 'approved' || c.state === 'switching')
  );
}

/** A `datetime-local` value (local time, no zone) as ISO 8601 with the browser's offset, e.g. `…T10:00:00+02:00`. */
export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

function safeName(cluster: string): string {
  return cluster.replace(/[^A-Za-z0-9._-]/g, '_') || 'cluster';
}

/** The file the DR info document is saved as. */
export function drInfoFileName(cluster: string): string {
  return `loadweaver-dr-info-${safeName(cluster)}.json`;
}

export function drInfoFileContent(doc: DrInfoDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The command that rebuilds the control plane on a fresh node from the external copy. */
export function drRestoreCommand(cluster: string | null): string {
  const file = cluster ? drInfoFileName(cluster) : 'loadweaver-dr-info-<cluster>.json';

  return (
    'sudo LOADWEAVER_DR_ACCESS_KEY_ID=… LOADWEAVER_DR_SECRET_ACCESS_KEY=… loadweaver-agent bootstrap --restore ' +
    `--name <node> --public-host <host> --dr-info ${file} --share-file share-1.txt --share-file share-2.txt`
  );
}

/** "Back up now" didn't produce a backup (failed, unavailable or already running). */
export function runResultFailed(result: PlatformBackupRunResult): boolean {
  return result.status !== 'succeeded';
}

export function copyResultsFailed(results: PlatformCopyRunResult[]): boolean {
  return results.some((r) => r.status !== 'succeeded');
}

/** Fetches the DR info document and saves it as `loadweaver-dr-info-<cluster>.json`. */
export function saveDrInfo(service: BackupsService, document: Document): Observable<DrInfoDocument> {
  return service.drInfo().pipe(tap((doc) => saveFile(document, drInfoFileContent(doc), drInfoFileName(doc.clusterId))));
}
