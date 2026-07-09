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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  DeploymentsFacade,
  type CreateDeploymentConfigurationDto,
  type DeploymentConfiguration,
  type UpdateDeploymentConfigurationDto,
  type Workflow,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { take } from 'rxjs';

@Component({
  selector: 'framework-deployment-configuration',
  imports: [CommonModule, FormsModule],
  templateUrl: './deployment-configuration.component.html',
  styleUrls: ['./deployment-configuration.component.scss'],
  standalone: true,
})
export class DeploymentConfigurationComponent {
  private readonly deploymentsFacade = inject(DeploymentsFacade);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('configurationModal', { static: false })
  private configurationModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteConfigurationConfirmModal', { static: false })
  private deleteConfigurationConfirmModal!: ElementRef<HTMLDivElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();

  // Outputs
  readonly configurationSaved = output<DeploymentConfiguration>();
  readonly configurationDeleted = output<void>();
  readonly repositorySelected = output<string>();
  readonly branchSelected = output<string>();
  readonly workflowSelected = output<string>();
  readonly triggerWorkflow = output<{ workflow: Workflow; branch: string; inputs?: Record<string, string> }>();

  // State from facade
  readonly configuration$ = this.deploymentsFacade.configuration$;
  readonly repositories$ = this.deploymentsFacade.repositories$;
  readonly branches$ = this.deploymentsFacade.branches$;
  readonly workflows$ = this.deploymentsFacade.workflows$;
  readonly loadingConfiguration$ = this.deploymentsFacade.loadingConfiguration$;
  readonly loadingRepositories$ = this.deploymentsFacade.loadingRepositories$;
  readonly loadingBranches$ = this.deploymentsFacade.loadingBranches$;
  readonly loadingWorkflows$ = this.deploymentsFacade.loadingWorkflows$;
  readonly creatingConfiguration$ = this.deploymentsFacade.creatingConfiguration$;
  readonly updatingConfiguration$ = this.deploymentsFacade.updatingConfiguration$;
  readonly deletingConfiguration$ = this.deploymentsFacade.deletingConfiguration$;
  readonly triggeringWorkflow$ = this.deploymentsFacade.triggeringWorkflow$;
  readonly error$ = this.deploymentsFacade.error$;

  // Convert observables to signals
  readonly configuration = toSignal(this.configuration$, { initialValue: null });
  readonly repositories = toSignal(this.repositories$, { initialValue: [] });
  readonly branches = toSignal(this.branches$, { initialValue: [] });
  readonly workflows = toSignal(this.workflows$, { initialValue: [] });
  readonly error = toSignal(this.error$, { initialValue: null });

  // Form state
  readonly selectedRepositoryId = signal<string | null>(null);
  readonly selectedBranch = signal<string | null>(null);
  readonly selectedWorkflowId = signal<string | null>(null);
  readonly workflowInputs = signal<Record<string, string>>({});

  // Form fields
  readonly providerType = signal<string>('github');
  readonly repositoryId = signal<string>('');
  readonly defaultBranch = signal<string>('');
  readonly workflowId = signal<string>('');
  readonly providerToken = signal<string>('');
  readonly providerBaseUrl = signal<string>('');

  readonly hasConfiguration = computed(() => this.configuration() !== null);
  readonly canTriggerWorkflow = computed(() => {
    return (
      this.selectedWorkflowId() !== null &&
      this.selectedBranch() !== null &&
      this.workflows().some((w) => w.id === this.selectedWorkflowId() && w.canTrigger)
    );
  });

  readonly workflowInputsEntries = computed(() => {
    return Object.entries(this.workflowInputs()).map(([key, value]) => ({ key, value }));
  });

  readonly selectedWorkflow = computed(() => {
    const workflowId = this.selectedWorkflowId();

    if (!workflowId) {
      return null;
    }

    return this.workflows().find((w) => w.id === workflowId) || null;
  });

  readonly showWorkflowInputs = computed(() => {
    return this.selectedWorkflow() !== null;
  });

  // Filter out 404 errors (not found) since we have a "Create Configuration" button
  readonly filteredError = computed(() => {
    const error = this.error();

    if (!error) {
      return null;
    }

    // Hide 404-related errors (not found)
    const lowerError = error.toLowerCase();

    if (lowerError.includes('not found') || lowerError.includes('404')) {
      return null;
    }

    return error;
  });

  constructor() {
    // Initialize form when configuration is loaded
    effect(() => {
      const config = this.configuration();

      if (config) {
        this.providerType.set(config.providerType);
        this.repositoryId.set(config.repositoryId);
        this.defaultBranch.set(config.defaultBranch || '');
        this.workflowId.set(config.workflowId || '');
        this.providerBaseUrl.set(config.providerBaseUrl || '');
        // Don't set token (it's encrypted)
      }
    });

    // Pre-select repository from configuration when repositories are loaded
    effect(() => {
      const config = this.configuration();
      const repos = this.repositories();

      // Pre-select if we have a configuration with a repositoryId and repositories are loaded
      if (config?.repositoryId && repos.length > 0) {
        // Find matching repository, handling both full (owner/repo) and short (repo) formats
        const matchingRepo = repos.find((repo) => this.matchesRepositoryId(repo, config.repositoryId));

        // Only set if a match is found and is different from current selection (to avoid unnecessary updates)
        if (matchingRepo && this.selectedRepositoryId() !== matchingRepo.id) {
          // Use setTimeout to defer the update to the next tick, ensuring the select is fully rendered
          setTimeout(() => {
            this.selectedRepositoryId.set(matchingRepo.id);
          }, 0);
        }
      }
    });

    // Load branches when repository is selected
    effect(() => {
      const repositoryId = this.selectedRepositoryId();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (repositoryId && clientId && agentId) {
        this.deploymentsFacade.loadBranches(clientId, agentId, repositoryId);
        this.repositorySelected.emit(repositoryId);
      }
    });

    // Pre-select branch from configuration when branches are loaded
    effect(() => {
      const config = this.configuration();
      const branches = this.branches();
      const repositoryId = this.selectedRepositoryId();

      // Only pre-select if we have a repository selected and branches are loaded
      if (repositoryId && branches.length > 0) {
        let branchToSelect: string | null = null;

        // First, try the defaultBranch from configuration
        if (config?.defaultBranch) {
          const branchExists = branches.some((branch) => branch.name === config.defaultBranch);

          if (branchExists) {
            branchToSelect = config.defaultBranch;
          }
        }

        // If no defaultBranch or it doesn't exist, try "main"
        if (!branchToSelect) {
          const mainBranch = branches.find((branch) => branch.name === 'main');

          if (mainBranch) {
            branchToSelect = 'main';
          }
        }

        // If "main" doesn't exist, try "master"
        if (!branchToSelect) {
          const masterBranch = branches.find((branch) => branch.name === 'master');

          if (masterBranch) {
            branchToSelect = 'master';
          }
        }

        // Set the selected branch if we found one and it's different from current selection
        if (branchToSelect && this.selectedBranch() !== branchToSelect) {
          // Use setTimeout to defer the update to the next tick, ensuring the select is fully rendered
          setTimeout(() => {
            this.selectedBranch.set(branchToSelect);
          }, 0);
        }
      }
    });

    // Load workflows when repository or branch changes
    effect(() => {
      const repositoryId = this.selectedRepositoryId();
      const branch = this.selectedBranch();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (repositoryId && clientId && agentId) {
        this.deploymentsFacade.loadWorkflows(clientId, agentId, repositoryId, branch || undefined);
      }
    });

    // Pre-select workflow from configuration when workflows are loaded
    effect(() => {
      const config = this.configuration();
      const workflows = this.workflows();
      const repositoryId = this.selectedRepositoryId();
      const branch = this.selectedBranch();

      // Only pre-select if we have a repository, branch, and workflows are loaded
      if (repositoryId && branch && workflows.length > 0) {
        // First, try the workflowId from configuration
        if (config?.workflowId) {
          const matchingWorkflow = workflows.find((workflow) => workflow.id === config.workflowId);

          // Only set if a match is found and is different from current selection
          if (matchingWorkflow && this.selectedWorkflowId() !== matchingWorkflow.id) {
            // Use setTimeout to defer the update to the next tick, ensuring the select is fully rendered
            setTimeout(() => {
              this.selectedWorkflowId.set(matchingWorkflow.id);
            }, 0);
          }
        }
      }
    });
  }

  onShowConfigurationForm(): void {
    this.showModal();
  }

  onCancelConfigurationForm(): void {
    this.hideModal();
    // Reset form to current configuration
    const config = this.configuration();

    if (config) {
      this.providerType.set(config.providerType);
      this.repositoryId.set(config.repositoryId);
      this.defaultBranch.set(config.defaultBranch || '');
      this.workflowId.set(config.workflowId || '');
      this.providerBaseUrl.set(config.providerBaseUrl || '');
    }
  }

  onSaveConfiguration(): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    const config = this.configuration();

    if (config) {
      // Update existing configuration
      const updateDto: UpdateDeploymentConfigurationDto = {
        repositoryId: this.repositoryId(),
        defaultBranch: this.defaultBranch() || undefined,
        workflowId: this.workflowId() || undefined,
        providerToken: this.providerToken() || undefined,
        providerBaseUrl: this.providerBaseUrl() || undefined,
      };

      this.deploymentsFacade.updateConfiguration(clientId, agentId, updateDto);
    } else {
      // Create new configuration
      const createDto: CreateDeploymentConfigurationDto = {
        providerType: this.providerType(),
        repositoryId: this.repositoryId(),
        defaultBranch: this.defaultBranch() || undefined,
        workflowId: this.workflowId() || undefined,
        providerToken: this.providerToken(),
        providerBaseUrl: this.providerBaseUrl() || undefined,
      };

      this.deploymentsFacade.createConfiguration(clientId, agentId, createDto);
    }

    // Listen for success
    this.deploymentsFacade.configuration$.pipe(take(2), takeUntilDestroyed(this.destroyRef)).subscribe((newConfig) => {
      if (newConfig) {
        this.configurationSaved.emit(newConfig);
        this.hideModal();
      }
    });
  }

  onOpenDeleteConfigurationConfirm(): void {
    setTimeout(() => this.showDeleteConfigurationConfirmModal(), 0);
  }

  onCancelDeleteConfigurationConfirm(): void {
    this.hideDeleteConfigurationConfirmModal();
  }

  confirmDeleteConfiguration(): void {
    this.hideDeleteConfigurationConfirmModal();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.deploymentsFacade.deleteConfiguration(clientId, agentId);
      this.configurationDeleted.emit();
      this.providerType.set('github');
      this.repositoryId.set('');
      this.defaultBranch.set('');
      this.workflowId.set('');
      this.providerToken.set('');
      this.providerBaseUrl.set('');
      this.selectedRepositoryId.set(null);
      this.selectedBranch.set(null);
      this.selectedWorkflowId.set(null);
    }
  }

  onSelectRepository(repositoryId: string): void {
    this.selectedRepositoryId.set(repositoryId);
    this.selectedBranch.set(null);
    this.selectedWorkflowId.set(null);
  }

  onSelectBranch(branch: string): void {
    this.selectedBranch.set(branch);
    this.selectedWorkflowId.set(null);
    this.branchSelected.emit(branch);
  }

  onSelectWorkflow(workflowId: string): void {
    this.selectedWorkflowId.set(workflowId);
    this.workflowSelected.emit(workflowId);
  }

  onAddWorkflowInput(): void {
    const inputs = this.workflowInputs();
    const newKey = `input_${Object.keys(inputs).length + 1}`;

    this.workflowInputs.set({ ...inputs, [newKey]: '' });
  }

  onRemoveWorkflowInput(key: string): void {
    const inputs = this.workflowInputs();
    const newInputs = { ...inputs };

    delete newInputs[key];
    this.workflowInputs.set(newInputs);
  }

  onUpdateWorkflowInput(key: string, value: string): void {
    const inputs = this.workflowInputs();

    this.workflowInputs.set({ ...inputs, [key]: value });
  }

  onTriggerWorkflowClick(): void {
    const workflowId = this.selectedWorkflowId();
    const branch = this.selectedBranch();

    if (!workflowId || !branch) {
      return;
    }

    const workflow = this.workflows().find((w) => w.id === workflowId);

    if (!workflow) {
      return;
    }

    const inputs = this.workflowInputs();
    const filteredInputs = Object.fromEntries(Object.entries(inputs).filter(([, value]) => value.trim() !== ''));

    this.triggerWorkflow.emit({
      workflow,
      branch,
      inputs: Object.keys(filteredInputs).length > 0 ? filteredInputs : undefined,
    });
  }

  getProviderDisplayName(providerType: string): string {
    switch (providerType) {
      case 'github':
        return 'GitHub Actions';
      case 'gitlab':
        return 'GitLab CI/CD';
      default:
        return providerType;
    }
  }

  /**
   * Check if a repository matches the given repositoryId, handling both full (owner/repo) and short (repo) formats
   */
  private matchesRepositoryId(repo: { id: string; name: string; fullName: string }, repositoryId: string): boolean {
    // Exact match on id
    if (repo.id === repositoryId) {
      return true;
    }

    // Match on fullName (e.g., "forepath/laravel-s3-server")
    if (repo.fullName === repositoryId) {
      return true;
    }

    // Match on name (e.g., "laravel-s3-server")
    if (repo.name === repositoryId) {
      return true;
    }

    // Handle case where repositoryId is in short format but repo.id is in full format
    // e.g., repositoryId = "laravel-s3-server", repo.id = "forepath/laravel-s3-server"
    if (repo.id.endsWith(`/${repositoryId}`)) {
      return true;
    }

    // Handle case where repositoryId is in full format but repo.id is in short format
    // e.g., repositoryId = "forepath/laravel-s3-server", repo.id = "laravel-s3-server"
    if (repositoryId.endsWith(`/${repo.id}`)) {
      return true;
    }

    // Handle case where repositoryId is in full format but matches repo.name
    // e.g., repositoryId = "forepath/laravel-s3-server", repo.name = "laravel-s3-server"
    if (repositoryId.endsWith(`/${repo.name}`)) {
      return true;
    }

    return false;
  }

  /**
   * Show the Bootstrap modal
   */
  private showModal(): void {
    if (this.configurationModal?.nativeElement) {
      // Use Bootstrap 5 Modal API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getOrCreateInstance(this.configurationModal.nativeElement);

      if (modal) {
        modal.show();
      } else {
        // Fallback: create new modal instance
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Modal = (window as any).bootstrap?.Modal;

        if (Modal) {
          new Modal(this.configurationModal.nativeElement).show();
        }
      }
    }
  }

  /**
   * Hide the Bootstrap modal
   */
  private hideModal(): void {
    if (this.configurationModal?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getInstance(this.configurationModal.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }

  private showDeleteConfigurationConfirmModal(): void {
    const el = this.deleteConfigurationConfirmModal?.nativeElement;

    if (!el) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Modal = (window as any).bootstrap?.Modal;

    if (!Modal) {
      return;
    }

    const inst = Modal.getOrCreateInstance ? Modal.getOrCreateInstance(el) : new Modal(el);

    inst.show();
  }

  private hideDeleteConfigurationConfirmModal(): void {
    const el = this.deleteConfigurationConfirmModal?.nativeElement;

    if (!el) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modal = (window as any).bootstrap?.Modal?.getInstance(el);

    modal?.hide();
  }

  getModalTitle(): string {
    return this.hasConfiguration()
      ? $localize`:@@featureDeploymentConfig-editModalTitle:Edit Deployment Configuration`
      : $localize`:@@featureDeploymentConfig-createModalTitle:Create Deployment Configuration`;
  }

  getTokenLabel(): string {
    return this.providerType() === 'github'
      ? $localize`:@@featureDeploymentConfig-githubTokenLabel:GitHub Token`
      : $localize`:@@featureDeploymentConfig-gitlabTokenLabel:GitLab Token`;
  }

  getTokenHint(): string {
    return this.hasConfiguration()
      ? $localize`:@@featureDeploymentConfig-tokenHintKeepCurrent:Leave empty to keep the current token`
      : $localize`:@@featureDeploymentConfig-tokenHintRequired:Required for authentication`;
  }

  getTokenPlaceholder(): string {
    return this.hasConfiguration()
      ? $localize`:@@featureDeploymentConfig-tokenPlaceholderKeepCurrent:Leave empty to keep current token`
      : $localize`:@@featureDeploymentConfig-tokenPlaceholderEnter:Enter token`;
  }
}
