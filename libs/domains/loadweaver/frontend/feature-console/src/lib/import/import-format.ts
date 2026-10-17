import type {
  DiscoveredItem,
  ImportConflict,
  ImportItemSelection,
  ImportSelections,
  ImportStatus,
  ImportStepState,
} from '@forepath/loadweaver/frontend/data-access-console';

type Tone = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark';

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
  draft: 'secondary',
  planned: 'info',
  running: 'primary',
  done: 'success',
  failed: 'danger',
  'rolled-back': 'warning',
  discarded: 'light',
};

export const STEP_TONE: Record<ImportStepState['status'], Tone> = {
  pending: 'light',
  running: 'primary',
  done: 'success',
  failed: 'danger',
  skipped: 'secondary',
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
