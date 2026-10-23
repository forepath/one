import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsolePostureService,
  type CertificateTrustSettings,
  type PostureIntegration,
  type PostureMatchKey,
  type PosturePluginInfo,
  type PostureTestResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import {
  configPayload,
  INTEGRATION_NAME_PATTERN,
  integrationStatusLabel,
  integrationStatusTone,
  matchKeyLabel,
  missingFields,
  orderedMatchBy,
  POSTURE_MATCH_KEYS,
} from './posture-format';

interface IntegrationForm {
  id: string | null;
  name: string;
  type: string;
  enabled: boolean;
  values: Record<string, string>;
  secretsSet: string[];
  matchBy: PostureMatchKey[];
  requireUserMatch: boolean;
  intervalMinutes: number;
  maxAgeMinutes: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: string | string[] } | null)?.message;

    return Array.isArray(message) ? message.join('; ') : (message ?? error.message);
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * Device posture (3.31, cluster settings): MDM / EDR integrations with their sync state (connection test, sync now,
 * edit, delete — cluster admins), and the trust for device certificates (company CA bundle, CRLs, cluster CA,
 * proof of possession). Secrets are write-only: the form shows which are stored, never their values.
 */
@Component({
  selector: 'loadweaver-posture-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './posture-page.component.html',
  standalone: true,
})
export class LoadweaverPosturePageComponent implements OnInit {
  private readonly api = inject(ConsolePostureService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly mayEdit = computed(() => this.me()?.clusterRole === 'cluster-admin');
  readonly plugins = signal<PosturePluginInfo[]>([]);
  readonly integrations = signal<PostureIntegration[]>([]);
  readonly trust = signal<CertificateTrustSettings | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly results = signal<Record<string, PostureTestResult>>({});

  readonly form = signal<IntegrationForm | null>(null);
  readonly formError = signal<string | null>(null);
  readonly formTest = signal<PostureTestResult | null>(null);
  readonly saving = signal(false);
  readonly deleteFor = signal<PostureIntegration | null>(null);

  readonly trustForm = signal({ companyCaPem: '', crlPem: '', trustClusterCa: true, requireProof: true });
  readonly trustError = signal<string | null>(null);
  readonly trustSaved = signal(false);

  readonly matchKeys = POSTURE_MATCH_KEYS;
  readonly matchKeyLabel = matchKeyLabel;
  readonly statusTone = integrationStatusTone;
  readonly statusLabel = integrationStatusLabel;

  readonly formPlugin = computed(() => {
    const form = this.form();

    return form ? (this.plugins().find((p) => p.id === form.type) ?? null) : null;
  });
  readonly formMissing = computed(() => {
    const form = this.form();
    const plugin = this.formPlugin();

    return form && plugin ? missingFields(plugin, form.values, form.secretsSet) : [];
  });
  readonly formValid = computed(() => {
    const form = this.form();

    return (
      !!form &&
      !!this.formPlugin() &&
      INTEGRATION_NAME_PATTERN.test(form.name) &&
      form.matchBy.length > 0 &&
      this.formMissing().length === 0 &&
      form.intervalMinutes >= 5 &&
      form.intervalMinutes <= 1440 &&
      form.maxAgeMinutes >= 10 &&
      form.maxAgeMinutes <= 10080
    );
  });
  readonly deleteMessage = computed(() => {
    const integration = this.deleteFor();

    return integration
      ? $localize`:@@lwConsolePosture-deleteMessage:${integration.name}:name: and its results are removed from every device. Conditions that use it fail until another integration provides the facts.`
      : null;
  });

  readonly title = $localize`:@@lwConsolePosture-title:Device posture`;
  readonly refreshLabel = $localize`:@@lwConsolePosture-refresh:Refresh`;
  readonly addLabel = $localize`:@@lwConsolePosture-add:Add integration`;
  readonly integrationsTitle = $localize`:@@lwConsolePosture-integrations:MDM and EDR integrations`;
  readonly certificatesTitle = $localize`:@@lwConsolePosture-certificates:Device certificates`;
  readonly createTitle = $localize`:@@lwConsolePosture-createTitle:Add a posture integration`;
  readonly editTitle = $localize`:@@lwConsolePosture-editTitle:Edit posture integration`;
  readonly deleteTitle = $localize`:@@lwConsolePosture-deleteTitle:Delete the integration?`;
  readonly deleteConfirm = $localize`:@@lwConsolePosture-deleteConfirm:Delete`;
  readonly cancelLabel = $localize`:@@lwConsolePosture-cancel:Cancel`;
  readonly secretStoredHint = $localize`:@@lwConsolePosture-secretStored:Stored — leave empty to keep it`;
  readonly trustClusterCaLabel = $localize`:@@lwConsolePosture-trustClusterCa:Trust device certificates issued by the cluster CA at enrollment`;
  readonly requireProofLabel = $localize`:@@lwConsolePosture-requireProof:Require a proof of possession with each report`;
  readonly enabledLabel = $localize`:@@lwConsolePosture-enabled:Enabled`;
  readonly requireUserMatchLabel = $localize`:@@lwConsolePosture-requireUserMatch:The device user in the MDM must be the owner of the VPN client`;
  readonly hostnameWarning = $localize`:@@lwConsolePosture-hostnameWarning:Matching by hostname is weak: hostnames are self-reported and not unique, so another device reporting the same name could inherit this verdict. Prefer serial number or device ID, require the device user to match and combine with device.certificate.valid.`;
  readonly userMatchOffWarning = $localize`:@@lwConsolePosture-userMatchOffWarning:The device user is not compared with the owner of the VPN client: a device enrolled by someone else could inherit this verdict.`;

  /** Localized warnings for weak matching settings (the API reports the same in `warnings`). */
  integrationWarnings(i: Pick<PostureIntegration, 'type' | 'matchBy' | 'requireUserMatch'>): string[] {
    const supports = this.plugins().find((p) => p.id === i.type)?.supportsUserMatch === true;

    return [
      ...(i.matchBy.includes('hostname') ? [this.hostnameWarning] : []),
      ...(supports && i.requireUserMatch === false ? [this.userMatchOffWarning] : []),
    ];
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [plugins, integrations, trust] = await Promise.all([
        firstValueFrom(this.api.plugins()),
        firstValueFrom(this.api.integrations()),
        firstValueFrom(this.api.certificateTrust()),
      ]);

      this.plugins.set(plugins);
      this.integrations.set(integrations);
      this.trust.set(trust);
      this.trustForm.set({
        companyCaPem: trust.companyCaPem ?? '',
        crlPem: trust.crlPem ?? '',
        trustClusterCa: trust.trustClusterCa,
        requireProof: trust.requireProof,
      });
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  pluginName(type: string): string {
    return this.plugins().find((p) => p.id === type)?.displayName ?? type;
  }

  openCreate(): void {
    const plugin = this.plugins()[0];

    this.formError.set(null);
    this.formTest.set(null);
    this.form.set({
      id: null,
      name: '',
      type: plugin?.id ?? '',
      enabled: true,
      values: Object.fromEntries((plugin?.fields ?? []).filter((f) => f.default).map((f) => [f.key, f.default ?? ''])),
      secretsSet: [],
      matchBy: [...(plugin?.defaultMatchBy ?? ['serial'])],
      requireUserMatch: plugin?.supportsUserMatch === true,
      intervalMinutes: 30,
      maxAgeMinutes: 1440,
    });
  }

  openEdit(integration: PostureIntegration): void {
    this.formError.set(null);
    this.formTest.set(null);
    this.form.set({
      id: integration.id,
      name: integration.name,
      type: integration.type,
      enabled: integration.enabled,
      values: { ...integration.config },
      secretsSet: [...integration.secretsSet],
      matchBy: [...integration.matchBy],
      requireUserMatch: integration.requireUserMatch === true,
      intervalMinutes: integration.intervalMinutes,
      maxAgeMinutes: integration.maxAgeMinutes,
    });
  }

  patchForm(patch: Partial<IntegrationForm>): void {
    const form = this.form();

    if (!form) return;

    if (patch.type && patch.type !== form.type) {
      const plugin = this.plugins().find((p) => p.id === patch.type);

      this.form.set({
        ...form,
        ...patch,
        values: Object.fromEntries(
          (plugin?.fields ?? []).filter((f) => f.default).map((f) => [f.key, f.default ?? '']),
        ),
        matchBy: [...(plugin?.defaultMatchBy ?? form.matchBy)],
        requireUserMatch: plugin?.supportsUserMatch === true,
      });

      return;
    }

    this.form.set({ ...form, ...patch });
  }

  /** Current value of a plugin field in the form (keys a plugin declares may be absent until edited). */
  fieldValue(values: Record<string, string>, key: string, fallback?: string): string {
    return (values as Partial<Record<string, string>>)[key] ?? fallback ?? '';
  }

  setValue(key: string, value: string): void {
    const form = this.form();

    if (form) this.form.set({ ...form, values: { ...form.values, [key]: value } });
  }

  toggleMatch(key: PostureMatchKey, on: boolean): void {
    const form = this.form();
    const plugin = this.formPlugin();

    if (!form || !plugin) return;

    const selected = on ? [...form.matchBy, key] : form.matchBy.filter((k) => k !== key);

    this.form.set({ ...form, matchBy: orderedMatchBy(selected, plugin) });
  }

  onFormOpenChange(open: boolean): void {
    if (!open) this.form.set(null);
  }

  async testForm(): Promise<void> {
    const form = this.form();
    const plugin = this.formPlugin();

    if (!form || !plugin) return;

    this.formTest.set(null);
    this.saving.set(true);

    try {
      // Saved integrations are tested with their stored secrets; new ones with what the form holds.
      this.formTest.set(
        await firstValueFrom(
          form.id ? this.api.test(form.id) : this.api.testUnsaved(form.type, configPayload(plugin, form.values, false)),
        ),
      );
    } catch (error) {
      this.formTest.set({ ok: false, message: errorMessage(error) });
    } finally {
      this.saving.set(false);
    }
  }

  async save(): Promise<void> {
    const form = this.form();
    const plugin = this.formPlugin();

    if (!form || !plugin || !this.formValid()) return;

    this.saving.set(true);
    this.formError.set(null);

    const body = {
      enabled: form.enabled,
      config: configPayload(plugin, form.values, !!form.id),
      matchBy: form.matchBy,
      ...(plugin.supportsUserMatch ? { requireUserMatch: form.requireUserMatch } : {}),
      intervalMinutes: Number(form.intervalMinutes),
      maxAgeMinutes: Number(form.maxAgeMinutes),
    };

    try {
      if (form.id) await firstValueFrom(this.api.update(form.id, body));
      else await firstValueFrom(this.api.create({ ...body, name: form.name, type: form.type }));

      this.form.set(null);
      await this.load();
    } catch (error) {
      this.formError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  async test(integration: PostureIntegration): Promise<void> {
    this.busy.set(`test:${integration.id}`);

    try {
      const result = await firstValueFrom(this.api.test(integration.id));

      this.results.set({ ...this.results(), [integration.id]: result });
    } catch (error) {
      this.results.set({ ...this.results(), [integration.id]: { ok: false, message: errorMessage(error) } });
    } finally {
      this.busy.set(null);
    }
  }

  async sync(integration: PostureIntegration): Promise<void> {
    this.busy.set(`sync:${integration.id}`);

    try {
      await firstValueFrom(this.api.sync(integration.id));
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(null);
    }
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.deleteFor.set(null);
  }

  async confirmDelete(): Promise<void> {
    const integration = this.deleteFor();

    this.deleteFor.set(null);

    if (!integration) return;

    try {
      await firstValueFrom(this.api.remove(integration.id));
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  patchTrust(patch: Partial<ReturnType<typeof this.trustForm>>): void {
    this.trustSaved.set(false);
    this.trustForm.set({ ...this.trustForm(), ...patch });
  }

  async saveTrust(): Promise<void> {
    const form = this.trustForm();

    this.trustError.set(null);
    this.trustSaved.set(false);

    try {
      this.trust.set(
        await firstValueFrom(
          this.api.updateCertificateTrust({
            companyCaPem: form.companyCaPem.trim() || null,
            crlPem: form.crlPem.trim() || null,
            trustClusterCa: form.trustClusterCa,
            requireProof: form.requireProof,
          }),
        ),
      );
      this.trustSaved.set(true);
    } catch (error) {
      this.trustError.set(errorMessage(error));
    }
  }
}
