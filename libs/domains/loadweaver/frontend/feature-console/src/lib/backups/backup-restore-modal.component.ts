import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleBackupsFacade,
  isValidRelativePath,
  normalizeRelativePath,
  parseVolumeId,
  type Backup,
  type LiveVolumeTarget,
  type RestoreMode,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcStepperComponent,
  type FpcStep,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';

const VOLUME_NAME = /^[a-z0-9_.-]{1,63}$/;
const RESOURCE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type RestoreScope = 'volume' | 'path';
export type RestoreTarget = 'same' | 'other';

/**
 * The restore wizard (3.20): which backup and what (the whole volume or one path), then where (the volume itself,
 * or side by side into another volume of the project) and how (replace / merge, target path, overwrite). It plans a
 * `Restore` resource; the plan page handles approvals and apply.
 */
@Component({
  selector: 'loadweaver-backup-restore-modal',
  imports: [
    FpcFormFieldComponent,
    FpcFormControlComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcStepperComponent,
  ],
  templateUrl: './backup-restore-modal.component.html',
  standalone: true,
})
export class LoadweaverBackupRestoreModalComponent {
  private readonly facade = inject(ConsoleBackupsFacade);

  readonly open = model(false);
  /** The backup the wizard starts with. */
  readonly backup = input<Backup | null>(null);
  /** Backups of the same volume to choose from (newest first); only available ones are offered. */
  readonly candidates = input<Backup[]>([]);
  /** Prefilled path for a single-file / directory restore. */
  readonly path = input<string | null>(null);
  /** The volumes the caller can see (from the topology); the project's are targets. */
  readonly volumes = input<LiveVolumeTarget[]>([]);

  readonly planning = toSignal(this.facade.planningRestore$, { initialValue: false });
  readonly planError = toSignal(this.facade.restorePlanError$, { initialValue: null });

  readonly step = signal<1 | 2>(1);
  readonly backupId = signal('');
  readonly scope = signal<RestoreScope>('volume');
  readonly sourcePath = signal('');
  readonly targetPath = signal('');
  readonly overwrite = signal(false);
  readonly target = signal<RestoreTarget>('same');
  readonly deployment = signal('');
  readonly volume = signal('');
  readonly mode = signal<RestoreMode>('replace');
  readonly description = signal('');

  readonly bytes = formatBytes;

  readonly choices = computed(() => {
    const list = this.candidates().filter((b) => b.status === 'succeeded' && !b.deletedAt);
    const start = this.backup();

    return start && !list.some((b) => b.id === start.id) ? [start, ...list] : list;
  });
  readonly selected = computed(() => this.choices().find((b) => b.id === this.backupId()) ?? this.backup());
  readonly source = computed(() => {
    const backup = this.selected();

    return backup ? parseVolumeId(backup.resource) : null;
  });
  /** The project's volumes (the restore stays within the project). */
  readonly projectVolumes = computed(() => {
    const project = this.selected()?.project;

    return this.volumes().filter((v) => v.project === project);
  });
  readonly deployments = computed(() => {
    const names = new Set(this.projectVolumes().map((v) => v.deployment));
    const source = this.source();

    if (source) names.add(source.deployment);

    return [...names].sort();
  });
  readonly deploymentVolumes = computed(() =>
    this.projectVolumes()
      .filter((v) => v.deployment === this.deployment())
      .map((v) => v.name)
      .sort(),
  );
  readonly targetDeployment = computed(() =>
    this.target() === 'same' ? (this.source()?.deployment ?? '') : this.deployment().trim(),
  );
  readonly targetVolume = computed(() =>
    this.target() === 'same' ? (this.source()?.volume ?? '') : this.volume().trim(),
  );
  /** The target volume exists (known from the topology, or the backup's own volume). */
  readonly targetExists = computed(() => {
    const source = this.source();

    return (
      (this.targetDeployment() === source?.deployment && this.targetVolume() === source?.volume) ||
      this.projectVolumes().some((v) => v.deployment === this.targetDeployment() && v.name === this.targetVolume())
    );
  });
  readonly sourcePathValid = computed(
    () => this.scope() === 'volume' || isValidRelativePath(normalizeRelativePath(this.sourcePath())),
  );
  readonly targetPathValid = computed(() => {
    const path = normalizeRelativePath(this.targetPath());

    return this.scope() === 'volume' || path === '' || isValidRelativePath(path);
  });
  readonly targetValid = computed(
    () => RESOURCE_NAME.test(this.targetDeployment()) && VOLUME_NAME.test(this.targetVolume()),
  );
  readonly stepOneValid = computed(() => !!this.selected()?.project && this.sourcePathValid());
  readonly valid = computed(() => this.stepOneValid() && this.targetPathValid() && this.targetValid());

  readonly title = $localize`:@@lwConsoleBackupRestore-title:Restore a backup`;
  /** The wizard's two steps (`fpc-stepper`; step 2 opens once step 1 is valid). */
  readonly steps = computed<FpcStep[]>(() => [
    { id: 'what', label: $localize`:@@lwConsoleBackupRestore-stepWhat:What`, invalid: !this.stepOneValid() },
    { id: 'where', label: $localize`:@@lwConsoleBackupRestore-stepWhere:Where`, invalid: !this.valid() },
  ]);

  constructor() {
    // Every opening starts from the inputs (the backup and, from the file browser, a path); a refreshed backup
    // (polling) while the dialog is open doesn't reset what was entered.
    let wasOpen = false;

    effect(() => {
      const open = this.open();

      if (open && !wasOpen) untracked(() => this.reset(this.backup(), this.path()));

      wasOpen = open;
    });
  }

  private reset(backup: Backup | null, path: string | null): void {
    const source = backup ? parseVolumeId(backup.resource) : null;
    const clean = normalizeRelativePath(path);

    this.step.set(1);
    this.backupId.set(backup?.id ?? '');
    this.scope.set(clean ? 'path' : 'volume');
    this.sourcePath.set(clean);
    this.targetPath.set('');
    this.overwrite.set(false);
    this.target.set('same');
    this.deployment.set(source?.deployment ?? '');
    this.volume.set(source ? `${source.volume}-restored`.slice(0, 63) : '');
    this.mode.set(clean ? 'merge' : 'replace');
    this.description.set('');
    this.facade.clearRestorePlanError();
  }

  setScope(scope: RestoreScope): void {
    this.scope.set(scope);
    // A single path is added to what is there; a whole volume replaces it unless chosen otherwise.
    this.mode.set(scope === 'path' ? 'merge' : 'replace');
  }

  next(): void {
    if (this.stepOneValid()) this.step.set(2);
  }

  back(): void {
    this.step.set(1);
  }

  submit(): void {
    const backup = this.selected();

    if (!backup?.project || !this.valid()) return;

    const single = this.scope() === 'path';

    this.facade.planRestore({
      backup: { id: backup.id, project: backup.project },
      deployment: this.targetDeployment(),
      volume: this.targetVolume(),
      mode: this.mode(),
      ...(single
        ? {
            path: normalizeRelativePath(this.sourcePath()),
            targetPath: normalizeRelativePath(this.targetPath()) || undefined,
            overwrite: this.overwrite(),
          }
        : {}),
      ...(this.description().trim() ? { description: this.description().trim() } : {}),
    });
  }
}
