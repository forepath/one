import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  BackupsService,
  ConsoleAccessFacade,
  ConsoleBackupKeysFacade,
  ConsoleEndpointService,
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
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { saveFile } from '../live/live-format';
import { kitShareFileName } from './backup-format';
import { saveDrInfo } from './platform-backup-format';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { DL_COPY_ID } from '../section/data-list';

/** One share of a generation's kit (nested table). */
export interface KitShareRow {
  generation: number;
  index: number;
  of: number;
  downloadedAt: string | null;
  downloadedBy: string | null;
}

export type KitSizeDialog = { mode: 'rotate' } | { mode: 'reissue'; generation: number };

const MIN_KIT = 2;
const MAX_KIT = 16;

/**
 * The backup key and its recovery kit (3.20, cluster admins): key generations, the kit's shares (each handed out
 * once: saved as a text file and shown once), confirming the kit by pasting enough shares back, re-issuing the kit,
 * rotating the key and escrowing it in the KMS. Until a kit is confirmed (or the key escrowed) backups can't be
 * recovered without the cluster. Everything works in fleet mode too (2026-10-30): the kit goes through the fleet as
 * the signed person, so it needs a cluster that verifies this fleet's identity (else a note + the native console).
 */
@Component({
  selector: 'loadweaver-backup-keys-page',
  imports: [
    FpcFormFieldComponent,
    FpcFormControlComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    LoadweaverLaneComponent,
  ],
  templateUrl: './backup-keys-page.component.html',
  standalone: true,
})
export class LoadweaverBackupKeysPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupKeysFacade);
  private readonly document = inject(DOCUMENT);
  private readonly backups = inject(BackupsService);
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  /**
   * Fleet mode (3.24, 2026-10-30): the recovery kit (re-issue, hand-out, confirm) is relayed only as the signed person
   * — offered when the active cluster verifies this fleet's identity, else a note points to establishing trust and to
   * the cluster's own console. Rotation and KMS escrow work through the fleet either way.
   */
  readonly fleetMode = this.endpoints.fleetMode;
  readonly kitHere = computed(() => !this.fleetMode || !!this.me()?.fleetIdentity);
  readonly kitNeedsTrust = computed(() => this.fleetMode && !!this.me() && !this.me()?.fleetIdentity);
  readonly nativeKeysUrl = computed(() =>
    this.fleetMode ? this.endpoints.nativeConsoleUrl('/operate/backups/keys') : null,
  );

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
  readonly rotateLabel = $localize`:@@lwConsoleBackupKeys-rotate:Rotate key`;
  readonly drTitle = $localize`:@@lwConsoleBackupKeys-drTitle:Disaster recovery`;
  readonly generationsTitle = $localize`:@@lwConsoleBackupKeys-generationsTitle:Key generations`;
  /** Workbench (3.37): key generations | disaster recovery inspector; one lane at a time on phones. */
  readonly lane = signal<'generations' | 'dr'>('generations');
  readonly shareLabel = $localize`:@@lwConsoleBackupKeys-share:Share`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupKeys-refresh:Refresh`;
  readonly loadingLabel = $localize`:@@lwConsoleBackupKeys-loading:Loading backup keys`;
  readonly escrowLabel = $localize`:@@lwConsoleBackupKeys-escrow:Escrow in KMS`;
  readonly reissueLabel = $localize`:@@lwConsoleBackupKeys-reissue:Re-issue kit`;
  readonly confirmKitLabel = $localize`:@@lwConsoleBackupKeys-confirm:Confirm kit`;
  readonly drHint = $localize`:@@lwConsoleBackupKeys-drHint:Keep the DR info file (target locations and key generations, no secrets) with the kit: a fresh node needs both to rebuild the control plane.`;
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
  readonly downloadShareLabel = $localize`:@@lwConsoleBackupKeys-downloadShare:Download once`;
  readonly sharesTitle = $localize`:@@lwConsoleBackupKeys-shares:Kit shares`;
  readonly escrowedLabel = $localize`:@@lwConsoleBackupKeys-escrowed:Escrowed in KMS`;
  readonly kitConfirmedLabel = $localize`:@@lwConsoleBackupKeys-confirmed:Kit confirmed`;
  readonly kitUnconfirmedLabel = $localize`:@@lwConsoleBackupKeys-unconfirmed:Kit not confirmed`;

  /** The generation whose kit shares are open; `undefined`: none chosen — the active generation opens itself. */
  private readonly expandedChoice = signal<number | null | undefined>(undefined);
  readonly expanded = computed(() => {
    const choice = this.expandedChoice();

    if (choice !== undefined) return choice === null ? null : String(choice);

    const active = this.generations().find((g) => g.active);

    return active ? String(active.generation) : null;
  });
  /** Shares per generation (precomputed for the nested tables). */
  private readonly shareRows = computed(
    () =>
      new Map(
        this.generations().map((g) => [
          g.generation,
          this.shareIndexes(g).map((index): KitShareRow => {
            const d = this.downloadedShare(g, index);

            return {
              generation: g.generation,
              index,
              of: g.kit.shares,
              downloadedAt: d?.downloadedAt ?? null,
              downloadedBy: d?.downloadedBy ?? null,
            };
          }),
        ]),
      ),
  );
  readonly sharesOf = (g: BackupKeyGeneration): KitShareRow[] => this.shareRows().get(g.generation) ?? [];

  /** 3.38 D1: State (active / retired) · Generation · kit · kit state · escrow · created · retired; shares in the detail. */
  readonly generationColumns: FpcTableColumn<BackupKeyGeneration>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleBackupKeys-colState:State`,
      type: 'state',
      state: (g) =>
        g.active
          ? { label: $localize`:@@lwConsoleBackupKeys-active:Active`, tone: 'primary', icon: 'key-fill' }
          : { label: $localize`:@@lwConsoleBackupKeys-retired:Retired`, tone: 'neutral', icon: 'archive' },
    },
    {
      id: 'generation',
      label: this.generationLabel,
      value: (g) => g.generation,
      required: true,
      priority: 1,
    },
    {
      id: 'kitState',
      label: $localize`:@@lwConsoleBackupKeys-colKit:Recovery kit`,
      value: (g) => (g.kit.confirmedAt ? this.kitConfirmedLabel : this.kitUnconfirmedLabel),
      priority: 1,
    },
    {
      id: 'kitSize',
      label: $localize`:@@lwConsoleBackupKeys-colKitSize:Shares needed`,
      value: (g) => `${g.kit.threshold} / ${g.kit.shares}`,
      priority: 2,
    },
    {
      id: 'escrow',
      label: $localize`:@@lwConsoleBackupKeys-colEscrow:KMS escrow`,
      value: (g) => g.escrow?.provider ?? '',
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleBackupKeys-created:Created`,
      value: (g) => g.createdAt,
      priority: 2,
    },
    {
      id: 'retired',
      label: $localize`:@@lwConsoleBackupKeys-colRetired:Retired`,
      value: (g) => g.retiredAt,
      priority: 3,
    },
  ];

  /** Kit shares (nested): State (handed out) · Share · handed out at · by; "Download once" inline. */
  readonly shareColumns: FpcTableColumn<KitShareRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleBackupKeys-colState:State`,
      type: 'state',
      state: (s) =>
        s.downloadedAt
          ? {
              label: $localize`:@@lwConsoleBackupKeys-colHandedOutAt:Handed out`,
              tone: 'success',
              icon: 'person-check',
            }
          : { label: $localize`:@@lwConsoleBackupKeys-notHandedOut:Not handed out yet`, tone: 'warning' },
    },
    {
      id: 'share',
      label: this.shareLabel,
      value: (s) => `${s.index} / ${s.of}`,
      required: true,
      priority: 1,
    },
    {
      id: 'downloadedAt',
      label: $localize`:@@lwConsoleBackupKeys-colHandedOutAt:Handed out`,
      value: (s) => s.downloadedAt,
      priority: 1,
    },
    {
      id: 'downloadedBy',
      label: $localize`:@@lwConsoleBackupKeys-colHandedOutBy:By`,
      value: (s) => s.downloadedBy ?? '',
      priority: 2,
    },
  ];

  readonly generationId = (g: BackupKeyGeneration) => String(g.generation);
  readonly shareId = (s: KitShareRow) => String(s.index);
  /** ⋮ of a generation: escrow, re-issue, confirm the kit (in fleet mode once the cluster trusts it), copy the key id. */
  readonly generationMenu = (g: BackupKeyGeneration): FpcMenuItem[] => [
    ...(!g.escrow ? [{ id: 'escrow', label: this.escrowLabel, icon: 'safe2', disabled: this.acting() !== null }] : []),
    ...(this.kitHere()
      ? [
          { id: 'confirm', label: this.confirmKitLabel, icon: 'check2-square', disabled: this.acting() !== null },
          { id: 'reissue', label: this.reissueLabel, icon: 'arrow-clockwise', disabled: this.acting() !== null },
        ]
      : []),
    { id: 'copy-id', label: DL_COPY_ID, icon: 'copy', dividerBefore: true },
  ];
  /** The dominant action of a share row: hand it out (once). */
  readonly shareActions = (s: KitShareRow): FpcMenuItem[] =>
    !s.downloadedAt && this.kitHere()
      ? [{ id: 'download', label: this.downloadShareLabel, icon: 'download', disabled: this.acting() !== null }]
      : [];

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
    // Fleet mode: whether the active cluster verifies this fleet's identity decides where the kit is handled.
    if (this.fleetMode) this.access.load();
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

  toggle(generation: BackupKeyGeneration): void {
    this.expandedChoice.set(this.expanded() === String(generation.generation) ? null : generation.generation);
  }

  onGenerationAction(generation: BackupKeyGeneration, action: string): void {
    if (action === 'escrow') this.askEscrow(generation);
    else if (action === 'confirm') this.openConfirm(generation);
    else if (action === 'reissue') this.openSize({ mode: 'reissue', generation: generation.generation }, generation);
    else if (action === 'copy-id') fpcCopyText(generation.rootId);
  }

  onShareAction(share: KitShareRow, action: string): void {
    const generation = this.generations().find((g) => g.generation === share.generation);

    if (action === 'download' && generation) this.askShare(generation, share.index);
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
