import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  BackupsService,
  ConsoleBackupKeysFacade,
  DEFAULT_KIT_SIZE,
  isRecoverable,
  pendingShares,
  type BackupKeyGeneration,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { saveFile } from '../live/live-format';
import { kitShareFileName } from './backup-format';
import { saveDrInfo } from './platform-backup-format';

export type KitSizeDialog = { mode: 'rotate' } | { mode: 'reissue'; generation: number };

const MIN_KIT = 2;
const MAX_KIT = 16;

/**
 * The backup key and its recovery kit (3.20, cluster admins): key generations, the kit's shares (each handed out
 * once: saved as a text file and shown once), confirming the kit by pasting enough shares back, re-issuing the kit,
 * rotating the key and escrowing it in the KMS. Until a kit is confirmed (or the key escrowed) backups can't be
 * recovered without the cluster.
 */
@Component({
  selector: 'loadweaver-backup-keys-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './backup-keys-page.component.html',
  standalone: true,
})
export class LoadweaverBackupKeysPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupKeysFacade);
  private readonly document = inject(DOCUMENT);
  private readonly backups = inject(BackupsService);

  readonly generations = toSignal(this.facade.generations$, { initialValue: [] as BackupKeyGeneration[] });
  readonly active = toSignal(this.facade.active$, { initialValue: null });
  readonly loaded = toSignal(this.facade.loaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly lastSuccess = toSignal(this.facade.lastSuccess$, { initialValue: null });
  readonly share = toSignal(this.facade.share$, { initialValue: null });

  readonly sizeDialog = signal<KitSizeDialog | null>(null);
  kitShares = DEFAULT_KIT_SIZE.shares;
  kitThreshold = DEFAULT_KIT_SIZE.threshold;
  readonly confirmFor = signal<BackupKeyGeneration | null>(null);
  readonly pasted = signal<string[]>([]);
  readonly escrowFor = signal<BackupKeyGeneration | null>(null);
  /** The share download asked about first (it can be handed out only once). */
  readonly shareFor = signal<{ generation: number; index: number } | null>(null);
  readonly drDownloading = signal(false);
  readonly drError = signal<string | null>(null);

  readonly activeRecoverable = computed(() => {
    const active = this.active();

    return !active || isRecoverable(active);
  });
  readonly sizeValid = computed(() => this.validSize(this.kitShares, this.kitThreshold));
  readonly pastedCount = computed(() => this.pasted().filter((s) => s.trim()).length);

  readonly recoverable = isRecoverable;
  readonly pending = pendingShares;
  readonly minKit = MIN_KIT;
  readonly maxKit = MAX_KIT;

  readonly title = $localize`:@@lwConsoleBackupKeys-title:Backup key and recovery kit`;
  readonly backLabel = $localize`:@@lwConsoleBackupKeys-back:Backups`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupKeys-refresh:Refresh`;
  readonly generationLabel = $localize`:@@lwConsoleBackupKeys-generation:Generation`;
  readonly rotateTitle = $localize`:@@lwConsoleBackupKeys-rotateTitle:Rotate the backup key`;
  readonly reissueTitle = $localize`:@@lwConsoleBackupKeys-reissueTitle:Re-issue the recovery kit`;
  readonly confirmTitle = $localize`:@@lwConsoleBackupKeys-confirmTitle:Confirm the recovery kit`;
  readonly shareTitle = $localize`:@@lwConsoleBackupKeys-shareTitle:Recovery kit share`;
  readonly shareAskTitle = $localize`:@@lwConsoleBackupKeys-shareAskTitle:Hand out this share?`;
  readonly shareAskMessage = $localize`:@@lwConsoleBackupKeys-shareAskMessage:Each share can be downloaded exactly once. It is saved as a text file and shown once; give it to its keeper and store it offline (print it, a safe, a password manager of that person).`;
  readonly shareAskConfirm = $localize`:@@lwConsoleBackupKeys-shareAskConfirm:Download the share`;
  readonly escrowTitle = $localize`:@@lwConsoleBackupKeys-escrowTitle:Escrow the key in the KMS?`;
  readonly escrowMessage = $localize`:@@lwConsoleBackupKeys-escrowMessage:The key of this generation is additionally stored in the configured external KMS, so backups can be recovered with the KMS instead of the kit.`;
  readonly escrowConfirm = $localize`:@@lwConsoleBackupKeys-escrowConfirm:Escrow`;
  readonly cancelLabel = $localize`:@@lwConsoleBackupKeys-cancel:Cancel`;

  constructor() {
    // A share is saved as a text file as soon as it arrives (it can't be fetched again).
    let saved: string | null = null;

    effect(() => {
      const share = this.share();
      const key = share ? `${share.generation}/${share.index}` : null;

      if (share && key !== saved) {
        saved = key;
        untracked(() => this.saveShare());
      }

      if (!share) saved = null;
    });

    // Dialogs close once their action succeeded.
    effect(() => {
      const success = this.lastSuccess();

      if (!success) return;

      untracked(() => {
        if (success.action === 'rotate' || success.action === 'reissue') this.sizeDialog.set(null);

        if (success.action === 'confirm') this.confirmFor.set(null);
      });
    });
  }

  ngOnInit(): void {
    this.facade.load();
  }

  refresh(): void {
    this.facade.load();
  }

  /** Saves the DR info document (target locations and key generations, no secrets) next to the kit. */
  async downloadDrInfo(): Promise<void> {
    this.drDownloading.set(true);
    this.drError.set(null);

    try {
      await firstValueFrom(saveDrInfo(this.backups, this.document));
    } catch (error) {
      this.drError.set(apiErrorMessage(error, $localize`:@@lwConsoleBackupKeys-drFailed:Download failed`));
    } finally {
      this.drDownloading.set(false);
    }
  }

  validSize(shares: number, threshold: number): boolean {
    return (
      Number.isInteger(shares) &&
      Number.isInteger(threshold) &&
      shares >= MIN_KIT &&
      shares <= MAX_KIT &&
      threshold >= MIN_KIT &&
      threshold <= shares
    );
  }

  openSize(dialog: KitSizeDialog, current?: BackupKeyGeneration): void {
    this.kitShares = current?.kit.shares ?? DEFAULT_KIT_SIZE.shares;
    this.kitThreshold = current?.kit.threshold ?? DEFAULT_KIT_SIZE.threshold;
    this.facade.clearActionError();
    this.sizeDialog.set(dialog);
  }

  onSizeOpenChange(open: boolean): void {
    if (!open) this.sizeDialog.set(null);
  }

  submitSize(): void {
    const dialog = this.sizeDialog();
    const kit = { shares: Number(this.kitShares), threshold: Number(this.kitThreshold) };

    if (!dialog || !this.validSize(kit.shares, kit.threshold)) return;

    if (dialog.mode === 'rotate') this.facade.rotate(kit);
    else this.facade.reissue(dialog.generation, kit);
  }

  askShare(generation: BackupKeyGeneration, index: number): void {
    this.facade.clearActionError();
    this.shareFor.set({ generation: generation.generation, index });
  }

  onShareAskOpenChange(open: boolean): void {
    if (!open) this.shareFor.set(null);
  }

  downloadShare(): void {
    const target = this.shareFor();

    if (target) this.facade.downloadShare(target.generation, target.index);

    this.shareFor.set(null);
  }

  /** Saves the share shown in the dialog (again) as a text file. */
  saveShare(): void {
    const share = this.share();

    if (!share) return;

    saveFile(
      this.document,
      share.share.text,
      kitShareFileName(share.share.document.cluster, share.generation, share.index),
    );
  }

  closeShare(): void {
    this.facade.clearShare();
  }

  onShareOpenChange(open: boolean): void {
    if (!open) this.closeShare();
  }

  openConfirm(generation: BackupKeyGeneration): void {
    this.facade.clearActionError();
    this.pasted.set(Array.from({ length: generation.kit.threshold }, () => ''));
    this.confirmFor.set(generation);
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.confirmFor.set(null);
  }

  setPasted(index: number, value: string): void {
    this.pasted.update((list) => list.map((v, i) => (i === index ? value : v)));
  }

  addPasted(): void {
    const max = this.confirmFor()?.kit.shares ?? MAX_KIT;

    this.pasted.update((list) => (list.length < max ? [...list, ''] : list));
  }

  async readFile(index: number, event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (file) this.setPasted(index, (await file.text()).trim());
  }

  submitConfirm(): void {
    const generation = this.confirmFor();
    const shares = this.pasted()
      .map((s) => s.trim())
      .filter(Boolean);

    if (generation && shares.length > 0) this.facade.confirm(generation.generation, shares);
  }

  askEscrow(generation: BackupKeyGeneration): void {
    this.facade.clearActionError();
    this.escrowFor.set(generation);
  }

  onEscrowOpenChange(open: boolean): void {
    if (!open) this.escrowFor.set(null);
  }

  escrow(): void {
    const generation = this.escrowFor();

    if (generation) this.facade.escrow(generation.generation);

    this.escrowFor.set(null);
  }

  downloadedShare(generation: BackupKeyGeneration, index: number) {
    return generation.kit.downloaded.find((d) => d.index === index && !!d.downloadedAt) ?? null;
  }

  shareIndexes(generation: BackupKeyGeneration): number[] {
    return Array.from({ length: generation.kit.shares }, (_, i) => i + 1);
  }

  isActing(action: string, generation: number | null, index?: number): boolean {
    const acting = this.acting();

    return (
      !!acting &&
      acting.action === action &&
      acting.generation === generation &&
      (index === undefined || acting.index === index)
    );
  }
}
