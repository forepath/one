import type {
  VirtualMachineSummary,
  VmAction,
  VmCommand,
  VmImportPhase,
  VmImportProgress,
  VmPhase,
  VmRunStrategy,
  VmSnapshot,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcStatusBadgeTone } from '@forepath/shared/frontend/ui-components';

/** Full virtual machines (3.35): labels, tones and links of the VM pages. */

export const VM_PHASES: readonly VmPhase[] = [
  'Pending',
  'Importing',
  'Starting',
  'Running',
  'Stopping',
  'Stopped',
  'Migrating',
  'Failed',
];

export const VM_RUN_STRATEGIES: readonly VmRunStrategy[] = ['Always', 'Manual', 'Halted'];

/** Power actions in the order the header shows them (`reimage` is offered separately). */
export const VM_POWER_ACTIONS: readonly VmAction[] = ['start', 'shutdown', 'stop', 'reboot', 'reset', 'force-off'];

export function phaseTone(phase: VmPhase): FpcStatusBadgeTone {
  switch (phase) {
    case 'Running':
      return 'success';
    case 'Failed':
      return 'danger';
    case 'Stopped':
      return 'secondary';
    case 'Pending':
    case 'Stopping':
      return 'warning';
    default:
      return 'info';
  }
}

export function phaseIcon(phase: VmPhase): string {
  switch (phase) {
    case 'Running':
      return 'bi-play-fill';
    case 'Failed':
      return 'bi-exclamation-triangle';
    case 'Stopped':
      return 'bi-stop-fill';
    case 'Migrating':
      return 'bi-arrow-left-right';
    case 'Importing':
      return 'bi-cloud-arrow-down';
    case 'Pending':
      return 'bi-hourglass-split';
    default:
      return 'bi-arrow-repeat';
  }
}

export function phaseLabel(phase: VmPhase): string {
  switch (phase) {
    case 'Pending':
      return $localize`:@@lwConsoleVms-phasePending:Pending`;
    case 'Importing':
      return $localize`:@@lwConsoleVms-phaseImporting:Importing image`;
    case 'Starting':
      return $localize`:@@lwConsoleVms-phaseStarting:Starting`;
    case 'Running':
      return $localize`:@@lwConsoleVms-phaseRunning:Running`;
    case 'Stopping':
      return $localize`:@@lwConsoleVms-phaseStopping:Stopping`;
    case 'Stopped':
      return $localize`:@@lwConsoleVms-phaseStopped:Stopped`;
    case 'Migrating':
      return $localize`:@@lwConsoleVms-phaseMigrating:Migrating`;
    default:
      return $localize`:@@lwConsoleVms-phaseFailed:Failed`;
  }
}

/** The boot disk import's phase (F3b / F4). */
export function importPhaseLabel(phase: VmImportPhase): string {
  switch (phase) {
    case 'queued':
      return $localize`:@@lwConsoleVms-importQueued:Boot disk import queued`;
    case 'fetching':
      return $localize`:@@lwConsoleVms-importFetching:Downloading the image`;
    case 'writing':
      return $localize`:@@lwConsoleVms-importWriting:Writing the boot disk`;
    default:
      return $localize`:@@lwConsoleVms-importFailed:Boot disk import failed (retried)`;
  }
}

/** Bar values of an import that knows its total (`writing`), else null (queued / failed / download without size). */
export function importBar(progress: VmImportProgress): { value: number; max: number; percent: number } | null {
  if (progress.phase === 'queued' || progress.phase === 'failed' || !progress.totalBytes) return null;

  const value = Math.min(progress.bytes ?? 0, progress.totalBytes);

  return { value, max: progress.totalBytes, percent: Math.floor((value / progress.totalBytes) * 100) };
}

/** "512.0 MiB / 2.0 GiB" or "512.0 MiB"; empty without bytes. */
export function importAmount(progress: VmImportProgress, format: (bytes: number) => string): string {
  if (progress.bytes === undefined) return '';

  return progress.totalBytes ? `${format(progress.bytes)} / ${format(progress.totalBytes)}` : format(progress.bytes);
}

export function runStrategyLabel(strategy: VmRunStrategy): string {
  switch (strategy) {
    case 'Always':
      return $localize`:@@lwConsoleVms-strategyAlways:Always on`;
    case 'Manual':
      return $localize`:@@lwConsoleVms-strategyManual:Manual power`;
    default:
      return $localize`:@@lwConsoleVms-strategyHalted:Halted`;
  }
}

export function vmActionLabel(action: VmAction): string {
  switch (action) {
    case 'start':
      return $localize`:@@lwConsoleVms-actionStart:Start`;
    case 'stop':
      return $localize`:@@lwConsoleVms-actionStop:Stop`;
    case 'force-off':
      return $localize`:@@lwConsoleVms-actionForceOff:Force off`;
    case 'shutdown':
      return $localize`:@@lwConsoleVms-actionShutdown:Shut down`;
    case 'reboot':
      return $localize`:@@lwConsoleVms-actionReboot:Reboot`;
    case 'reset':
      return $localize`:@@lwConsoleVms-actionReset:Reset`;
    default:
      return $localize`:@@lwConsoleVms-actionReimage:Re-image boot disk`;
  }
}

export function vmActionIcon(action: VmAction): string {
  switch (action) {
    case 'start':
      return 'bi-play-fill';
    case 'stop':
      return 'bi-stop-fill';
    case 'force-off':
      return 'bi-power';
    case 'shutdown':
      return 'bi-box-arrow-down';
    case 'reboot':
      return 'bi-arrow-clockwise';
    case 'reset':
      return 'bi-lightning-charge';
    default:
      return 'bi-hdd';
  }
}

/** Actions that may lose unsaved guest data. */
export function vmActionDangerous(action: VmAction): boolean {
  return action === 'force-off' || action === 'reset' || action === 'reimage';
}

export function vmActionConfirmMessage(action: VmAction): string {
  switch (action) {
    case 'start':
      return $localize`:@@lwConsoleVms-confirmStart:The virtual machine is placed on a node and boots.`;
    case 'stop':
      return $localize`:@@lwConsoleVms-confirmStop:The guest is asked to shut down (ACPI); after the grace period the virtual machine is switched off. It stays off until you start it.`;
    case 'shutdown':
      return $localize`:@@lwConsoleVms-confirmShutdown:The guest operating system shuts down cleanly and the virtual machine stays off.`;
    case 'force-off':
      return $localize`:@@lwConsoleVms-confirmForceOff:The virtual machine is switched off without a clean shutdown. Unsaved data in the guest is lost.`;
    case 'reboot':
      return $localize`:@@lwConsoleVms-confirmReboot:The guest operating system restarts cleanly (ACPI).`;
    case 'reset':
      return $localize`:@@lwConsoleVms-confirmReset:The virtual machine is reset like a hardware reset. Unsaved data in the guest is lost.`;
    default:
      return $localize`:@@lwConsoleVms-confirmReimage:The boot disk is overwritten with the pinned image and first-boot configuration (cloud-init) runs again. Everything on the boot disk is lost.`;
  }
}

/** Route of a VM's object page (3.37). */
export function vmLink(vm: Pick<VirtualMachineSummary, 'project' | 'name'>): string[] {
  return ['/resources', 'virtualmachine', vm.project, vm.name];
}

/** Free-text search over name, project, node, image, addresses and labels. */
export function matchesVmSearch(vm: VirtualMachineSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();

  if (!needle) return true;

  return [
    vm.name,
    vm.project,
    vm.node ?? '',
    vm.image,
    vm.description ?? '',
    ...vm.addresses,
    ...Object.entries(vm.labels).map(([k, v]) => `${k}=${v}`),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function snapshotTone(status: VmSnapshot['status']): FpcStatusBadgeTone {
  return status === 'succeeded'
    ? 'success'
    : status === 'running'
      ? 'info'
      : status === 'partial'
        ? 'warning'
        : 'danger';
}

export function snapshotStatusLabel(status: VmSnapshot['status']): string {
  switch (status) {
    case 'running':
      return $localize`:@@lwConsoleVms-snapshotRunning:Running`;
    case 'succeeded':
      return $localize`:@@lwConsoleVms-snapshotSucceeded:Complete`;
    case 'partial':
      return $localize`:@@lwConsoleVms-snapshotPartial:Partial`;
    default:
      return $localize`:@@lwConsoleVms-snapshotFailed:Failed`;
  }
}

/** Badge color of a node command's status. */
export function commandColor(status: VmCommand['status']): 'success' | 'danger' | 'info' | 'secondary' {
  return status === 'succeeded'
    ? 'success'
    : status === 'failed'
      ? 'danger'
      : status === 'running' || status === 'sent'
        ? 'info'
        : 'secondary';
}

export function commandStatusLabel(status: VmCommand['status']): string {
  switch (status) {
    case 'pending':
      return $localize`:@@lwConsoleVms-commandPending:Queued`;
    case 'sent':
      return $localize`:@@lwConsoleVms-commandSent:Sent`;
    case 'running':
      return $localize`:@@lwConsoleVms-commandRunning:Running`;
    case 'succeeded':
      return $localize`:@@lwConsoleVms-commandSucceeded:Done`;
    default:
      return $localize`:@@lwConsoleVms-commandFailed:Failed`;
  }
}

/** `<repository>:<tag>` of an image reference without registry host and project (`registry.lw/shop/x:1` → `x:1`). */
export function suggestImageRef(url: string): string {
  const file = url.split(/[?#]/)[0].split('/').pop() ?? '';
  const base = file
    .replace(/\.(qcow2|img|raw|tar|tar\.gz|tgz|gz|xz)$/i, '')
    .replace(/\.(qcow2|img|raw)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

  return base ? `${base}:latest` : '';
}
