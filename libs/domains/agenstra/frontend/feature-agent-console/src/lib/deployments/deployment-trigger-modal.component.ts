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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  WorkspaceDeploymentsService,
  type AgentResponseDto,
  type TriggerDeploymentWorkflowDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  DEPLOYMENT_LIMITS,
  type DeploymentBranchSummary,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcMapEditorComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTypeaheadSelectComponent,
  type FpcMapEditorLabels,
  type FpcMapValue,
} from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';

/** Map editor texts shared by the trigger modal and the workflow editor (default inputs). */
export function deploymentInputsEditorLabels(): Partial<FpcMapEditorLabels> {
  return {
    key: $localize`:@@featureDeployments-inputKey:Input`,
    value: $localize`:@@featureDeployments-inputValue:Value`,
    add: $localize`:@@featureDeployments-inputAdd:Add input`,
    remove: $localize`:@@featureDeployments-inputRemove:Remove {key}`,
    empty: $localize`:@@featureDeployments-inputsEmpty:No inputs.`,
    duplicate: $localize`:@@featureDeployments-inputDuplicate:This input is used twice.`,
    requiredKey: $localize`:@@featureDeployments-inputRequiredKey:Enter an input name.`,
  };
}

/** Map editor value → string record (inputs are always strings on the wire). */
export function deploymentInputsFromMap(value: FpcMapValue): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

/**
 * Trigger modal of a deployment workflow: ref (branch suggestions from the provider for workspace admins, free text
 * with the workflow default otherwise), inputs prefilled from the workflow defaults and the optional environment the
 * run is for (global workflows: every environment; assigned workflows: the assigned ones). The page dispatches the
 * trigger and closes the modal once the run was created.
 */
@Component({
  selector: 'framework-deployment-trigger-modal',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcMapEditorComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTypeaheadSelectComponent,
  ],
  template: `
    <fpc-modal [(open)]="open" size="lg" [scrollable]="true" [title]="title()">
      @if (error()) {
        <fpc-alert variant="danger" class="mb-3" [message]="error()" />
      }
      @if (workflow(); as wf) {
        <fpc-form-field forId="deploymentTriggerRef" [label]="refLabel" [hint]="refHint()">
          @if (canManage()) {
            <fpc-typeahead-select
              inputId="deploymentTriggerRef"
              listboxId="deploymentTriggerRef-listbox"
              [placeholder]="refPlaceholder()"
              [query]="ref()"
              (queryChange)="ref.set($event)"
              [open]="branchMenuOpen()"
              (openChange)="branchMenuOpen.set($event)"
              [loading]="branchesLoading()"
              (cleared)="ref.set('')"
            >
              <div fpcTypeaheadSuggestions>
                @for (branch of branchSuggestions(); track branch.name) {
                  <button
                    type="button"
                    class="dropdown-item py-2 text-start"
                    (mousedown)="onPickBranch(branch, $event)"
                    data-testid="deployment-trigger-branch"
                  >
                    <span class="d-flex align-items-center gap-2">
                      <i class="bi bi-git" aria-hidden="true"></i>
                      <span class="text-truncate small">{{ branch.name }}</span>
                      @if (branch.default) {
                        <span class="badge text-bg-secondary ms-auto">{{ defaultBranchLabel }}</span>
                      }
                    </span>
                  </button>
                } @empty {
                  <span class="dropdown-item-text small text-body-secondary">{{ noBranchesLabel }}</span>
                }
              </div>
            </fpc-typeahead-select>
          } @else {
            <fpc-form-control
              controlId="deploymentTriggerRef"
              controlClass="font-monospace"
              [maxLength]="refMaxLength"
              [placeholder]="refPlaceholder()"
              [ngModel]="ref()"
              (ngModelChange)="ref.set($event)"
              data-testid="deployment-trigger-ref"
            />
          }
        </fpc-form-field>

        <fpc-form-field forId="deploymentTriggerAgent" [label]="environmentLabel" [hint]="environmentHint">
          <fpc-form-control
            controlId="deploymentTriggerAgent"
            controlType="select"
            [ngModel]="agentId()"
            (ngModelChange)="agentId.set($event)"
            data-testid="deployment-trigger-agent"
          >
            <option value="">{{ noEnvironmentLabel }}</option>
            @for (agent of environmentOptions(); track agent.id) {
              <option [value]="agent.id">{{ displayName(agent.name) }}</option>
            }
          </fpc-form-control>
        </fpc-form-field>

        <fpc-map-editor
          class="d-block"
          [label]="inputsLabel"
          [hint]="inputsHint"
          [labels]="inputsLabels"
          [value]="inputs()"
          (valueChange)="inputs.set($event)"
          data-testid="deployment-trigger-inputs"
        />
      }
      <div *fpcModalFooter>
        <fpc-button
          variant="primary"
          [loading]="busy()"
          [disabled]="busy() || !valid()"
          (clicked)="onSubmit()"
          data-testid="deployment-trigger-submit"
        >
          <i class="bi bi-play-fill me-1" aria-hidden="true"></i>{{ submitLabel }}
        </fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class DeploymentTriggerModalComponent {
  readonly open = model(false);
  readonly clientId = input<string | null>(null);
  readonly workflow = input<DeploymentWorkflowSummary | null>(null);
  /** Environments of the workspace. */
  readonly agents = input<readonly AgentResponseDto[]>([]);
  /** Workspace admins get branch suggestions (connection browsing needs workspace management). */
  readonly canManage = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly triggered = output<TriggerDeploymentWorkflowDto>();

  readonly refLabel = $localize`:@@featureDeployments-refLabel:Branch or tag`;
  readonly environmentLabel = $localize`:@@featureDeployments-triggerEnvironmentLabel:Environment`;
  readonly environmentHint = $localize`:@@featureDeployments-triggerEnvironmentHint:Optional: the environment this run is for (recorded with the run).`;
  readonly noEnvironmentLabel = $localize`:@@featureDeployments-triggerNoEnvironment:Workspace (no environment)`;
  readonly inputsLabel = $localize`:@@featureDeployments-inputsLabel:Inputs`;
  readonly inputsHint = $localize`:@@featureDeployments-triggerInputsHint:Prefilled with the pipeline defaults; changes apply to this run only.`;
  readonly inputsLabels = deploymentInputsEditorLabels();
  readonly submitLabel = $localize`:@@featureDeployments-triggerSubmit:Run pipeline`;
  readonly defaultBranchLabel = $localize`:@@featureDeployments-defaultBranch:default`;
  readonly noBranchesLabel = $localize`:@@featureDeployments-noBranches:No matching branches`;
  readonly refMaxLength = DEPLOYMENT_LIMITS.refMaxLength;

  private readonly service = inject(WorkspaceDeploymentsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly ref = signal('');
  readonly agentId = signal('');
  readonly inputs = signal<FpcMapValue>({});
  readonly branches = signal<DeploymentBranchSummary[]>([]);
  readonly branchesLoading = signal(false);
  readonly branchMenuOpen = signal(false);

  readonly title = computed(() => {
    const name = this.workflow()?.name ?? '';

    return $localize`:@@featureDeployments-triggerTitle:Run ${name}:name:`;
  });
  readonly refPlaceholder = computed(
    () => this.workflow()?.defaultRef || $localize`:@@featureDeployments-refPlaceholder:Repository default branch`,
  );
  readonly refHint = computed(() =>
    this.workflow()?.defaultRef
      ? $localize`:@@featureDeployments-refHintDefault:Leave empty to use the pipeline default.`
      : $localize`:@@featureDeployments-refHintRepository:Leave empty to use the default branch of the repository.`,
  );
  /** Global workflows: every environment; assigned workflows: only the assigned ones. */
  readonly environmentOptions = computed(() => {
    const workflow = this.workflow();
    const agents = this.agents();

    if (!workflow || workflow.scope === 'global') {
      return agents;
    }

    return agents.filter((agent) => workflow.agentIds.includes(agent.id));
  });
  readonly branchSuggestions = computed(() => {
    const needle = this.ref().trim().toLowerCase();
    const branches = this.branches();

    return (needle ? branches.filter((branch) => branch.name.toLowerCase().includes(needle)) : branches).slice(0, 50);
  });
  readonly valid = computed(
    () =>
      !!this.workflow()?.enabled &&
      this.ref().trim().length <= DEPLOYMENT_LIMITS.refMaxLength &&
      Object.keys(this.inputs()).length <= DEPLOYMENT_LIMITS.inputsMax,
  );

  constructor() {
    // Reset the form whenever the modal opens for a workflow.
    effect(() => {
      const open = this.open();
      const workflow = this.workflow();

      if (!open || !workflow) {
        return;
      }

      untracked(() => {
        this.ref.set('');
        this.agentId.set('');
        this.inputs.set({ ...workflow.defaultInputs });
        this.branches.set([]);
        this.branchMenuOpen.set(false);

        if (this.canManage()) {
          this.loadBranches(workflow);
        }
      });
    });
  }

  displayName(name: string | null | undefined): string {
    return resolveNamedDisplayLabel(name);
  }

  onPickBranch(branch: DeploymentBranchSummary, event: Event): void {
    event.preventDefault();
    this.ref.set(branch.name);
    this.branchMenuOpen.set(false);
  }

  onSubmit(): void {
    if (!this.valid()) {
      return;
    }

    const ref = this.ref().trim();
    const agentId = this.agentId();

    this.triggered.emit({
      ...(ref ? { ref } : {}),
      inputs: deploymentInputsFromMap(this.inputs()),
      ...(agentId ? { agentId } : {}),
    });
  }

  private loadBranches(workflow: DeploymentWorkflowSummary): void {
    const clientId = this.clientId();

    if (!clientId) {
      return;
    }

    this.branchesLoading.set(true);
    this.service
      .listBranches(clientId, workflow.connectionId, workflow.repository)
      .pipe(
        catchError(() => of([] as DeploymentBranchSummary[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((branches) => {
        this.branches.set(branches);
        this.branchesLoading.set(false);
      });
  }
}
