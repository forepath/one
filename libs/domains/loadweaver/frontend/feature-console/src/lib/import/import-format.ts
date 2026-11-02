import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';
import type {
  DiscoveredItem,
  ImportConflict,
  ImportItemSelection,
  ImportSelections,
  ImportStatus,
  ImportStepState,
} from '@forepath/loadweaver/frontend/data-access-console';

/** Object-state tone of `fpc-badge [tone]` (3.38 R10). */
type Tone = FpcBadgeTone;

/** Resource-name form of a compose project / container name (same rule as the control plane). */
export function suggestedName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '') || 'imported'
  );
}

/** Ports that need a hostname (the HTTP ingress serves 80 / 443 by host name). */
export function needsHostname(port: { protocol: string; hostPort: number }): boolean {
  return port.protocol === 'tcp' && (port.hostPort === 80 || port.hostPort === 443);
}

/** The wizard's starting point: what was selected before, otherwise everything ignored. */
export function initialSelections(items: DiscoveredItem[], saved: ImportSelections | null): ImportItemSelection[] {
  return items.map(
    (item) =>
      saved?.items.find((s) => s.item === item.id) ?? {
        item: item.id,
        choice: 'ignore',
        deployment: suggestedName(item.name),
      },
  );
}

/** The request body: only what matters for each choice (ignored items carry nothing else). */
export function selectionsBody(selections: ImportItemSelection[], wipeFormerIdentity: boolean): ImportSelections {
  return {
    items: selections.map((s) =>
      s.choice === 'ignore'
        ? { item: s.item, choice: 'ignore' }
        : {
            item: s.item,
            choice: s.choice,
            ...(s.project ? { project: s.project } : {}),
            ...(s.deployment ? { deployment: s.deployment } : {}),
            ...(s.http && Object.values(s.http).some(Boolean)
              ? { http: Object.fromEntries(Object.entries(s.http).filter(([, v]) => !!v)) }
              : {}),
            ...(s.volumes && Object.keys(s.volumes).length ? { volumes: s.volumes } : {}),
            ...(s.variables && Object.values(s.variables).some(Boolean)
              ? { variables: Object.fromEntries(Object.entries(s.variables).filter(([, v]) => v !== '')) }
              : {}),
          },
    ),
    ...(wipeFormerIdentity ? { wipeFormerIdentity: true } : {}),
  };
}

export const CONFLICT_TONE: Record<ImportConflict['severity'], Tone> = {
  error: 'danger',
  warning: 'warning',
  resolved: 'success',
};

export const STATUS_TONE: Record<ImportStatus, Tone> = {
  draft: 'neutral',
  planned: 'info',
  running: 'primary',
  done: 'success',
  failed: 'danger',
  'rolled-back': 'warning',
  discarded: 'neutral',
};

/** Translated, sentence-case label of an import status (3.38 R10: never the raw enum value). */
export function importStatusLabel(status: ImportStatus | string): string {
  switch (status) {
    case 'draft':
      return $localize`:@@lwConsoleImport-statusDraft:Draft`;
    case 'planned':
      return $localize`:@@lwConsoleImport-statusPlanned:Planned`;
    case 'running':
      return $localize`:@@lwConsoleImport-statusRunning:Running`;
    case 'done':
      return $localize`:@@lwConsoleImport-statusDone:Done`;
    case 'failed':
      return $localize`:@@lwConsoleImport-statusFailed:Failed`;
    case 'rolled-back':
      return $localize`:@@lwConsoleImport-statusRolledBack:Rolled back`;
    case 'discarded':
      return $localize`:@@lwConsoleImport-statusDiscarded:Discarded`;
    default:
      return status;
  }
}

export function importConflictLabel(severity: string): string {
  switch (severity) {
    case 'error':
      return $localize`:@@lwConsoleImport-conflictError:Error`;
    case 'warning':
      return $localize`:@@lwConsoleImport-conflictWarning:Warning`;
    case 'resolved':
      return $localize`:@@lwConsoleImport-conflictResolved:Resolved`;
    default:
      return severity;
  }
}

export function importStepLabel(status: string): string {
  switch (status) {
    case 'pending':
      return $localize`:@@lwConsoleImport-stepPending:Pending`;
    case 'running':
      return $localize`:@@lwConsoleImport-statusRunning:Running`;
    case 'done':
      return $localize`:@@lwConsoleImport-statusDone:Done`;
    case 'failed':
      return $localize`:@@lwConsoleImport-statusFailed:Failed`;
    case 'skipped':
      return $localize`:@@lwConsoleImport-stepSkipped:Skipped`;
    default:
      return status;
  }
}

export const STEP_TONE: Record<ImportStepState['status'], Tone> = {
  pending: 'neutral',
  running: 'primary',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

/** `1536` → `1.5 KiB`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '–';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
