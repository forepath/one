import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleFleetFacade,
  fleetAvailabilityOf,
  type CreateFleetCluster,
  type FleetCluster,
  FleetService,
  type UpdateFleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcDataTableComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { isGlobalAdmin } from '../guards/global-admin.guard';
import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, DL_OPEN } from '../section/data-list';
import {
  fleetConnectionIcon,
  fleetConnectionLabel,
  fleetConnectionState,
  fleetConnectionTone,
  fleetRoleLabel,
} from './fleet-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The register / edit form; the credential is write-only (never loaded, only sent when entered). */
export interface FleetClusterForm {
  name: string;
  description: string;
  endpoint: string;
  credential: string;
  caCertificate: string;
  removeCa: boolean;
  test: boolean;
}

export function emptyClusterForm(): FleetClusterForm {
  return { name: '', description: '', endpoint: '', credential: '', caCertificate: '', removeCa: false, test: true };
}

/**
 * The change set of an edit: only what changed. Changing the endpoint or the CA needs the service credential again
 * in the same request (the fleet refuses otherwise), so `credentialRequired` tells the form.
 */
export function clusterUpdate(
  cluster: Pick<FleetCluster, 'description' | 'endpoint'>,
  form: FleetClusterForm,
): { update: UpdateFleetCluster; credentialRequired: boolean } {
  const update: UpdateFleetCluster = {};
  const endpoint = form.endpoint.trim();

  if (form.description.trim() !== (cluster.description ?? '')) update.description = form.description.trim();

  if (endpoint && endpoint !== cluster.endpoint) update.endpoint = endpoint;

  if (form.removeCa) update.caCertificate = '';
  else if (form.caCertificate.trim()) update.caCertificate = form.caCertificate.trim();

  if (form.credential) update.credential = form.credential;

  return { update, credentialRequired: update.endpoint !== undefined || update.caCertificate !== undefined };
}

/**
 * Fleet clusters (3.24): every connection the caller can see with its connection health, version and the caller's
 * access; fleet admins register clusters (connection test first), change endpoint / CA / description, rotate the
 * service credential (write-only) and remove connections.
 */
@Component({
  selector: 'loadweaver-fleet-clusters-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
  ],
  // List template: the table fills the page and scrolls itself (3.38).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './fleet-clusters-page.component.html',
  standalone: true,
})
export class LoadweaverFleetClustersPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly auth = inject(AuthenticationFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(FleetService);

  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly loading = toSignal(this.facade.clustersLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.clustersError$, { initialValue: null });
  readonly saving = toSignal(this.facade.saving$, { initialValue: false });
  readonly saveError = toSignal(this.facade.saveError$, { initialValue: null });
  readonly testing = toSignal(this.facade.testing$, { initialValue: false });
  readonly testResult = toSignal(this.facade.testResult$, { initialValue: null });
  readonly testError = toSignal(this.facade.testError$, { initialValue: null });
  readonly polling = toSignal(this.facade.polling$, { initialValue: [] as string[] });
  readonly pollError = toSignal(this.facade.pollError$, { initialValue: null });
  readonly admin = toSignal(isGlobalAdmin(this.auth), { initialValue: false });

  /** `null`: closed; `'new'`: register; a cluster: edit. */
  readonly editing = signal<FleetCluster | 'new' | null>(null);
  readonly deleting = signal<FleetCluster | null>(null);
  readonly formError = signal<string | null>(null);
  form: FleetClusterForm = emptyClusterForm();

  readonly isNew = computed(() => this.editing() === 'new');

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filtered = computed(() =>
    filterBySearch(this.clusters(), this.search(), (c) => [
      c.name,
      c.description,
      c.endpoint,
      c.health.version,
      c.reference ? this.cloudLabel : null,
    ]),
  );

  readonly title = $localize`:@@lwConsoleFleetClusters-title:Clusters`;
  readonly registerLabel = $localize`:@@lwConsoleFleetClusters-register:Register cluster`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetClusters-refresh:Refresh`;
  readonly editLabel = $localize`:@@lwConsoleFleetClusters-edit:Edit connection`;
  readonly deleteLabel = $localize`:@@lwConsoleFleetClusters-delete:Remove connection`;
  readonly pollLabel = $localize`:@@lwConsoleFleetClusters-poll:Check now`;
  readonly openLabel = $localize`:@@lwConsoleFleetClusters-open:Open`;
  readonly searchLabel = $localize`:@@lwConsoleFleetClusters-search:Search clusters`;
  readonly cloudLabel = $localize`:@@lwConsoleFleetClusters-cloud:Loadweaver Cloud`;
  readonly retiredLabel = $localize`:@@lwConsoleFleetClusters-retired:Retired`;
  readonly readOnlyUntilLabel = $localize`:@@lwConsoleFleetClusters-readOnlyUntil:Read-only until`;
  readonly deleteTitle = $localize`:@@lwConsoleFleetClusters-deleteTitle:Remove the connection?`;
  readonly deleteMessage = $localize`:@@lwConsoleFleetClusters-deleteMessage:The fleet forgets the connection and its grants. The cluster itself is not changed.`;
  readonly deleteConfirm = $localize`:@@lwConsoleFleetClusters-deleteConfirm:Remove`;
  readonly cancelLabel = $localize`:@@lwConsoleFleetClusters-cancel:Cancel`;

  readonly loadingLabel = $localize`:@@lwConsoleFleetClusters-loading:Loading clusters`;
  /** 3.38 D1: State (connection) · Cluster (→ details) · version · endpoint · your access; ⋮ actions; bulk. */
  readonly columns: FpcTableColumn<FleetCluster>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleFleetClusters-colConnection:Connection`,
      type: 'state',
      // Read-only clusters (3.43) as such: they answer, but changes are paused.
      state: (c) => fleetConnectionState(c.health, fleetAvailabilityOf(c)),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleFleetClusters-colName:Cluster`,
      value: (c) => c.name,
      required: true,
      priority: 1,
    },
    {
      id: 'checked',
      label: $localize`:@@lwConsoleFleetClusters-colChecked:Last check`,
      value: (c) => c.health.checkedAt ?? null,
      priority: 2,
    },
    {
      id: 'version',
      label: $localize`:@@lwConsoleFleetClusters-colVersion:Version`,
      value: (c) => c.health.version ?? '',
      mono: true,
      priority: 1,
    },
    {
      id: 'endpoint',
      label: $localize`:@@lwConsoleFleetClusters-colEndpoint:Endpoint`,
      value: (c) => c.endpoint,
      mono: true,
      priority: 3,
    },
    {
      id: 'access',
      label: $localize`:@@lwConsoleFleetClusters-colAccess:Your access`,
      value: (c) => this.accessText(c),
      priority: 2,
    },
  ];
  readonly rowLink = (c: FleetCluster) => `/fleet/clusters/${encodeURIComponent(c.id)}`;
  readonly rowMenu = (c: FleetCluster): FpcMenuItem[] => [
    ...(c.state !== 'retired' ? [{ id: 'open', label: DL_OPEN, icon: 'box-arrow-in-right' }] : []),
    { id: 'poll', label: this.pollLabel, icon: 'activity', disabled: this.polling().includes(c.id) },
    ...(this.admin()
      ? [
          { id: 'edit', label: this.editLabel, icon: 'pencil' },
          { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
        ]
      : []),
    { ...dlCopyIdItem(), dividerBefore: !this.admin() },
  ];
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly picked = computed(() => {
    const ids = new Set(this.selected());

    return this.clusters().filter((c) => ids.has(c.id));
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@lwConsoleFleetClusters-bulkDeleteMessage:The fleet forgets the connections and grants of ${this.picked().length}:count: selected clusters. The clusters themselves are not changed.`,
  );

  readonly connectionTone = fleetConnectionTone;
  readonly connectionIcon = fleetConnectionIcon;
  readonly connectionLabel = fleetConnectionLabel;
  readonly roleLabel = fleetRoleLabel;

  ngOnInit(): void {
    this.facade.loadClusters();
    this.facade.clusterSaved$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.editing.set(null));
    this.facade.clusterDeleted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.deleting.set(null));
  }

  refresh(): void {
    this.facade.loadClusters();
  }

  modalTitle(): string {
    const editing = this.editing();

    return editing === 'new' || editing === null ? this.registerLabel : `${this.editLabel}: ${editing.name}`;
  }

  openRegister(): void {
    this.form = emptyClusterForm();
    this.formError.set(null);
    this.facade.resetClusterForm();
    this.editing.set('new');
  }

  openEdit(cluster: FleetCluster, event?: Event): void {
    event?.stopPropagation();
    this.form = { ...emptyClusterForm(), description: cluster.description ?? '', endpoint: cluster.endpoint };
    this.formError.set(null);
    this.facade.resetClusterForm();
    this.editing.set(cluster);
  }

  onModalOpenChange(open: boolean): void {
    if (!open) this.editing.set(null);
  }

  editingCluster(): FleetCluster | null {
    const editing = this.editing();

    return editing === 'new' ? null : editing;
  }

  credentialHint(): string {
    const cluster = this.editingCluster();

    if (!cluster)
      return $localize`:@@lwConsoleFleetClusters-credentialHintNew:PAT of the cluster's fleet service user. Stored encrypted; it is never shown again.`;

    return this.credentialRequired()
      ? $localize`:@@lwConsoleFleetClusters-credentialHintAgain:Required again: the endpoint or CA changes.`
      : `${$localize`:@@lwConsoleFleetClusters-credentialHintKeep:Leave empty to keep the stored credential (ending in`} ${cluster.credentialHint}).`;
  }

  /** Whether the edit needs the credential re-entered (endpoint or CA changed). */
  credentialRequired(): boolean {
    const editing = this.editing();

    if (editing === null) return false;

    if (editing === 'new') return true;

    return clusterUpdate(editing, this.form).credentialRequired;
  }

  canTest(): boolean {
    return !!this.form.endpoint.trim() && this.form.credential.length >= 16;
  }

  test(): void {
    if (!this.canTest()) return;

    this.facade.testConnection({
      endpoint: this.form.endpoint.trim(),
      credential: this.form.credential,
      ...(this.form.caCertificate.trim() && !this.form.removeCa
        ? { caCertificate: this.form.caCertificate.trim() }
        : {}),
    });
  }

  save(): void {
    const editing = this.editing();

    this.formError.set(null);

    if (editing === null) return;

    if (this.form.credential && this.form.credential.length < 16) {
      this.formError.set(
        $localize`:@@lwConsoleFleetClusters-credentialShort:The service credential has at least 16 characters.`,
      );

      return;
    }

    if (editing === 'new') {
      if (!NAME.test(this.form.name.trim())) {
        this.formError.set(
          $localize`:@@lwConsoleFleetClusters-nameInvalid:Name: lowercase letters, digits and dashes (DNS label).`,
        );

        return;
      }

      if (!this.form.endpoint.trim() || !this.form.credential) {
        this.formError.set($localize`:@@lwConsoleFleetClusters-required:Endpoint and service credential are required.`);

        return;
      }

      const create: CreateFleetCluster = {
        name: this.form.name.trim(),
        endpoint: this.form.endpoint.trim(),
        credential: this.form.credential,
        test: this.form.test,
        ...(this.form.description.trim() ? { description: this.form.description.trim() } : {}),
        ...(this.form.caCertificate.trim() ? { caCertificate: this.form.caCertificate.trim() } : {}),
      };

      this.facade.createCluster(create);

      return;
    }

    const { update, credentialRequired } = clusterUpdate(editing, this.form);

    if (credentialRequired && !update.credential) {
      this.formError.set(
        $localize`:@@lwConsoleFleetClusters-credentialAgain:Changing the endpoint or the CA needs the service credential again.`,
      );

      return;
    }

    if (Object.keys(update).length === 0) {
      this.editing.set(null);

      return;
    }

    this.facade.updateCluster(editing.id, update);
  }

  poll(cluster: FleetCluster, event?: Event): void {
    event?.stopPropagation();
    this.facade.pollCluster(cluster.id);
  }

  askDelete(cluster: FleetCluster, event?: Event): void {
    event?.stopPropagation();
    this.deleting.set(cluster);
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.deleting.set(null);
  }

  confirmDelete(): void {
    const cluster = this.deleting();

    if (cluster) this.facade.deleteCluster(cluster.id);
  }

  onRowAction(cluster: FleetCluster, action: string): void {
    if (action === 'open') this.openCluster(cluster);
    else if (action === 'poll') this.poll(cluster);
    else if (action === 'edit') this.openEdit(cluster);
    else if (action === 'delete') this.askDelete(cluster);
    else if (action === 'copy-id') fpcCopyText(cluster.id);
  }

  /** Bulk Check connection: one poll per cluster (same endpoint + authorization as the row action). */
  async pollSelected(): Promise<void> {
    const clusters = this.picked();

    if (clusters.length === 0) return;

    const result = await fpcRunBulk(clusters, (c) => firstValueFrom(this.service.pollCluster(c.id)));

    this.bulkResult.set(dlBulkSummary(result, (c) => c.name));
    this.selected.set([]);
    this.refresh();
  }

  /** Bulk Remove (fleet admins): one delete per cluster, per-cluster result. */
  async deleteSelected(): Promise<void> {
    const clusters = this.picked();

    if (clusters.length === 0 || !this.admin()) return;

    const result = await fpcRunBulk(clusters, (c) => firstValueFrom(this.service.deleteCluster(c.id)));

    this.bulkResult.set(dlBulkSummary(result, (c) => c.name));
    this.selected.set([]);
    this.refresh();
  }

  openDetail(cluster: FleetCluster): void {
    void this.router.navigate(['/fleet/clusters', cluster.id]);
  }

  openCluster(cluster: FleetCluster, event?: Event): void {
    event?.stopPropagation();
    this.facade.openCluster(cluster.id);
  }

  accessText(cluster: FleetCluster): string {
    const projects = Object.entries(cluster.access.projects);

    if (cluster.access.clusterRole) return this.roleLabel(cluster.access.clusterRole);

    return projects.length > 0
      ? projects.map(([p, r]) => `${p}: ${this.roleLabel(r)}`).join(', ')
      : this.roleLabel(null);
  }
}
