import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, type WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  CloudInitConfigsFacade,
  CloudInitConfigsService,
  type CloudInitConfigResponse,
  type CloudInitProvisioningMode,
  type CreateCloudInitConfigDto,
  type UpdateCloudInitConfigDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcListHeaderComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, firstValueFrom, skip, take } from 'rxjs';

import { getUnavailableLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { MonacoEditorWrapperComponent } from '../monaco-editor-wrapper/monaco-editor-wrapper.component';
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { activeState } from '../shared/table-states';

interface EnvVariableFormRow {
  key: string;
  label: string;
  description: string;
  showInOrderForm: boolean;
  defaultValue: string;
  useRandomDefault: boolean;
  randomDefaultLength: number;
  randomDefaultSpecialChars: boolean;
}

type CloudInitConfigForm = CreateCloudInitConfigDto & {
  environmentVariableRows: EnvVariableFormRow[];
};

const DEFAULT_COMPOSE_TEMPLATE = `services:
  app:
    image: {{DOCKER_IMAGE}}
    container_name: custom-app
    restart: unless-stopped
    ports:
      - "{{HOST_PORT}}:{{CONTAINER_PORT}}"
    environment: {}
`;

const DEFAULT_USER_DATA_TEMPLATE = `#!/bin/bash
set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/custom-app-provisioning.log
}

log "Provisioning {{HOSTNAME}} ({{FQDN}})"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y openssh-server ca-certificates curl

mkdir -p /root/.ssh
echo "{{SSH_PUBLIC_KEY}}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

mkdir -p {{WORK_DIR}}
cat > {{WORK_DIR}}/docker-compose.yaml <<'EOF'
services:
  app:
    image: {{DOCKER_IMAGE}}
    container_name: custom-app
    restart: unless-stopped
    ports:
      - "{{HOST_PORT}}:{{CONTAINER_PORT}}"
    environment: {}
EOF

cd {{WORK_DIR}}
docker compose up -d

log "Provisioning completed"
`;

const PROVISIONING_MODE_OPTIONS: Array<{ value: CloudInitProvisioningMode; label: string }> = [
  { value: 'simple', label: $localize`:@@featureCloudInitConfigs-modeSimple:Simple (single Docker image)` },
  { value: 'compose-template', label: $localize`:@@featureCloudInitConfigs-modeCompose:Docker Compose template` },
  {
    value: 'user-data-template',
    label: $localize`:@@featureCloudInitConfigs-modeUserData:Full cloud-init user-data`,
  },
];

const MIN_RANDOM_DEFAULT_LENGTH = 21;

@Component({
  selector: 'framework-billing-cloud-init-configs-page',
  standalone: true,
  imports: [
    FpcListHeaderComponent,
    CommonModule,
    FormsModule,
    MonacoEditorWrapperComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
  ],
  templateUrl: './cloud-init-configs-page.component.html',
  styleUrls: ['./cloud-init-configs-page.component.scss'],
})
export class CloudInitConfigsPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteConfirmModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureCloudInitConfigs-title:Cloud-init configs`;
  readonly addConfigAriaLabel = $localize`:@@featureCloudInitConfigs-add:Add config`;
  readonly searchPlaceholder = $localize`:@@featureCloudInitConfigs-searchPlaceholder:Search configs`;

  private readonly facade = inject(CloudInitConfigsFacade);
  private readonly cloudInitConfigsService = inject(CloudInitConfigsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly cloudInitConfigs = toSignal(this.facade.getCloudInitConfigs$(), {
    initialValue: [] as CloudInitConfigResponse[],
  });
  readonly loading$ = this.facade.getCloudInitConfigsLoading$();
  readonly loadingAny$ = this.facade.getCloudInitConfigsLoadingAny$();
  readonly error$ = this.facade.getCloudInitConfigsError$();
  readonly creating$ = this.facade.getCloudInitConfigsCreating$();
  readonly updating$ = this.facade.getCloudInitConfigsUpdating$();
  readonly deleting$ = this.facade.getCloudInitConfigsDeleting$();

  readonly provisioningModeOptions = PROVISIONING_MODE_OPTIONS;
  readonly templatePlaceholderHelp =
    'Placeholders: {{HOSTNAME}}, {{FQDN}}, {{WORK_DIR}}, {{SSH_PUBLIC_KEY}}, {{DOCKER_IMAGE}}, {{CONTAINER_PORT}}, {{HOST_PORT}}, {{env.VAR_KEY}}';

  readonly columns: FpcTableColumn<CloudInitConfigResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureCloudInitConfigs-colStatus:Status`,
      type: 'state',
      state: (config) => activeState(config.isActive),
    },
    {
      id: 'name',
      label: $localize`:@@featureCloudInitConfigs-colName:Config`,
      value: (config) => config.name,
      required: true,
      priority: 1,
    },
    {
      id: 'key',
      label: $localize`:@@featureAddons-colKey:Key`,
      value: (config) => this.configKeyLabel(config.key),
      mono: true,
      priority: 3,
    },
    {
      id: 'mode',
      label: $localize`:@@featureCloudInitConfigs-colMode:Mode`,
      value: (config) => this.provisioningModeLabel(config.provisioningMode ?? 'simple'),
      priority: 1,
    },
    {
      id: 'image',
      label: $localize`:@@featureCloudInitConfigs-colImage:Image`,
      value: (config) => this.configSummaryLabel(config),
      priority: 2,
    },
    {
      id: 'env',
      label: $localize`:@@featureCloudInitConfigs-colEnvVars:Env vars`,
      value: (config) => this.envVarCount(config),
      align: 'end',
      priority: 3,
    },
  ];

  readonly editLabel = $localize`:@@featureCloudInitConfigs-edit:Edit config`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly activateLabel = $localize`:@@featureMeters-bulkActivate:Activate`;
  readonly deactivateLabel = $localize`:@@featureMeters-bulkDeactivate:Deactivate`;
  readonly bulkDeleteTitle = $localize`:@@featureCloudInitConfigs-bulkDeleteTitle:Delete configs?`;

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedConfigs = computed(() => {
    const ids = new Set(this.selected());

    return this.cloudInitConfigs().filter((config) => ids.has(config.id));
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureCloudInitConfigs-bulkDeleteMessage:${this.selectedConfigs().length}:count: selected configs will be deleted. Configs still used by service plans are reported and left as they are.`,
  );
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];

  createForm: CloudInitConfigForm = this.getDefaultCreateForm();
  editForm: UpdateCloudInitConfigDto & { id: string; environmentVariableRows: EnvVariableFormRow[] } =
    this.getDefaultEditForm();
  configToDelete: CloudInitConfigResponse | null = null;

  ngOnInit(): void {
    this.facade.loadCloudInitConfigs();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadCloudInitConfigs({ search: search.trim() || undefined });
      });
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.openModalWithMonacoLayout(this.createModalOpen);
  }

  openEditModal(config: CloudInitConfigResponse): void {
    this.cloudInitConfigsService
      .getCloudInitConfig(config.id)
      .pipe(take(1))
      .subscribe((detail) => {
        this.editForm = {
          id: detail.id,
          name: detail.name,
          description: detail.description ?? '',
          provisioningMode: detail.provisioningMode ?? 'simple',
          dockerImage: detail.dockerImage ?? '',
          containerPort: detail.containerPort,
          hostPort: detail.hostPort,
          workDir: detail.workDir,
          dockerComposeTemplate: detail.dockerComposeTemplate ?? '',
          userDataTemplate: detail.userDataTemplate ?? '',
          isActive: detail.isActive,
          environmentVariableRows: (detail.environmentVariables ?? []).map((row) => ({
            key: row.key,
            label: row.label,
            description: row.description ?? '',
            showInOrderForm: row.showInOrderForm,
            defaultValue: row.useRandomDefault ? '' : (detail.defaultValues?.[row.key] ?? ''),
            useRandomDefault: row.useRandomDefault === true,
            randomDefaultLength: row.randomDefaultLength ?? MIN_RANDOM_DEFAULT_LENGTH,
            randomDefaultSpecialChars: row.randomDefaultSpecialChars === true,
          })),
        };
        showBillingModal(this.editModalOpen);
        this.scheduleMonacoLayout();
      });
  }

  openDeleteConfirm(config: CloudInitConfigResponse): void {
    this.configToDelete = config;
    showBillingModal(this.deleteConfirmModalOpen);
  }

  envVarCount(config: CloudInitConfigResponse): number {
    return config.environmentVariables?.length ?? 0;
  }

  onRowAction(config: CloudInitConfigResponse, action: string): void {
    if (action === 'edit') this.openEditModal(config);
    else if (action === 'delete') this.openDeleteConfirm(config);
    else if (action === 'copy-id') fpcCopyText(config.id);
  }

  /** Bulk Activate / Deactivate: one `updateCloudInitConfig` per config whose state changes (same call as Edit). */
  async setActiveSelected(isActive: boolean): Promise<void> {
    const configs = this.selectedConfigs().filter((config) => config.isActive !== isActive);

    if (configs.length === 0) return;

    const result = await fpcRunBulk(configs, (config) =>
      firstValueFrom(this.cloudInitConfigsService.updateCloudInitConfig(config.id, { isActive })),
    );

    this.finishBulk(dbBulkSummary(result, (config) => config.name));
  }

  /** Bulk Delete: one `deleteCloudInitConfig` per config. */
  async deleteSelected(): Promise<void> {
    const configs = this.selectedConfigs();

    if (configs.length === 0) return;

    const result = await fpcRunBulk(configs, (config) =>
      firstValueFrom(this.cloudInitConfigsService.deleteCloudInitConfig(config.id)),
    );

    this.finishBulk(dbBulkSummary(result, (config) => config.name));
  }

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.facade.loadCloudInitConfigs({ search: this.searchQuery().trim() || undefined });
  }

  configKeyLabel(key: string | null | undefined): string {
    return key?.trim() || getUnavailableLabel();
  }

  provisioningModeLabel(mode: CloudInitProvisioningMode | null | undefined): string {
    return this.provisioningModeOptions.find((option) => option.value === mode)?.label ?? mode ?? 'Simple';
  }

  isSimpleMode(form: { provisioningMode?: CloudInitProvisioningMode }): boolean {
    return (form.provisioningMode ?? 'simple') === 'simple';
  }

  isComposeTemplateMode(form: { provisioningMode?: CloudInitProvisioningMode }): boolean {
    return form.provisioningMode === 'compose-template';
  }

  isUserDataTemplateMode(form: { provisioningMode?: CloudInitProvisioningMode }): boolean {
    return form.provisioningMode === 'user-data-template';
  }

  resetComposeTemplate(form: 'create' | 'edit'): void {
    if (form === 'create') {
      this.createForm.dockerComposeTemplate = DEFAULT_COMPOSE_TEMPLATE;
    } else {
      this.editForm.dockerComposeTemplate = DEFAULT_COMPOSE_TEMPLATE;
    }
  }

  resetUserDataTemplate(form: 'create' | 'edit'): void {
    if (form === 'create') {
      this.createForm.userDataTemplate = DEFAULT_USER_DATA_TEMPLATE;
    } else {
      this.editForm.userDataTemplate = DEFAULT_USER_DATA_TEMPLATE;
    }
  }

  onProvisioningModeChange(form: 'create' | 'edit'): void {
    const target = form === 'create' ? this.createForm : this.editForm;

    if (target.provisioningMode === 'compose-template' && !target.dockerComposeTemplate?.trim()) {
      target.dockerComposeTemplate = DEFAULT_COMPOSE_TEMPLATE;
    }

    if (target.provisioningMode === 'user-data-template' && !target.userDataTemplate?.trim()) {
      target.userDataTemplate = DEFAULT_USER_DATA_TEMPLATE;
    }

    setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  }

  configSummaryLabel(config: CloudInitConfigResponse): string {
    if (config.provisioningMode === 'user-data-template' || config.provisioningMode === 'compose-template') {
      return '';
    }

    return config.dockerImage?.trim() || $localize`:@@featureCloudInitConfigs-noImage:No image`;
  }

  addEnvVariable(form: 'create' | 'edit'): void {
    const row: EnvVariableFormRow = {
      key: '',
      label: '',
      description: '',
      showInOrderForm: false,
      defaultValue: '',
      useRandomDefault: false,
      randomDefaultLength: MIN_RANDOM_DEFAULT_LENGTH,
      randomDefaultSpecialChars: false,
    };

    if (form === 'create') {
      this.createForm.environmentVariableRows = [...this.createForm.environmentVariableRows, row];
    } else {
      this.editForm.environmentVariableRows = [...this.editForm.environmentVariableRows, row];
    }
  }

  removeEnvVariable(form: 'create' | 'edit', index: number): void {
    if (form === 'create') {
      const list = [...this.createForm.environmentVariableRows];

      list.splice(index, 1);
      this.createForm.environmentVariableRows = list;
    } else {
      const list = [...this.editForm.environmentVariableRows];

      list.splice(index, 1);
      this.editForm.environmentVariableRows = list;
    }
  }

  moveEnvVariable(form: 'create' | 'edit', index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;

    if (form === 'create') {
      const list = [...this.createForm.environmentVariableRows];

      if (targetIndex < 0 || targetIndex >= list.length) return;

      [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
      this.createForm.environmentVariableRows = list;
    } else {
      const list = [...this.editForm.environmentVariableRows];

      if (targetIndex < 0 || targetIndex >= list.length) return;

      [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
      this.editForm.environmentVariableRows = list;
    }
  }

  onSubmitCreate(): void {
    if (!this.createForm.key?.trim() || !this.createForm.name?.trim() || !this.isCreateFormValid()) {
      return;
    }

    const { environmentVariables, defaultValues } = this.buildEnvPayload(this.createForm.environmentVariableRows);

    this.facade.createCloudInitConfig({
      key: this.createForm.key.trim(),
      name: this.createForm.name.trim(),
      description: this.createForm.description?.trim() || undefined,
      provisioningMode: this.createForm.provisioningMode ?? 'simple',
      dockerImage: this.createForm.dockerImage?.trim() || undefined,
      containerPort: Number(this.createForm.containerPort) || 8080,
      hostPort: Number(this.createForm.hostPort) || 80,
      workDir: this.createForm.workDir?.trim() || '/opt/custom-app',
      dockerComposeTemplate: this.createForm.dockerComposeTemplate?.trim() || undefined,
      userDataTemplate: this.createForm.userDataTemplate?.trim() || undefined,
      environmentVariables,
      defaultValues,
      isActive: this.createForm.isActive ?? true,
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id || !this.isEditFormValid()) return;

    const { environmentVariables, defaultValues } = this.buildEnvPayload(this.editForm.environmentVariableRows);

    this.facade.updateCloudInitConfig(this.editForm.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      provisioningMode: this.editForm.provisioningMode,
      dockerImage: this.editForm.dockerImage,
      containerPort: this.editForm.containerPort != null ? Number(this.editForm.containerPort) : undefined,
      hostPort: this.editForm.hostPort != null ? Number(this.editForm.hostPort) : undefined,
      workDir: this.editForm.workDir,
      dockerComposeTemplate: this.editForm.dockerComposeTemplate?.trim() || null,
      userDataTemplate: this.editForm.userDataTemplate?.trim() || null,
      environmentVariables,
      defaultValues,
      isActive: this.editForm.isActive,
    });
  }

  confirmDelete(): void {
    if (!this.configToDelete) return;

    this.facade.deleteCloudInitConfig(this.configToDelete.id);
  }

  onEnvRandomDefaultChange(row: EnvVariableFormRow, checked: boolean): void {
    row.useRandomDefault = checked;

    if (checked) {
      row.defaultValue = '';
    }
  }

  readonly minRandomDefaultLength = MIN_RANDOM_DEFAULT_LENGTH;

  private buildEnvPayload(rows: EnvVariableFormRow[]): {
    environmentVariables: NonNullable<CreateCloudInitConfigDto['environmentVariables']>;
    defaultValues: Record<string, string>;
  } {
    const environmentVariables: NonNullable<CreateCloudInitConfigDto['environmentVariables']> = [];
    const defaultValues: Record<string, string> = {};

    for (const row of rows) {
      const key = row.key?.trim() ?? '';
      const label = row.label?.trim() ?? '';

      if (!key || !label) {
        continue;
      }

      environmentVariables.push({
        key,
        label,
        description: row.description?.trim() || undefined,
        showInOrderForm: row.showInOrderForm === true,
        ...(row.useRandomDefault
          ? {
              useRandomDefault: true,
              randomDefaultLength: Math.max(
                MIN_RANDOM_DEFAULT_LENGTH,
                Number(row.randomDefaultLength) || MIN_RANDOM_DEFAULT_LENGTH,
              ),
              randomDefaultSpecialChars: row.randomDefaultSpecialChars === true,
            }
          : {}),
      });

      if (!row.useRandomDefault) {
        const defaultValue = row.defaultValue?.trim();

        if (defaultValue) {
          defaultValues[key] = defaultValue;
        }
      }
    }

    return { environmentVariables, defaultValues };
  }

  private getDefaultCreateForm(): CloudInitConfigForm {
    return {
      key: '',
      name: '',
      description: '',
      provisioningMode: 'simple',
      dockerImage: '',
      containerPort: 8080,
      hostPort: 80,
      workDir: '/opt/custom-app',
      dockerComposeTemplate: '',
      userDataTemplate: '',
      isActive: true,
      environmentVariableRows: [],
    };
  }

  private getDefaultEditForm(): UpdateCloudInitConfigDto & {
    id: string;
    environmentVariableRows: EnvVariableFormRow[];
  } {
    return {
      id: '',
      name: '',
      description: '',
      provisioningMode: 'simple',
      dockerImage: '',
      containerPort: 8080,
      hostPort: 80,
      workDir: '/opt/custom-app',
      dockerComposeTemplate: '',
      userDataTemplate: '',
      isActive: true,
      environmentVariableRows: [],
    };
  }

  private isCreateFormValid(): boolean {
    const mode = this.createForm.provisioningMode ?? 'simple';

    if (mode === 'simple') {
      return Boolean(this.createForm.dockerImage?.trim());
    }

    if (mode === 'compose-template') {
      return Boolean(this.createForm.dockerComposeTemplate?.trim());
    }

    return Boolean(this.createForm.userDataTemplate?.trim());
  }

  private isEditFormValid(): boolean {
    const mode = this.editForm.provisioningMode ?? 'simple';

    if (mode === 'simple') {
      return Boolean(this.editForm.dockerImage?.trim());
    }

    if (mode === 'compose-template') {
      return Boolean(this.editForm.dockerComposeTemplate?.trim());
    }

    return Boolean(this.editForm.userDataTemplate?.trim());
  }

  private resetCreateForm(): void {
    this.createForm = this.getDefaultCreateForm();
  }

  private resetEditForm(): void {
    this.editForm = this.getDefaultEditForm();
  }

  private openModalWithMonacoLayout(open: WritableSignal<boolean>): void {
    showBillingModal(open);
    this.scheduleMonacoLayout();
  }

  private scheduleMonacoLayout(): void {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetCreateForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetEditForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.configToDelete = null;
      },
    });
  }
}
