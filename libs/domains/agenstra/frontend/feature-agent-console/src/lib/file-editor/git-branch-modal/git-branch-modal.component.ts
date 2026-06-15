import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { VcsFacade, type GitBranch } from '@forepath/agenstra/frontend/data-access-agent-console';
import { combineLatest, filter, map, Observable } from 'rxjs';

@Component({
  selector: 'framework-git-branch-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './git-branch-modal.component.html',
  styleUrls: ['./git-branch-modal.component.scss'],
  standalone: true,
})
export class GitBranchModalComponent {
  private readonly vcsFacade = inject(VcsFacade);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('branchModal', { static: false })
  private branchModal!: ElementRef<HTMLDivElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  isOpen = input<boolean>(false);

  // Outputs
  closed = output<void>();

  // Internal state
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

  // Observables
  readonly branches$: Observable<GitBranch[]> = this.vcsFacade.branches$;
  readonly currentBranch$: Observable<string | undefined> = this.vcsFacade.currentBranch$;
  readonly loadingBranches$ = this.vcsFacade.loadingBranches$;
  readonly creatingBranch$ = this.vcsFacade.creatingBranch$;
  readonly deletingBranch$ = this.vcsFacade.deletingBranch$;
  readonly switchingBranch$ = this.vcsFacade.switchingBranch$;

  // Computed
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
    // Watch for modal open/close
    effect(() => {
      const open = this.isOpen();

      if (open) {
        this.loadBranches();
        setTimeout(() => this.showModal(), 100);
      } else {
        this.hideModal();
      }
    });

    // Watch for successful operations to reload branches and close modal
    combineLatest([this.vcsFacade.creatingBranch$, this.vcsFacade.deletingBranch$, this.vcsFacade.switchingBranch$])
      .pipe(
        filter(([creating, deleting, switching]) => !creating && !deleting && !switching),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Close modal if we just created or switched to a branch
        if (this.wasCreatingBranch || this.wasSwitchingBranch) {
          this.onClose();
        }

        // Reset flags
        this.wasCreatingBranch = false;
        this.wasSwitchingBranch = false;

        // Small delay to ensure backend has processed the change
        setTimeout(() => {
          this.loadBranches();
          this.loadStatus();
        }, 500);
      });

    // Track when operations start
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

    // For remote branches, use the format "remote/branch-name" to create a local tracking branch
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

    // Reset form
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
    this.hideModal();
    this.closed.emit();
  }

  private showModal(): void {
    if (this.branchModal?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getOrCreateInstance(this.branchModal.nativeElement);

      if (modal) {
        modal.show();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Modal = (window as any).bootstrap?.Modal;

        if (Modal) {
          new Modal(this.branchModal.nativeElement).show();
        }
      }
    }
  }

  private hideModal(): void {
    if (this.branchModal?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getInstance(this.branchModal.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }
}
