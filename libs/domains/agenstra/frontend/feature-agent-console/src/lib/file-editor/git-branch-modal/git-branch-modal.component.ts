import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { VcsFacade, type GitBranch } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcSpinnerComponent,
  FpcBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, filter, map, Observable } from 'rxjs';

@Component({
  selector: 'framework-git-branch-modal',
  imports: [
    CommonModule,
    FormsModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './git-branch-modal.component.html',
  styleUrls: ['./git-branch-modal.component.scss'],
  standalone: true,
})
export class GitBranchModalComponent {
  private readonly vcsFacade = inject(VcsFacade);
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
  deletingBranch = signal<string | null>(null);
  switchingBranch = signal<string | null>(null);
  private wasCreatingBranch = false;
  private wasSwitchingBranch = false;

  readonly branches$: Observable<GitBranch[]> = this.vcsFacade.branches$;
  readonly currentBranch$: Observable<string | undefined> = this.vcsFacade.currentBranch$;
  readonly loadingBranches$ = this.vcsFacade.loadingBranches$;
  readonly creatingBranch$ = this.vcsFacade.creatingBranch$;
  readonly deletingBranch$ = this.vcsFacade.deletingBranch$;
  readonly switchingBranch$ = this.vcsFacade.switchingBranch$;

  readonly localBranches$ = this.branches$.pipe(
    map((branches) => branches.filter((b) => !b.isRemote).sort((a, b) => a.name.localeCompare(b.name))),
  );

  readonly remoteBranches$ = this.branches$.pipe(
    map((branches) => branches.filter((b) => b.isRemote).sort((a, b) => a.name.localeCompare(b.name))),
  );

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

  onDeleteBranch(branch: GitBranch): void {
    if (branch.isCurrent || branch.isRemote) {
      return;
    }

    this.deletingBranch.set(branch.name);
    this.vcsFacade.deleteBranch(this.clientId(), this.agentId(), branch.name);
  }

  onClose(): void {
    this.modalOpen.set(false);
    this.closed.emit();
  }
}
