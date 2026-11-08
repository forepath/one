import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  WorkspaceDeploymentsFacade,
  WorkspaceDeploymentsService,
  type AgentResponseDto,
  type CreateDeploymentWorkflowDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  DEPLOYMENT_LIMITS,
  type DeploymentBranchSummary,
  type DeploymentConnectionOption,
  type DeploymentProviderWorkflowSummary,
  type DeploymentRepositorySummary,
  type DeploymentWorkflowScope,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcMapEditorComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcMultiSelectComponent,
  FpcTypeaheadSelectComponent,
  type FpcMapValue,
  type FpcMultiSelectOption,
} from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, filter, of, switchMap, tap } from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';

import { deploymentProviderLabel } from './deployment-labels';
import { deploymentInputsEditorLabels, deploymentInputsFromMap } from './deployment-trigger-modal.component';

const REPOSITORY_SEARCH_DEBOUNCE_MS = 300;

/**
 * Create / edit modal of a deployment workflow (workspace admins only; the API refuses everyone else): connection of
 * the workspace (`GET connections`), repository typeahead from the provider, workflow (GitHub) and default branch
 * pickers, default inputs, availability (every environment, or assigned ones), whether assigned environments may
 * trigger runs through MCP, and whether the workflow is enabled. Emits the DTO; the page saves it.
 */
@Component({
  selector: 'framework-deployment-workflow-editor',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcMapEditorComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcMultiSelectComponent,
    FpcTypeaheadSelectComponent,
  ],
  templateUrl: './deployment-workflow-editor.component.html',
})
export class DeploymentWorkflowEditorComponent {
  readonly open = model(false);
  readonly clientId = input<string | null>(null);
  /** `null`: create a new workflow. */
  readonly workflow = input<DeploymentWorkflowSummary | null>(null);
  readonly agents = input<readonly AgentResponseDto[]>([]);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<CreateDeploymentWorkflowDto>();

  readonly createTitle = $localize`:@@featureDeployments-editorCreateTitle:Create pipeline`;
  readonly editTitle = $localize`:@@featureDeployments-editorEditTitle:Edit pipeline`;
  readonly nameLabel = $localize`:@@featureDeployments-editorName:Name`;
  readonly descriptionLabel = $localize`:@@featureDeployments-editorDescription:Description`;
  readonly connectionLabel = $localize`:@@featureDeployments-editorConnection:Connection`;
  readonly connectionHint = $localize`:@@featureDeployments-editorConnectionHint:CI/CD connections are managed by instance admins under Connections.`;
  readonly repositoryLabel = $localize`:@@featureDeployments-editorRepository:Repository`;
  readonly repositoryPlaceholder = $localize`:@@featureDeployments-editorRepositoryPlaceholder:Search repositories or enter one`;
  readonly workflowLabel = $localize`:@@featureDeployments-editorWorkflow:GitHub workflow`;
  readonly workflowHint = $localize`:@@featureDeployments-editorWorkflowHint:GitHub Actions workflow to dispatch (needs a workflow_dispatch trigger).`;
  readonly defaultRefLabel = $localize`:@@featureDeployments-editorDefaultRef:Default branch or tag`;
  readonly repositoryDefaultLabel = $localize`:@@featureDeployments-editorRepositoryDefault:Repository default branch`;
  readonly defaultInputsLabel = $localize`:@@featureDeployments-editorDefaultInputs:Default inputs`;
  readonly defaultInputsHint = $localize`:@@featureDeployments-editorDefaultInputsHint:Inputs, variables or parameters sent with every run (overridable per run).`;
  readonly inputsLabels = deploymentInputsEditorLabels();
  readonly scopeLabel = $localize`:@@featureDeployments-editorScope:Available to`;
  readonly scopeGlobalLabel = $localize`:@@featureDeployments-scopeGlobal:All environments`;
  readonly scopeEnvironmentsLabel = $localize`:@@featureDeployments-scopeEnvironments:Selected environments`;
  readonly environmentsLabel = $localize`:@@featureDeployments-editorEnvironments:Environments`;
  readonly searchEnvironmentsLabel = $localize`:@@featureDeployments-editorSearchEnvironments:Search environments`;
  readonly removeEnvironmentLabel = $localize`:@@featureDeployments-editorRemoveEnvironment:Remove {label}`;
  readonly noEnvironmentsLabel = $localize`:@@featureDeployments-editorNoEnvironments:No matching environments`;
  readonly agentTriggerLabel = $localize`:@@featureDeployments-editorAgentTrigger:Environments may run this pipeline`;
  readonly agentTriggerHint = $localize`:@@featureDeployments-editorAgentTriggerHint:Lets the agents of the environments trigger and cancel runs through their CI tools. Otherwise they can only read runs and logs.`;
  readonly enabledLabel = $localize`:@@featureDeployments-editorEnabled:Enabled`;
  readonly noRepositoriesLabel = $localize`:@@featureDeployments-editorNoRepositories:No matching repositories`;
  /** Editing a workflow an environment proposed / changed: saving the complete form approves it. */
  readonly pendingApprovalSaveHint = $localize`:@@featureDeployments-editorPendingApprovalHint:An environment proposed or changed this pipeline. Saving approves it as shown here, so check the connection, repository, GitHub workflow, default branch, inputs and environment runs first.`;
  readonly noConnectionsLabel = $localize`:@@featureDeployments-editorNoConnections:No connection is available to this workspace yet. Ask an instance admin to add one under Connections.`;
  readonly createLabel = $localize`:@@featureDeployments-editorCreate:Create`;
  readonly saveLabel = $localize`:@@featureDeployments-editorSave:Save`;
  readonly limits = DEPLOYMENT_LIMITS;
  readonly providerLabel = deploymentProviderLabel;

  private readonly facade = inject(WorkspaceDeploymentsFacade);
  private readonly service = inject(WorkspaceDeploymentsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly connections = toSignal(this.facade.connectionOptions$, {
    initialValue: [] as DeploymentConnectionOption[],
  });
  readonly connectionsLoading = toSignal(this.facade.connectionOptionsLoading$, { initialValue: false });

  readonly name = signal('');
  readonly description = signal('');
  readonly connectionId = signal('');
  readonly repository = signal('');
  readonly providerWorkflow = signal('');
  readonly defaultRef = signal('');
  readonly defaultInputs = signal<FpcMapValue>({});
  readonly scope = signal<DeploymentWorkflowScope>('global');
  readonly agentIds = signal<readonly string[]>([]);
  readonly agentTriggerEnabled = signal(false);
  readonly enabled = signal(true);

  readonly repositories = signal<DeploymentRepositorySummary[]>([]);
  readonly repositoriesLoading = signal(false);
  readonly repositoryMenuOpen = signal(false);
  /** Full name of the picked repository when its id differs (GitLab project ids, Jenkins job paths). */
  readonly repositoryFullName = signal<string | null>(null);
  readonly branches = signal<DeploymentBranchSummary[]>([]);
  readonly providerWorkflows = signal<DeploymentProviderWorkflowSummary[]>([]);
  readonly detailsLoading = signal(false);

  readonly mode = computed(() => (this.workflow() ? 'edit' : 'create'));
  readonly selectedConnection = computed(
    () => this.connections().find((connection) => connection.id === this.connectionId()) ?? null,
  );
  /** GitHub Actions dispatches one workflow file of the repository; GitLab and Jenkins run the pipeline / job. */
  readonly needsProviderWorkflow = computed(
    () => (this.selectedConnection()?.provider ?? this.workflow()?.provider) === 'github',
  );
  /** Options incl. the stored value while it is not (yet) in the provider list. */
  readonly branchOptions = computed(() => {
    const branches = this.branches().map((branch) => branch.name);
    const current = this.defaultRef().trim();

    return current && !branches.includes(current) ? [current, ...branches] : branches;
  });
  readonly providerWorkflowOptions = computed(() => {
    const workflows = this.providerWorkflows().map((workflow) => ({
      value: workflow.id,
      label: workflow.path ? `${workflow.name} (${workflow.path})` : workflow.name,
    }));
    const current = this.providerWorkflow().trim();

    return current && !workflows.some((workflow) => workflow.value === current)
      ? [{ value: current, label: current }, ...workflows]
      : workflows;
  });
  readonly agentOptions = computed<FpcMultiSelectOption[]>(() =>
    this.agents().map((agent) => ({ value: agent.id, label: resolveNamedDisplayLabel(agent.name) })),
  );
  readonly valid = computed(() => {
    const name = this.name().trim();
    const repository = this.repository().trim();

    return (
      !!name &&
      name.length <= DEPLOYMENT_LIMITS.nameMaxLength &&
      this.description().length <= DEPLOYMENT_LIMITS.descriptionMaxLength &&
      !!this.connectionId() &&
      !!repository &&
      repository.length <= DEPLOYMENT_LIMITS.repositoryMaxLength &&
      (!this.needsProviderWorkflow() || !!this.providerWorkflow().trim()) &&
      Object.keys(this.defaultInputs()).length <= DEPLOYMENT_LIMITS.inputsMax &&
      (this.scope() === 'global' ||
        (this.agentIds().length > 0 && this.agentIds().length <= DEPLOYMENT_LIMITS.assignedEnvironmentsMax))
    );
  });

  constructor() {
    effect(() => {
      const open = this.open();
      const workflow = this.workflow();
      const clientId = this.clientId();

      if (!open || !clientId) {
        return;
      }

      untracked(() => {
        this.reset(workflow);
        this.facade.loadConnectionOptions(clientId);

        if (workflow) {
          this.loadRepositoryDetails(clientId, workflow.connectionId, workflow.repository);
        }
      });
    });

    // Repository typeahead: provider search while typing.
    toObservable(this.repository)
      .pipe(
        debounceTime(REPOSITORY_SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        filter(() => this.repositoryMenuOpen() && !!this.connectionId() && !!this.clientId()),
        tap(() => this.repositoriesLoading.set(true)),
        switchMap((search) =>
          this.service
            .listRepositories(this.clientId() as string, this.connectionId(), search.trim() || undefined)
            .pipe(catchError(() => of([] as DeploymentRepositorySummary[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((repositories) => {
        this.repositories.set(repositories);
        this.repositoriesLoading.set(false);
      });
  }

  onConnectionChange(connectionId: string): void {
    this.connectionId.set(connectionId);
    this.repository.set('');
    this.repositoryFullName.set(null);
    this.repositories.set([]);
    this.branches.set([]);
    this.providerWorkflows.set([]);
    this.providerWorkflow.set('');
  }

  onRepositoryMenuOpenChange(open: boolean): void {
    this.repositoryMenuOpen.set(open);

    const clientId = this.clientId();

    // First open: list the connection's repositories without a search.
    if (open && clientId && this.connectionId() && this.repositories().length === 0 && !this.repositoriesLoading()) {
      this.repositoriesLoading.set(true);
      this.service
        .listRepositories(clientId, this.connectionId(), this.repository().trim() || undefined)
        .pipe(
          catchError(() => of([] as DeploymentRepositorySummary[])),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((repositories) => {
          this.repositories.set(repositories);
          this.repositoriesLoading.set(false);
        });
    }
  }

  onRepositoryInput(value: string): void {
    this.repository.set(value);
    this.repositoryFullName.set(null);
  }

  /** Typed repository confirmed (blur): load its branches / workflows. */
  onRepositoryCommit(): void {
    const clientId = this.clientId();
    const repository = this.repository().trim();

    if (clientId && this.connectionId() && repository) {
      this.loadRepositoryDetails(clientId, this.connectionId(), repository);
    }
  }

  onPickRepository(repository: DeploymentRepositorySummary, event: Event): void {
    event.preventDefault();
    this.repository.set(repository.id);
    this.repositoryFullName.set(repository.fullName !== repository.id ? repository.fullName : null);
    this.repositoryMenuOpen.set(false);

    if (!this.defaultRef().trim() && repository.defaultBranch) {
      this.defaultRef.set(repository.defaultBranch);
    }

    const clientId = this.clientId();

    if (clientId) {
      this.loadRepositoryDetails(clientId, this.connectionId(), repository.id);
    }
  }

  onSubmit(): void {
    if (!this.valid()) {
      return;
    }

    const description = this.description().trim();
    const defaultRef = this.defaultRef().trim();

    this.saved.emit({
      connectionId: this.connectionId(),
      name: this.name().trim(),
      description: description || null,
      repository: this.repository().trim(),
      workflow: this.needsProviderWorkflow() ? this.providerWorkflow().trim() : null,
      defaultRef: defaultRef || null,
      defaultInputs: deploymentInputsFromMap(this.defaultInputs()),
      scope: this.scope(),
      agentIds: this.scope() === 'environments' ? [...this.agentIds()] : [],
      agentTriggerEnabled: this.agentTriggerEnabled(),
      enabled: this.enabled(),
    });
  }

  private reset(workflow: DeploymentWorkflowSummary | null): void {
    this.name.set(workflow?.name ?? '');
    this.description.set(workflow?.description ?? '');
    this.connectionId.set(workflow?.connectionId ?? '');
    this.repository.set(workflow?.repository ?? '');
    this.repositoryFullName.set(null);
    this.providerWorkflow.set(workflow?.workflow ?? '');
    this.defaultRef.set(workflow?.defaultRef ?? '');
    this.defaultInputs.set({ ...(workflow?.defaultInputs ?? {}) });
    this.scope.set(workflow?.scope ?? 'global');
    this.agentIds.set(workflow?.agentIds ?? []);
    this.agentTriggerEnabled.set(workflow?.agentTriggerEnabled ?? false);
    this.enabled.set(workflow?.enabled ?? true);
    this.repositories.set([]);
    this.branches.set([]);
    this.providerWorkflows.set([]);
    this.repositoryMenuOpen.set(false);
  }

  private loadRepositoryDetails(clientId: string, connectionId: string, repository: string): void {
    this.detailsLoading.set(true);
    this.service
      .listBranches(clientId, connectionId, repository)
      .pipe(
        catchError(() => of([] as DeploymentBranchSummary[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((branches) => {
        this.branches.set(branches);
        this.detailsLoading.set(false);
      });

    if (this.needsProviderWorkflow()) {
      this.service
        .listProviderWorkflows(clientId, connectionId, repository)
        .pipe(
          catchError(() => of([] as DeploymentProviderWorkflowSummary[])),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((workflows) => this.providerWorkflows.set(workflows));
    }
  }
}
