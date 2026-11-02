import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  apiErrorMessage,
  type AppDetail,
  type AppManifest,
  AppStoreService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverReferenceFieldComponent } from '../objects/reference-field.component';
import { LoadweaverReferenceSource } from '../objects/reference-source';
import { LoadweaverSchemaFieldComponent } from '../objects/schema-field.component';
import {
  buildInstallRequest,
  dependencyBundled,
  DEPLOYMENT_NAME_PATTERN,
  type InstallDependencyField,
  installFormModel,
  initialParameterValues,
  missingSecrets,
  visibleSecrets,
  parameterIssues,
  suggestionItems,
  type SuggestionGroup,
} from './app-install-form';
import { appPlanRoute, latestOnChannel, notInstallableText, sortVersions, versionChannels } from './apps-format';

/**
 * Install an app (P1): project, deployment name, channel / version, the parameter form generated from the manifest's
 * JSON Schema (the resource form's field component), dependency toggles (bundled vs provided), secret references
 * (existing secrets of the project; names only) and the suggested resources → `POST /apps/…/plan`, then the plan /
 * draft opens like other create flows. The cluster validates everything again.
 */
@Component({
  selector: 'loadweaver-app-install-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    LoadweaverReferenceFieldComponent,
    LoadweaverSchemaFieldComponent,
  ],
  // Secret pickers suggest the names of the chosen project's secrets.
  providers: [LoadweaverReferenceSource],
  templateUrl: './app-install-modal.component.html',
})
export class LoadweaverAppInstallModalComponent {
  private readonly api = inject(AppStoreService);
  private readonly router = inject(Router);
  private readonly references = inject(LoadweaverReferenceSource);

  readonly open = model(false);
  readonly detail = input<AppDetail | null>(null);
  /** Projects the caller may install into. */
  readonly projects = input<readonly string[]>([]);
  /** Pre-selected project (project page, `?project=`). */
  readonly project = input<string | null>(null);

  readonly selectedProject = signal('');
  readonly name = signal('');
  readonly channel = signal('stable');
  readonly version = signal('');
  readonly values = signal<Record<string, unknown>>({});
  readonly secrets = signal<Record<string, string>>({});
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The manifest of the chosen version (the detail's, or loaded for another version). */
  readonly manifest = signal<AppManifest | null>(null);
  readonly loadingManifest = signal(false);
  readonly attempted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly versions = computed(() => sortVersions(this.detail()?.versions ?? []));
  readonly channels = computed(() => versionChannels(this.versions(), this.detail()?.manifest?.channels ?? []));
  readonly channelVersions = computed(() => this.versions().filter((v) => v.channel === this.channel()));
  readonly model = computed(() => {
    const manifest = this.manifest();

    return manifest ? installFormModel(manifest) : { parameters: [], dependencies: [] };
  });
  readonly suggestions = computed(() => {
    const manifest = this.manifest();

    return manifest ? suggestionItems(manifest) : [];
  });
  readonly issues = computed(() => parameterIssues(this.model(), this.values()));
  readonly shownIssues = computed(() => (this.attempted() ? this.issues() : []));
  readonly missing = computed(() => {
    const manifest = this.manifest();

    return manifest ? missingSecrets(manifest, this.secrets(), this.values()) : [];
  });
  /** Secrets to pick: conditional ones only while their condition holds (e.g. an integration switched on). */
  readonly shownSecrets = computed(() => {
    const manifest = this.manifest();

    return manifest ? visibleSecrets(manifest, this.values()) : [];
  });
  readonly nameInvalid = computed(() => !!this.name().trim() && !DEPLOYMENT_NAME_PATTERN.test(this.name().trim()));
  readonly valid = computed(
    () =>
      !!this.selectedProject() &&
      !!this.version() &&
      !!this.manifest() &&
      !this.loadingManifest() &&
      !this.nameInvalid() &&
      this.issues().length === 0 &&
      this.missing().length === 0,
  );
  readonly blocked = computed(() => this.detail()?.installable === false || this.projects().length === 0);

  readonly installLabel = $localize`:@@lwConsoleApps-install:Install`;
  readonly planLabel = $localize`:@@lwConsoleApps-createPlan:Create plan`;
  readonly cancelLabel = $localize`:@@lwConsoleApps-cancel:Cancel`;
  readonly projectLabel = $localize`:@@lwConsoleApps-project:Project`;
  readonly nameLabel = $localize`:@@lwConsoleApps-deploymentName:Deployment name`;
  readonly nameHint = $localize`:@@lwConsoleApps-deploymentNameHint:The app is installed as this Deployment; lower-case letters, digits and dashes.`;
  readonly channelLabel = $localize`:@@lwConsoleApps-channel:Channel`;
  readonly versionLabel = $localize`:@@lwConsoleApps-version:Version`;
  readonly parametersTitle = $localize`:@@lwConsoleApps-parameters:Parameters`;
  readonly dependenciesTitle = $localize`:@@lwConsoleApps-dependencies:Dependencies`;
  readonly secretsTitle = $localize`:@@lwConsoleApps-secrets:Secrets`;
  readonly secretsHint = $localize`:@@lwConsoleApps-secretsHint:Pick an existing secret of the project for each; values are never shown here. Add missing ones under Delivery › Secrets.`;
  readonly suggestionsTitle = $localize`:@@lwConsoleApps-suggestions:Suggested resources`;
  readonly suggestionsHint = $localize`:@@lwConsoleApps-suggestionsHint:Created in the same plan; uncheck what you don't want.`;
  readonly bundledLabel = $localize`:@@lwConsoleApps-bundled:Bundled with the app`;
  readonly providedHint = $localize`:@@lwConsoleApps-providedHint:Connect an existing service with these parameters.`;
  readonly noParametersLabel = $localize`:@@lwConsoleApps-noParameters:This app has no parameters.`;
  readonly noProjectLabel = $localize`:@@lwConsoleApps-noProject:You can't install apps: that needs the developer role (or higher) in a project.`;
  /** Why the app can't be installed (trust label, or the cluster is older than `minLoadweaver`). */
  readonly notInstallableLabel = computed(() => {
    const d = this.detail();

    return d ? notInstallableText(d) : '';
  });
  readonly secretMissingLabel = $localize`:@@lwConsoleApps-secretMissing:Pick a secret for each entry.`;
  readonly invalidNameLabel = $localize`:@@lwConsoleApps-invalidName:Use lower-case letters, digits and dashes (max. 63).`;
  readonly failedLabel = $localize`:@@lwConsoleApps-installFailed:The install plan couldn't be created.`;
  readonly loadFailedLabel = $localize`:@@lwConsoleApps-versionFailed:This version's manifest couldn't be loaded.`;
  readonly groupLabels: Record<SuggestionGroup, string> = {
    groups: $localize`:@@lwConsoleApps-suggestGroups:Groups`,
    policies: $localize`:@@lwConsoleApps-suggestPolicies:Policies`,
    ingress: $localize`:@@lwConsoleApps-suggestIngress:Ingress`,
    dns: $localize`:@@lwConsoleApps-suggestDns:DNS`,
    backups: $localize`:@@lwConsoleApps-backups:Backups`,
  };

  readonly title = computed(() => {
    const d = this.detail();

    return d ? $localize`:@@lwConsoleApps-installTitle:Install ${d.title}:app:` : this.installLabel;
  });

  constructor() {
    // Opening (or another app) starts a fresh form from the detail.
    effect(() => {
      const open = this.open();
      const detail = this.detail();

      if (!open || !detail) return;

      untracked(() => this.reset(detail));
    });
    effect(() => this.references.project.set(this.selectedProject() || null));
  }

  private reset(detail: AppDetail): void {
    const projects = this.projects();
    const preset = this.project();
    const latest = latestOnChannel(detail.versions, 'stable') ?? sortVersions(detail.versions)[0] ?? null;

    this.selectedProject.set(preset && projects.includes(preset) ? preset : (projects[0] ?? ''));
    this.name.set(detail.name);
    this.channel.set(latest?.channel ?? 'stable');
    this.version.set(latest?.version ?? detail.manifest.version);
    this.secrets.set({});
    this.attempted.set(false);
    this.error.set(null);
    this.saving.set(false);
    this.applyManifest(detail.manifest, false);

    if (latest && latest.version !== detail.manifest.version) this.loadVersion(latest.version);
  }

  /** A new manifest: defaults, values of parameters that still exist kept (`keep`), all suggestions checked. */
  private applyManifest(manifest: AppManifest, keep: boolean): void {
    const defaults = initialParameterValues(manifest);
    const current = keep ? this.values() : {};
    const names = new Set(Object.keys(manifest.parameters?.properties ?? {}));
    const kept = Object.fromEntries(Object.entries(current).filter(([k]) => names.has(k)));

    this.manifest.set(manifest);
    this.values.set({ ...defaults, ...kept });
    this.selected.set(new Set(suggestionItems(manifest).map((s) => s.key)));
  }

  private loadVersion(version: string): void {
    const detail = this.detail();

    if (!detail) return;

    this.loadingManifest.set(true);
    this.api.app(detail.catalog, detail.name, version).subscribe({
      next: (d) => {
        if (this.version() !== version) return;

        this.applyManifest(d.manifest, true);
        this.loadingManifest.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e, this.loadFailedLabel));
        this.loadingManifest.set(false);
      },
    });
  }

  setChannel(channel: string): void {
    this.channel.set(channel);

    const latest = latestOnChannel(this.versions(), channel);

    if (latest) this.setVersion(latest.version);
  }

  setVersion(version: string): void {
    this.version.set(version);

    if (this.manifest()?.version !== version) this.loadVersion(version);
  }

  setValue(name: string, value: unknown): void {
    const next = { ...this.values() };

    if (value === undefined) delete next[name];
    else next[name] = value;

    this.values.set(next);
  }

  setSecret(name: string, value: string | undefined): void {
    this.secrets.set({ ...this.secrets(), [name]: value ?? '' });
  }

  toggleSuggestion(key: string, checked: boolean): void {
    const next = new Set(this.selected());

    if (checked) next.add(key);
    else next.delete(key);

    this.selected.set(next);
  }

  bundled(dependency: InstallDependencyField): boolean {
    return dependencyBundled(dependency, this.values());
  }

  setBundled(dependency: InstallDependencyField, bundled: boolean): void {
    if (dependency.toggle) this.setValue(dependency.toggle, bundled);
  }

  submit(): void {
    this.attempted.set(true);

    const detail = this.detail();
    const manifest = this.manifest();

    if (!detail || !manifest || !this.valid() || this.blocked() || this.saving()) return;

    const request = buildInstallRequest({
      manifest,
      project: this.selectedProject(),
      name: this.name(),
      values: this.values(),
      secrets: this.secrets(),
      suggestions: this.suggestions(),
      selected: this.selected(),
    });

    this.saving.set(true);
    this.error.set(null);
    this.api.installPlan(detail.catalog, detail.name, this.version(), request).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.open.set(false);
        void this.router.navigate(appPlanRoute(result) ?? ['/activity/drafts']);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(e, this.failedLabel));
      },
    });
  }
}
