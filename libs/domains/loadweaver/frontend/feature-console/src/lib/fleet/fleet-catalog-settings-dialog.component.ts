import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  apiErrorMessage,
  FleetCatalogService,
  type CreateFleetCatalogSettings,
  type FleetCatalogSettingsSource,
  type FleetCatalogTrust,
  type FleetCluster,
  type FleetOperation,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const CATALOG_TRUST_LABELS: readonly FleetCatalogTrust[] = ['official', 'verified', 'community'];

/** A further catalog row of the dialog. */
export interface CatalogSettingsRow {
  name: string;
  type: 'git' | 'oci';
  url: string;
  ref: string;
  publicKey: string;
  enabled: boolean;
}

export interface CatalogSettingsForm {
  clusterIds: string[];
  includeFleetCatalog: boolean;
  fleetCatalogEnabled: boolean;
  /** The preconfigured official catalog: leave it, or switch it on / off. */
  official: 'keep' | 'enable' | 'disable';
  changeTrust: boolean;
  allowedTrust: FleetCatalogTrust[];
  catalogs: CatalogSettingsRow[];
  replaceCatalogs: boolean;
  apply: boolean;
}

export function emptyCatalogSettingsForm(): CatalogSettingsForm {
  return {
    clusterIds: [],
    includeFleetCatalog: true,
    fleetCatalogEnabled: true,
    official: 'keep',
    changeTrust: false,
    allowedTrust: ['official', 'verified'],
    catalogs: [],
    replaceCatalogs: false,
    apply: false,
  };
}

export function emptyCatalogRow(): CatalogSettingsRow {
  return { name: '', type: 'git', url: '', ref: '', publicKey: '', enabled: true };
}

/** The request of the dialog, or the reason it can't be sent yet (the fleet checks the catalogs in full). */
export function buildCatalogSettings(
  form: CatalogSettingsForm,
  fleetUrl: string | null,
): { request: CreateFleetCatalogSettings } | { error: string } {
  if (form.clusterIds.length === 0)
    return { error: $localize`:@@lwConsoleFleetCatalogOp-errClusters:Choose at least one cluster.` };

  if (form.changeTrust && form.allowedTrust.length === 0)
    return { error: $localize`:@@lwConsoleFleetCatalogOp-errTrust:Allow at least one trust label.` };

  const catalogs: FleetCatalogSettingsSource[] = [];

  for (const row of form.catalogs) {
    if (!NAME.test(row.name.trim()) || !row.url.trim() || !row.publicKey.includes('BEGIN PUBLIC KEY'))
      return {
        error: $localize`:@@lwConsoleFleetCatalogOp-errCatalog:Every catalog needs a name (a-z, 0-9, -), a URL and its public key (PEM).`,
      };

    catalogs.push({
      name: row.name.trim(),
      type: row.type,
      url: row.url.trim(),
      ...(row.type === 'git' && row.ref.trim() ? { ref: row.ref.trim() } : {}),
      publicKeys: [row.publicKey.trim()],
      enabled: row.enabled,
    });
  }

  const request: CreateFleetCatalogSettings = {
    clusterIds: [...form.clusterIds],
    includeFleetCatalog: form.includeFleetCatalog,
    ...(form.includeFleetCatalog ? { fleetCatalogEnabled: form.fleetCatalogEnabled } : {}),
    ...(form.includeFleetCatalog && fleetUrl ? { fleetUrl } : {}),
    ...(catalogs.length ? { catalogs } : {}),
    ...(form.official === 'enable' ? { enable: ['official'] } : {}),
    ...(form.official === 'disable' ? { disable: ['official'] } : {}),
    ...(form.replaceCatalogs ? { replaceCatalogs: true } : {}),
    ...(form.changeTrust ? { allowedTrust: CATALOG_TRUST_LABELS.filter((t) => form.allowedTrust.includes(t)) } : {}),
    apply: form.apply,
  };

  if (
    !request.includeFleetCatalog &&
    !request.catalogs &&
    !request.enable &&
    !request.disable &&
    !request.allowedTrust &&
    !request.replaceCatalogs
  )
    return { error: $localize`:@@lwConsoleFleetCatalogOp-errNothing:Choose at least one setting to apply.` };

  return { request };
}

export function catalogTrustLabel(trust: FleetCatalogTrust): string {
  switch (trust) {
    case 'official':
      return $localize`:@@lwConsoleFleetCatalogOp-trustOfficial:Official`;
    case 'verified':
      return $localize`:@@lwConsoleFleetCatalogOp-trustVerified:Verified`;
    default:
      return $localize`:@@lwConsoleFleetCatalogOp-trustCommunity:Community`;
  }
}

/**
 * "Apply catalog settings" (P1 app store, fleet admins): picks clusters, this fleet's catalog (its URL and key),
 * the official catalog toggle, further catalogs and the allowed trust labels; the fleet starts one operation per
 * cluster that plans `Cluster.spec.appStore` there (applied when asked; the cluster's approvals still hold it).
 */
@Component({
  selector: 'loadweaver-fleet-catalog-settings-dialog',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  templateUrl: './fleet-catalog-settings-dialog.component.html',
  standalone: true,
})
export class LoadweaverFleetCatalogSettingsDialogComponent {
  private readonly service = inject(FleetCatalogService);

  readonly open = model(false);
  readonly clusters = input<FleetCluster[]>([]);
  readonly started = output<FleetOperation[]>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<CatalogSettingsForm>(emptyCatalogSettingsForm());

  /** Clusters the settings can go to: active, not in a read-only grace. */
  readonly targets = computed(() => this.clusters().filter((c) => c.state === 'active' && !c.access.readOnly));
  readonly allSelected = computed(
    () => this.targets().length > 0 && this.targets().every((c) => this.form().clusterIds.includes(c.id)),
  );

  readonly title = $localize`:@@lwConsoleFleetCatalogOp-title:Apply catalog settings`;
  readonly clustersTitle = $localize`:@@lwConsoleFleetCatalogOp-clusters:Clusters`;
  readonly catalogsTitle = $localize`:@@lwConsoleFleetCatalogOp-catalogs:Catalogs`;
  readonly trustTitle = $localize`:@@lwConsoleFleetCatalogOp-trust:Allowed trust labels`;
  readonly closeLabel = $localize`:@@lwConsoleFleetCatalogOp-close:Close`;
  readonly removeLabel = $localize`:@@lwConsoleFleetCatalogOp-remove:Remove catalog`;
  readonly trustLabels = CATALOG_TRUST_LABELS;
  readonly trustLabel = catalogTrustLabel;

  /** Resets the form (called by the page before opening). */
  reset(): void {
    this.form.set(emptyCatalogSettingsForm());
    this.error.set(null);
  }

  patch(change: Partial<CatalogSettingsForm>): void {
    this.form.set({ ...this.form(), ...change });
  }

  toggleCluster(id: string, on: boolean): void {
    const ids = this.form().clusterIds.filter((x) => x !== id);

    this.patch({ clusterIds: on ? [...ids, id] : ids });
  }

  toggleAll(on: boolean): void {
    this.patch({ clusterIds: on ? this.targets().map((c) => c.id) : [] });
  }

  toggleTrust(trust: FleetCatalogTrust, on: boolean): void {
    const rest = this.form().allowedTrust.filter((t) => t !== trust);

    this.patch({ allowedTrust: on ? [...rest, trust] : rest });
  }

  addCatalog(): void {
    this.patch({ catalogs: [...this.form().catalogs, emptyCatalogRow()] });
  }

  updateCatalog(index: number, change: Partial<CatalogSettingsRow>): void {
    this.patch({ catalogs: this.form().catalogs.map((row, i) => (i === index ? { ...row, ...change } : row)) });
  }

  removeCatalog(index: number): void {
    this.patch({ catalogs: this.form().catalogs.filter((_, i) => i !== index) });
  }

  async submit(): Promise<void> {
    const built = buildCatalogSettings(
      this.form(),
      this.service.consoleFleetUrl(globalThis.location?.origin ?? 'http://localhost'),
    );

    if ('error' in built) {
      this.error.set(built.error);

      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const operations = await firstValueFrom(this.service.applySettings(built.request));

      this.open.set(false);
      this.started.emit(operations);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Failed to start the operation'));
    } finally {
      this.saving.set(false);
    }
  }
}
