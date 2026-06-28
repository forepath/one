import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  CloudInitConfigsFacade,
  CloudInitConfigsService,
  type CloudInitConfigResponse,
  type CloudInitProvisioningMode,
  type CreateCloudInitConfigDto,
  type UpdateCloudInitConfigDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatest, map, take } from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass, getUnavailableLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { MonacoEditorWrapperComponent } from '../monaco-editor-wrapper/monaco-editor-wrapper.component';

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
  { value: 'simple', label: 'Simple (single Docker image)' },
  { value: 'compose-template', label: 'Docker Compose template' },
  { value: 'user-data-template', label: 'Full cloud-init user-data' },
];

const MIN_RANDOM_DEFAULT_LENGTH = 21;

@Component({
  selector: 'framework-billing-cloud-init-configs-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MonacoEditorWrapperComponent],
  templateUrl: './cloud-init-configs-page.component.html',
  styleUrls: ['./cloud-init-configs-page.component.scss'],
})
export class CloudInitConfigsPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteConfirmModal', { static: false }) private deleteConfirmModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(CloudInitConfigsFacade);
  private readonly cloudInitConfigsService = inject(CloudInitConfigsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly cloudInitConfigs$ = combineLatest([this.facade.getCloudInitConfigs$(), this.searchQuery$]).pipe(
    map(([configs, searchQuery]) => {
      const term = searchQuery.trim().toLowerCase();

      if (!term) {
        return configs;
      }

      return configs.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
    }),
  );
  readonly loading$ = this.facade.getCloudInitConfigsLoading$();
  readonly loadingAny$ = this.facade.getCloudInitConfigsLoadingAny$();
  readonly error$ = this.facade.getCloudInitConfigsError$();
  readonly creating$ = this.facade.getCloudInitConfigsCreating$();
  readonly updating$ = this.facade.getCloudInitConfigsUpdating$();
  readonly deleting$ = this.facade.getCloudInitConfigsDeleting$();

  readonly provisioningModeOptions = PROVISIONING_MODE_OPTIONS;
  readonly templatePlaceholderHelp =
    'Placeholders: {{HOSTNAME}}, {{FQDN}}, {{WORK_DIR}}, {{SSH_PUBLIC_KEY}}, {{DOCKER_IMAGE}}, {{CONTAINER_PORT}}, {{HOST_PORT}}, {{env.VAR_KEY}}';

  createForm: CloudInitConfigForm = this.getDefaultCreateForm();
  editForm: UpdateCloudInitConfigDto & { id: string; environmentVariableRows: EnvVariableFormRow[] } =
    this.getDefaultEditForm();
  configToDelete: CloudInitConfigResponse | null = null;

  ngOnInit(): void {
    this.facade.loadCloudInitConfigs();
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.showModalWithMonacoLayout(this.createModal);
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
        showBillingModal(this.editModal);
        this.scheduleMonacoLayout(this.editModal);
      });
  }

  openDeleteConfirm(config: CloudInitConfigResponse): void {
    this.configToDelete = config;
    showBillingModal(this.deleteConfirmModal);
  }

  envVarCount(config: CloudInitConfigResponse): number {
    return config.environmentVariables?.length ?? 0;
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
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
    if (config.provisioningMode === 'user-data-template') {
      return 'Custom user-data';
    }

    if (config.provisioningMode === 'compose-template') {
      return 'Compose template';
    }

    return config.dockerImage?.trim() || 'No image';
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

  private showModalWithMonacoLayout(modal: ElementRef<HTMLDivElement>): void {
    this.scheduleMonacoLayout(modal);
    showBillingModal(modal);
  }

  private scheduleMonacoLayout(modal: ElementRef<HTMLDivElement>): void {
    modal.nativeElement.addEventListener(
      'shown.bs.modal',
      () => {
        window.dispatchEvent(new Event('resize'));
      },
      { once: true },
    );
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetCreateForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetEditForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      modal: () => this.deleteConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.configToDelete = null;
      },
    });
  }
}
