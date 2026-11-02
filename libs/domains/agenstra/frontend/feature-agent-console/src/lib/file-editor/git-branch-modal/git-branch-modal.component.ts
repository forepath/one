import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { VcsFacade, VcsService, type GitBranch } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  ReferenceComboboxComponent,
  type ReferenceComboboxOption,
} from '@forepath/agenstra/frontend/feature-agent-config';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcLabelComponent,
  FpcModalComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, filter, firstValueFrom, Observable } from 'rxjs';

import { agBulkSummary } from '../../shared/data-list';

export type GitBranchTab = 'local' | 'remote';

@Component({
  selector: 'framework-git-branch-modal',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcLabelComponent,
    FpcModalComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    ReferenceComboboxComponent,
  ],
  templateUrl: './git-branch-modal.component.html',
  styleUrls: ['./git-branch-modal.component.scss'],
  standalone: true,
})
export class GitBranchModalComponent {
  private readonly vcsFacade = inject(VcsFacade);
  private readonly vcsService = inject(VcsService);
  private readonly destroyRef = inject(DestroyRef);

  clientId = input.required<string>();
  agentId = input.required<string>();
  isOpen = input<boolean>(false);

  closed = output<void>();

  readonly modalOpen = signal(false);

  selectedBranch = signal<string>('');
  newBranchName = signal<string>('');
  useConventionalPrefix = signal<boolean>(true);
  conventionalType = signal<'feat' | 'fix' | 'chore' | 'docs' | 'style' | 'refactor' | 'test' | 'perf'>('feat');
  customBranchName = signal<string>('');
  manualSwitchBranchName = signal<string>('');
  manualSwitchInProgress = signal<boolean>(false);
  creatingBranch = signal<boolean>(false);
  switchingBranch = signal<string | null>(null);
  private wasCreatingBranch = false;
  private wasSwitchingBranch = false;

  readonly branches$: Observable<GitBranch[]> = this.vcsFacade.branches$;
  readonly currentBranch$: Observable<string | undefined> = this.vcsFacade.currentBranch$;
  readonly loadingBranches$ = this.vcsFacade.loadingBranches$;
  readonly creatingBranch$ = this.vcsFacade.creatingBranch$;
  readonly deletingBranch$ = this.vcsFacade.deletingBranch$;
  readonly switchingBranch$ = this.vcsFacade.switchingBranch$;

  private readonly branches = toSignal(this.branches$, { initialValue: [] as GitBranch[] });

  readonly localBranches = computed(() =>
    this.branches()
      .filter((b) => !b.isRemote)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  readonly remoteBranches = computed(() =>
    this.branches()
      .filter((b) => b.isRemote)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Quick switch suggestions: the loaded branches (local by name, remote as `remote/name`), never the current one. */
  readonly quickSwitchOptions = computed<ReferenceComboboxOption[]>(() => [
    ...this.localBranches()
      .filter((b) => !b.isCurrent)
      .map((b) => ({ value: b.name, detail: this.localBranchDetail })),
    ...this.remoteBranches().map((b) => ({
      value: b.remote ? `${b.remote}/${b.name}` : b.name,
      detail: this.remoteBranchDetail,
    })),
  ]);
  readonly noBranchesFoundLabel = $localize`:@@featureGitBranchModal-noBranchesFound:No branches found.`;
  private readonly localBranchDetail = $localize`:@@featureGitBranchModal-stateLocal:Local branch`;
  private readonly remoteBranchDetail = $localize`:@@featureGitBranchModal-stateRemote:Remote branch`;

  // Tables (3.38: tabs instead of stacked lists, ⋮ row actions, bulk Delete of local branches)
  readonly branchTab = signal<GitBranchTab>('local');
  readonly localQuery = signal('');
  readonly remoteQuery = signal('');
  readonly selectedLocalNames = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkDeleteOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);

  readonly visibleLocalBranches = computed(() => this.searchBranches(this.localBranches(), this.localQuery()));
  readonly visibleRemoteBranches = computed(() => this.searchBranches(this.remoteBranches(), this.remoteQuery()));

  readonly deletableSelected = computed(() => {
    const names = new Set(this.selectedLocalNames());

    return this.localBranches().filter((b) => names.has(b.ref || b.name) && !b.isCurrent);
  });

  readonly localBranchesLabel = $localize`:@@featureGitBranchModal-localBranchesLabel:Local Branches`;
  readonly remoteBranchesLabel = $localize`:@@featureGitBranchModal-remoteBranchesLabel:Remote Branches`;
  readonly searchBranchesPlaceholder = $localize`:@@featureGitBranchModal-searchBranches:Search branches`;
  readonly deleteBranchLabel = $localize`:@@featureGitBranchModal-deleteBranchTitle:Delete branch`;
  private readonly switchLabel = $localize`:@@featureGitBranchModal-switchToBranchTitle:Switch to this branch`;
  private readonly checkoutLabel = $localize`:@@featureGitBranchModal-checkoutRemoteTitle:Checkout and create local tracking branch`;

  readonly branchRowId = (branch: GitBranch): string => branch.ref || branch.name;

  private readonly commitColumn: FpcTableColumn<GitBranch> = {
    id: 'commit',
    label: $localize`:@@featureGitBranchModal-colCommit:Commit`,
    value: (b) => (b.commit ?? '').substring(0, 7),
    mono: true,
    priority: 3,
  };

  private readonly messageColumn: FpcTableColumn<GitBranch> = {
    id: 'message',
    label: $localize`:@@featureGitBranchModal-colMessage:Last commit`,
    value: (b) => b.message ?? '',
    priority: 2,
  };

  readonly localColumns: FpcTableColumn<GitBranch>[] = [
    {
      id: 'state',
      label: $localize`:@@featureGitBranchModal-colState:State`,
      type: 'state',
      state: (b) => this.localState(b),
    },
    {
      id: 'name',
      label: $localize`:@@featureGitBranchModal-colBranch:Branch`,
      value: (b) => b.name,
      required: true,
      priority: 1,
    },
    {
      id: 'sync',
      label: $localize`:@@featureGitBranchModal-colSync:Ahead / behind`,
      value: (b) => this.syncLabel(b),
      priority: 1,
    },
    this.messageColumn,
    this.commitColumn,
  ];

  readonly remoteColumns: FpcTableColumn<GitBranch>[] = [
    {
      id: 'state',
      label: $localize`:@@featureGitBranchModal-colState:State`,
      type: 'state',
      state: () => ({
        label: $localize`:@@featureGitBranchModal-stateRemote:Remote branch`,
        tone: 'neutral',
        icon: 'cloud',
      }),
    },
    {
      id: 'name',
      label: $localize`:@@featureGitBranchModal-colBranch:Branch`,
      value: (b) => b.name,
      required: true,
      priority: 1,
    },
    {
      id: 'remote',
      label: $localize`:@@featureGitBranchModal-colRemote:Remote`,
      value: (b) => b.remote ?? '',
      priority: 1,
    },
    this.messageColumn,
    this.commitColumn,
  ];

  /** The dominant row action as an inline icon: switch / checkout (not for the current branch). */
  readonly switchInlineAction = (b: GitBranch): FpcMenuItem[] =>
    b.isCurrent
      ? []
      : [
          b.isRemote
            ? { id: 'switch', label: this.checkoutLabel, icon: 'download', disabled: this.switchingBranch() !== null }
            : {
                id: 'switch',
                label: this.switchLabel,
                icon: 'arrow-right-circle',
                disabled: this.switchingBranch() !== null,
              },
        ];

  readonly localRowMenu = (b: GitBranch): FpcMenuItem[] =>
    b.isCurrent
      ? []
      : [
          { id: 'switch', label: this.switchLabel, icon: 'arrow-right-circle' },
          { id: 'delete', label: this.deleteBranchLabel, icon: 'trash', danger: true, dividerBefore: true },
        ];

  readonly remoteRowMenu = (): FpcMenuItem[] => [{ id: 'switch', label: this.checkoutLabel, icon: 'download' }];

  private localState(b: GitBranch): FpcTableState {
    if (b.isCurrent) {
      return {
        label: $localize`:@@featureGitBranchModal-stateCurrent:Current branch`,
        tone: 'primary',
        icon: 'check-circle-fill',
      };
    }

    if ((b.behindCount ?? 0) > 0) {
      return {
        label: $localize`:@@featureGitBranchModal-stateBehind:Behind`,
        tone: 'warning',
        icon: 'arrow-down-circle',
      };
    }

    if ((b.aheadCount ?? 0) > 0) {
      return { label: $localize`:@@featureGitBranchModal-stateAhead:Ahead`, tone: 'success', icon: 'arrow-up-circle' };
    }

    return { label: $localize`:@@featureGitBranchModal-stateLocal:Local branch`, tone: 'neutral', icon: 'diagram-3' };
  }

  private searchBranches(branches: GitBranch[], query: string): GitBranch[] {
    const needle = query.trim().toLowerCase();

    return needle
      ? branches.filter((b) => `${b.name} ${b.remote ?? ''} ${b.message ?? ''}`.toLowerCase().includes(needle))
      : branches;
  }

  private syncLabel(b: GitBranch): string {
    const parts: string[] = [];

    if ((b.aheadCount ?? 0) > 0) parts.push(`+${b.aheadCount}`);
    if ((b.behindCount ?? 0) > 0) parts.push(`−${b.behindCount}`);

    return parts.join(' / ');
  }

  readonly branchName = computed(() => {
    if (!this.useConventionalPrefix()) {
      return this.customBranchName();
    }

    const prefix = `${this.conventionalType()}/`;
    const name = this.customBranchName() || '';

    return name.startsWith(prefix) ? name : `${prefix}${name}`;
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();

      this.modalOpen.set(open);

      if (open) {
        this.loadBranches();
      }
    });

    combineLatest([this.vcsFacade.creatingBranch$, this.vcsFacade.deletingBranch$, this.vcsFacade.switchingBranch$])
      .pipe(
        filter(([creating, deleting, switching]) => !creating && !deleting && !switching),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.wasCreatingBranch || this.wasSwitchingBranch) {
          this.onClose();
        }

        this.wasCreatingBranch = false;
        this.wasSwitchingBranch = false;

        setTimeout(() => {
          this.loadBranches();
          this.loadStatus();
        }, 500);
      });

    this.vcsFacade.creatingBranch$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((creating) => {
      if (creating) {
        this.wasCreatingBranch = true;
      }
    });

    this.vcsFacade.switchingBranch$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((switching) => {
      if (switching) {
        this.wasSwitchingBranch = true;
      } else {
        this.switchingBranch.set(null);
        this.manualSwitchInProgress.set(false);
      }
    });
  }

  loadBranches(): void {
    this.vcsFacade.loadBranches(this.clientId(), this.agentId());
  }

  loadStatus(): void {
    this.vcsFacade.loadStatus(this.clientId(), this.agentId());
  }

  onSwitchBranch(branch: GitBranch): void {
    if (branch.isCurrent) {
      return;
    }

    this.switchingBranch.set(branch.name);

    if (branch.isRemote && branch.remote) {
      const remoteBranchRef = `${branch.remote}/${branch.name}`;

      this.vcsFacade.switchBranch(this.clientId(), this.agentId(), remoteBranchRef);
    } else {
      this.vcsFacade.switchBranch(this.clientId(), this.agentId(), branch.name);
    }
  }

  onManualSwitchBranch(): void {
    const targetBranch = this.manualSwitchBranchName().trim();

    if (!targetBranch) {
      return;
    }

    this.switchingBranch.set(targetBranch);
    this.manualSwitchInProgress.set(true);
    this.vcsFacade.switchBranch(this.clientId(), this.agentId(), targetBranch);
    this.manualSwitchBranchName.set('');
  }

  onCreateBranch(): void {
    const name = this.branchName().trim();

    if (!name) {
      return;
    }

    this.creatingBranch.set(true);
    this.vcsFacade.createBranch(this.clientId(), this.agentId(), {
      name: this.customBranchName(),
      useConventionalPrefix: this.useConventionalPrefix(),
      conventionalType: this.conventionalType(),
    });

    this.customBranchName.set('');
    this.useConventionalPrefix.set(true);
    this.conventionalType.set('feat');
  }

  onBranchTabChange(tab: string | null): void {
    if (tab === 'local' || tab === 'remote') {
      this.branchTab.set(tab);
    }
  }

  onBranchAction(branch: GitBranch, action: string): void {
    switch (action) {
      case 'switch':
        this.onSwitchBranch(branch);
        break;
      case 'delete':
        this.selectedLocalNames.set([this.branchRowId(branch)]);
        this.bulkDeleteOpen.set(true);
        break;
    }
  }

  /** Bulk Delete: one delete call per selected local branch (never the current one), per-branch result. */
  async onConfirmBulkDelete(): Promise<void> {
    this.bulkDeleteOpen.set(false);
    const branches = this.deletableSelected();

    if (branches.length === 0) {
      return;
    }

    const clientId = this.clientId();
    const agentId = this.agentId();

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(branches, (branch) =>
        firstValueFrom(this.vcsService.deleteBranch(clientId, agentId, branch.name)),
      );

      this.bulkResult.set(agBulkSummary(result, (branch) => branch.name));
      this.selectedLocalNames.set(result.failed.concat(result.denied).map((branch) => this.branchRowId(branch)));
      this.loadBranches();
    } finally {
      this.bulkBusy.set(false);
    }
  }

  onClose(): void {
    this.modalOpen.set(false);
    this.closed.emit();
  }
}
