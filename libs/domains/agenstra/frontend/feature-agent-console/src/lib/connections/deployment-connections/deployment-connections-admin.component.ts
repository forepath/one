import { Component, LOCALE_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ClientsFacade,
  DeploymentConnectionsFacade,
  DeploymentConnectionsService,
  type ClientResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_PROVIDERS,
  isDeploymentProvider,
  type ConnectionAuthType,
  type DeploymentConnectionSummary,
  type DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcMultiSelectComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  FPC_DEFAULT_PAGE_SIZE,
  fpcCopyText,
  fpcFormatDateTime,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcMultiSelectOption,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';

import { resolveNamedDisplayLabel } from '../../display-name.util';
import {
  connectionAuthTypeLabel,
  connectionAuthTypesFor,
  connectionTestState,
  deploymentProviderIcon,
  deploymentProviderLabel,
} from '../../deployments/deployment-labels';
import { AG_DL_DELETE, AG_DL_EDIT, AG_DL_TEST, agBulkSummary, agCopyIdItem } from '../../shared/data-list';

import {
  deploymentConnectionBaseUrlRequired,
  deploymentConnectionCreateDto,
  deploymentConnectionFormError,
  deploymentConnectionFormFrom,
  deploymentConnectionUpdateDto,
  emptyDeploymentConnectionForm,
  type DeploymentConnectionFormValue,
} from './deployment-connection-form';

const SEARCH_DEBOUNCE_MS = 300;
/** Workspaces offered in the access picker (same batch as the Atlassian import configs). */
const WORKSPACE_OPTIONS_LIMIT = 500;

/**
 * Instance-wide CI/CD connections (`/connections/deployments`, instance admins). GitHub Actions (GitHub App or
 * personal access token, GitHub Enterprise via base URL), GitLab CI/CD (access token, self-managed via base URL) and
 * Jenkins (username + API token, base URL required). A connection is usable by all workspaces or by selected ones;
 * workspace admins build deployment workflows on top of it. Secrets are write-only.
 */
@Component({
  selector: 'framework-deployment-connections-admin',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcMultiSelectComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './deployment-connections-admin.component.html',
  styleUrls: ['./deployment-connections-admin.component.scss'],
})
export class DeploymentConnectionsAdminComponent {
  readonly pageTitle = $localize`:@@featureDeploymentConnections-pageTitle:CI/CD connections`;
  readonly tableLabel = $localize`:@@featureDeploymentConnections-table:CI/CD connections`;
  readonly searchPlaceholder = $localize`:@@featureDeploymentConnections-search:Search connections`;
  readonly refreshTitle = $localize`:@@featureDeploymentConnections-refresh:Refresh`;
  readonly createTitle = $localize`:@@featureDeploymentConnections-createTitle:Add connection`;
  readonly editTitle = $localize`:@@featureDeploymentConnections-editTitle:Edit connection`;
  readonly deleteTitle = $localize`:@@featureDeploymentConnections-deleteTitle:Delete connection`;
  readonly bulkDeleteTitle = $localize`:@@featureDeploymentConnections-bulkDeleteTitle:Delete connections`;
  readonly providerFilterLabel = $localize`:@@featureDeploymentConnections-providerFilter:Provider`;
  readonly testLabel = AG_DL_TEST;
  readonly deleteLabel = AG_DL_DELETE;
  readonly providerLabelText = $localize`:@@featureDeploymentConnections-provider:Provider`;
  readonly labelLabel = $localize`:@@featureDeploymentConnections-label:Name`;
  readonly baseUrlLabel = $localize`:@@featureDeploymentConnections-baseUrl:Base URL`;
  readonly authTypeLabel = $localize`:@@featureDeploymentConnections-authType:Authentication`;
  readonly appIdLabel = $localize`:@@featureDeploymentConnections-appId:App ID`;
  readonly installationIdLabel = $localize`:@@featureDeploymentConnections-installationId:Installation ID`;
  readonly privateKeyLabel = $localize`:@@featureDeploymentConnections-privateKey:Private key (PEM)`;
  readonly tokenLabel = $localize`:@@featureDeploymentConnections-token:Token`;
  readonly usernameLabel = $localize`:@@featureDeploymentConnections-username:Username`;
  readonly invalidBaseUrlLabel = $localize`:@@featureDeploymentConnections-invalidBaseUrl:Enter an absolute http(s) URL without credentials, query or fragment.`;
  readonly keepSecretHint = $localize`:@@featureDeploymentConnections-keepSecretHint:Leave empty to keep the stored value.`;
  readonly workspaceAccessLabel = $localize`:@@featureDeploymentConnections-workspaceAccess:Workspace access`;
  readonly accessAllLabel = $localize`:@@featureDeploymentConnections-accessAll:All workspaces`;
  readonly accessSelectedLabel = $localize`:@@featureDeploymentConnections-accessSelected:Selected workspaces`;
  readonly workspacesLabel = $localize`:@@featureDeploymentConnections-workspaces:Workspaces`;
  readonly searchWorkspacesLabel = $localize`:@@featureDeploymentConnections-searchWorkspaces:Search workspaces`;
  readonly removeWorkspaceLabel = $localize`:@@featureDeploymentConnections-removeWorkspace:Remove {label}`;
  readonly noWorkspacesLabel = $localize`:@@featureDeploymentConnections-noWorkspaces:No matching workspaces`;
  readonly saveLabel = $localize`:@@featureDeploymentConnections-save:Save`;
  readonly createLabel = $localize`:@@featureDeploymentConnections-create:Create`;
  readonly limits = DEPLOYMENT_LIMITS;
  readonly providers = DEPLOYMENT_PROVIDERS;
  readonly providerLabel = deploymentProviderLabel;
  readonly providerIcon = deploymentProviderIcon;
  readonly authLabel = connectionAuthTypeLabel;
  readonly testState = connectionTestState;

  /** State (last test) · Connection · Provider · Authentication · Workspaces · Base URL · Last tested. */
  readonly columns: FpcTableColumn<DeploymentConnectionSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@featureDeploymentConnections-colState:State`,
      type: 'state',
      state: (connection) => {
        const state = connectionTestState(connection.lastTestStatus);

        return connection.lastTestMessage
          ? { ...state, label: `${state.label}: ${connection.lastTestMessage}` }
          : state;
      },
    },
    {
      id: 'label',
      label: $localize`:@@featureDeploymentConnections-colConnection:Connection`,
      value: (connection) => connection.label,
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'provider',
      label: $localize`:@@featureDeploymentConnections-colProvider:Provider`,
      value: (connection) => deploymentProviderLabel(connection.provider),
      priority: 1,
      sortable: false,
    },
    {
      id: 'auth',
      label: $localize`:@@featureDeploymentConnections-colAuth:Authentication`,
      value: (connection) => connectionAuthTypeLabel(connection.authType, connection.provider),
      priority: 2,
      sortable: false,
    },
    {
      id: 'access',
      label: $localize`:@@featureDeploymentConnections-colAccess:Workspaces`,
      value: (connection) => this.accessSummary(connection),
      priority: 2,
      sortable: false,
    },
    {
      id: 'baseUrl',
      label: $localize`:@@featureDeploymentConnections-colBaseUrl:Base URL`,
      value: (connection) => connection.baseUrl ?? '',
      priority: 3,
      hidden: true,
      sortable: false,
    },
    {
      id: 'tested',
      label: $localize`:@@featureDeploymentConnections-colTested:Connection status`,
      value: (connection) => connection.lastTestedAt ?? '',
      priority: 2,
      sortable: false,
    },
  ];
  readonly rowMenu = (connection: DeploymentConnectionSummary): FpcMenuItem[] => [
    { id: 'edit', label: AG_DL_EDIT, icon: 'pencil' },
    { id: 'test', label: AG_DL_TEST, icon: 'plug', disabled: this.isTesting(connection.id) },
    agCopyIdItem(),
    { id: 'delete', label: AG_DL_DELETE, icon: 'trash', danger: true },
  ];

  private readonly facade = inject(DeploymentConnectionsFacade);
  private readonly service = inject(DeploymentConnectionsService);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly locale = inject(LOCALE_ID);

  readonly connections = toSignal(this.facade.connections$, { initialValue: [] as DeploymentConnectionSummary[] });
  readonly hasNext = toSignal(this.facade.hasNext$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly saving = toSignal(this.facade.saving$, { initialValue: false });
  readonly testingIds = toSignal(this.facade.testingIds$, { initialValue: [] as string[] });
  readonly lastTest = toSignal(this.facade.lastTest$, { initialValue: null });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });

  readonly search = signal('');
  readonly providerFilter = signal<DeploymentProvider | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly selectedIds = signal<readonly string[]>([]);
  readonly selectedConnections = computed(() => {
    const ids = new Set(this.selectedIds());

    return this.connections().filter((connection) => ids.has(connection.id));
  });
  readonly lastTestConnection = computed(() => {
    const test = this.lastTest();

    return test ? (this.connections().find((connection) => connection.id === test.id) ?? null) : null;
  });

  // --- editor ---------------------------------------------------------------------------------------------------
  readonly editorOpen = signal(false);
  readonly editing = signal<DeploymentConnectionSummary | null>(null);
  readonly form = signal<DeploymentConnectionFormValue>(emptyDeploymentConnectionForm());
  private editorSubmitted = false;
  readonly formError = computed(() => deploymentConnectionFormError(this.form(), this.editing()));
  readonly authTypes = computed(() => connectionAuthTypesFor(this.form().provider));
  readonly baseUrlRequired = computed(() => deploymentConnectionBaseUrlRequired(this.form().provider));
  /** Secrets may stay empty on edit while the auth type is unchanged (the stored ones are kept). */
  readonly secretsOptional = computed(() => {
    const editing = this.editing();

    return !!editing && editing.authType === this.form().authType;
  });
  readonly baseUrlHint = computed(() => {
    switch (this.form().provider) {
      case 'github':
        return $localize`:@@featureDeploymentConnections-baseUrlHintGithub:Leave empty for github.com. GitHub Enterprise Server: https://github.example.com/api/v3`;
      case 'gitlab':
        return $localize`:@@featureDeploymentConnections-baseUrlHintGitlab:Leave empty for gitlab.com. Self-managed: https://gitlab.example.com`;
      default:
        return $localize`:@@featureDeploymentConnections-baseUrlHintJenkins:URL of the Jenkins controller, e.g. https://jenkins.example.com`;
    }
  });
  readonly tokenHint = computed(() => {
    switch (this.form().provider) {
      case 'gitlab':
        return $localize`:@@featureDeploymentConnections-tokenHintGitlab:Personal, group or project access token with the api scope.`;
      case 'jenkins':
        return $localize`:@@featureDeploymentConnections-tokenHintJenkins:API token of the Jenkins user (User › Security › API Token).`;
      default:
        return $localize`:@@featureDeploymentConnections-tokenHintGithub:Fine-grained token with Actions (read and write) and Contents (read) access.`;
    }
  });
  readonly appHint = $localize`:@@featureDeploymentConnections-appHint:The GitHub App needs Actions (read and write) and Contents (read) permissions and must be installed on the repositories.`;
  readonly workspaceOptions = computed<FpcMultiSelectOption[]>(() => {
    const options = this.clients().map((client) => ({
      value: client.id,
      label: resolveNamedDisplayLabel(client.name),
    }));
    const known = new Set(options.map((option) => option.value));
    // Workspaces outside the loaded batch stay selectable / removable.
    const unknown = this.form()
      .allowedClientIds.filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: id }));

    return [...unknown, ...options];
  });

  readonly deleteConfirmOpen = signal(false);
  readonly pendingDelete = signal<DeploymentConnectionSummary | null>(null);
  readonly deleteConfirmMessage = computed(() => {
    const label = this.pendingDelete()?.label ?? '';

    return $localize`:@@featureDeploymentConnections-deleteConfirmMessage:Delete "${label}:label:"? Connections that pipelines still use cannot be deleted.`;
  });
  readonly bulkBusy = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureDeploymentConnections-bulkDeleteMessage:Delete ${this.selectedConnections().length}:count: connections? Connections that pipelines still use are kept.`,
  );

  constructor() {
    this.clientsFacade.loadClients({ limit: WORKSPACE_OPTIONS_LIMIT, offset: 0 });

    const debouncedSearch = toSignal(
      toObservable(this.search).pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
      { initialValue: '' },
    );

    effect(() => {
      const search = debouncedSearch();
      const provider = this.providerFilter();
      const page = this.page();
      const pageSize = this.pageSize();

      untracked(() => this.facade.load({ search, provider, limit: pageSize, offset: (page - 1) * pageSize }));
    });

    // The editor closes after a successful save.
    effect(() => {
      const saving = this.saving();
      const error = this.error();

      if (!saving && this.editorSubmitted) {
        untracked(() => {
          this.editorSubmitted = false;

          if (!error) {
            this.editorOpen.set(false);
          }
        });
      }
    });
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  isTesting(id: string): boolean {
    return this.testingIds().includes(id);
  }

  accessSummary(connection: DeploymentConnectionSummary): string {
    if (connection.workspaceAccess === 'all') {
      return this.accessAllLabel;
    }

    const count = connection.allowedClientIds.length;

    return $localize`:@@featureDeploymentConnections-accessCount:${count}:count: selected`;
  }

  accessNames(connection: DeploymentConnectionSummary): string {
    return connection.allowedClientIds
      .map((id) => resolveNamedDisplayLabel(this.clients().find((client) => client.id === id)?.name ?? id))
      .join(', ');
  }

  onProviderFilterChange(provider: string): void {
    this.page.set(1);
    this.providerFilter.set(isDeploymentProvider(provider) ? provider : null);
  }

  onRefresh(): void {
    this.facade.load({
      search: this.search(),
      provider: this.providerFilter(),
      limit: this.pageSize(),
      offset: (this.page() - 1) * this.pageSize(),
    });
  }

  onDismissError(): void {
    this.facade.clearError();
  }

  onDismissTest(): void {
    this.facade.clearTestResult();
  }

  onRowAction(connection: DeploymentConnectionSummary, action: string): void {
    switch (action) {
      case 'edit':
        this.openEdit(connection);
        break;
      case 'test':
        this.facade.test(connection.id);
        break;
      case 'copy-id':
        fpcCopyText(connection.id);
        break;
      case 'delete':
        this.onRequestDelete(connection);
        break;
    }
  }

  // --- editor ---------------------------------------------------------------------------------------------------

  openCreate(): void {
    this.facade.clearError();
    this.editing.set(null);
    this.form.set(emptyDeploymentConnectionForm());
    this.editorOpen.set(true);
  }

  openEdit(connection: DeploymentConnectionSummary): void {
    this.facade.clearError();
    this.editing.set(connection);
    this.form.set(deploymentConnectionFormFrom(connection));
    this.editorOpen.set(true);
  }

  patchForm(patch: Partial<DeploymentConnectionFormValue>): void {
    this.form.update((form) => ({ ...form, ...patch }));
  }

  /** Another provider: its default auth type (only supported types are offered). */
  onProviderChange(provider: string): void {
    if (!isDeploymentProvider(provider) || this.editing()) {
      return;
    }

    this.form.update((form) => ({ ...emptyDeploymentConnectionForm(provider), label: form.label }));
  }

  onAuthTypeChange(authType: ConnectionAuthType, checked: boolean): void {
    if (checked) {
      this.patchForm({ authType });
    }
  }

  onSave(): void {
    if (this.formError()) {
      return;
    }

    const editing = this.editing();

    this.editorSubmitted = true;

    if (editing) {
      this.facade.update(editing.id, deploymentConnectionUpdateDto(this.form()));
    } else {
      this.facade.create(deploymentConnectionCreateDto(this.form()));
    }
  }

  // --- delete / bulk ----------------------------------------------------------------------------------------------

  onRequestDelete(connection: DeploymentConnectionSummary): void {
    this.facade.clearError();
    this.pendingDelete.set(connection);
    this.deleteConfirmOpen.set(true);
  }

  /** A connection still used by workflows is refused (409); the backend message shows as page alert. */
  onConfirmDelete(): void {
    const connection = this.pendingDelete();

    this.deleteConfirmOpen.set(false);
    this.pendingDelete.set(null);

    if (connection) {
      this.facade.delete(connection.id);
    }
  }

  onBulkTest(): void {
    void this.runBulk(this.selectedConnections(), (connection) => firstValueFrom(this.service.test(connection.id)));
  }

  onConfirmBulkDelete(): void {
    void this.runBulk(this.selectedConnections(), (connection) => firstValueFrom(this.service.delete(connection.id)));
  }

  private async runBulk(
    connections: readonly DeploymentConnectionSummary[],
    run: (connection: DeploymentConnectionSummary) => Promise<unknown>,
  ): Promise<void> {
    if (connections.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(connections, run);

      this.bulkResult.set(agBulkSummary(result, (connection) => connection.label));
      this.selectedIds.set(result.failed.concat(result.denied).map((connection) => connection.id));
      this.onRefresh();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
