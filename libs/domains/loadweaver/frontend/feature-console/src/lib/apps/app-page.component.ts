import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  apiErrorMessage,
  type AppDetail,
  AppStoreService,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
} from '@forepath/loadweaver/frontend/data-access-console';
import { MarkdownParserService } from '@forepath/shared/frontend/util-docs-parser';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverLaneComponent } from '../section/lane.component';
import { LoadweaverAppInstallModalComponent } from './app-install-modal.component';
import { installFormModel, suggestionItems } from './app-install-form';
import { LoadweaverAppTrustBadgeComponent } from './app-trust-badge.component';
import { installProjects, notInstallableText, secretConditionText, sortVersions } from './apps-format';

/**
 * An app's page (P1, `/delivery/apps/:catalog/:app`): title, publisher, trust, licence, versions and channels, the
 * README (the docs' markdown renderer; Angular sanitizes the HTML), a preview of the parameters, secrets,
 * dependencies, suggestions and backups, and Install (pre-selecting `?project=`; `?install=1` opens it directly).
 */
@Component({
  selector: 'loadweaver-app-page',
  standalone: true,
  imports: [
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcKeyValueListComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAppInstallModalComponent,
    LoadweaverAppTrustBadgeComponent,
    LoadweaverLaneComponent,
  ],
  templateUrl: './app-page.component.html',
  styles: `
    .lw-app-readme :is(img, video) {
      max-width: 100%;
      height: auto;
    }
    .lw-app-readme pre {
      padding: 0.75rem;
      border-radius: var(--bs-border-radius);
      background-color: var(--bs-tertiary-bg);
      overflow-x: auto;
    }
    .lw-app-readme :is(h1, h2, h3) {
      font-size: 1.125rem;
      margin-top: 1rem;
    }
  `,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverAppPageComponent {
  private readonly api = inject(AppStoreService);
  private readonly markdown = inject(MarkdownParserService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly accessManagement = inject(ConsoleAccessManagementFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  private readonly allProjects = toSignal(this.accessManagement.projects$, { initialValue: [] as string[] });

  readonly detail = signal<AppDetail | null>(null);
  readonly readmeHtml = signal<string>('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly installOpen = signal(false);
  /** Lane shown below md (lane tabs); both lanes from md up. */
  readonly lane = signal<'readme' | 'details'>('readme');

  readonly catalog = computed(() => this.params().get('catalog') ?? '');
  readonly appName = computed(() => this.params().get('app') ?? '');
  readonly presetProject = computed(() => this.query().get('project'));
  readonly projects = computed(() => installProjects(this.me(), this.allProjects()));
  readonly versions = computed(() => sortVersions(this.detail()?.versions ?? []));
  readonly form = computed(() => {
    const d = this.detail();

    return d ? installFormModel(d.manifest) : null;
  });
  readonly parameterRows = computed(() => {
    const m = this.detail()?.manifest;

    if (!m) return [];

    const required = new Set(m.parameters?.required ?? []);

    return Object.entries(m.parameters?.properties ?? {}).map(([name, schema]) => ({
      name,
      title: schema.title ?? name,
      type: schema.type,
      default: schema.default === undefined ? '' : String(schema.default),
      required: required.has(name),
      description: schema.description ?? '',
    }));
  });
  readonly suggestions = computed(() => {
    const m = this.detail()?.manifest;

    return m ? suggestionItems(m).filter((s) => s.group !== 'backups') : [];
  });
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const d = this.detail();

    if (!d) return [];

    const m = d.manifest;

    return [
      { key: 'publisher', label: this.publisherLabel, value: d.publisher },
      { key: 'catalog', label: this.catalogLabel, value: d.catalog, mono: true },
      { key: 'license', label: this.licenseLabel, value: m.license, mono: true },
      { key: 'version', label: this.versionLabel, value: m.version, mono: true },
      { key: 'channels', label: this.channelsLabel, value: (m.channels ?? []).join(', ') },
      ...(m.minLoadweaver ? [{ key: 'min', label: this.minLabel, value: m.minLoadweaver, mono: true }] : []),
    ];
  });
  readonly installBlocked = computed(() => {
    const d = this.detail();

    return !d || d.installable === false || this.projects().length === 0;
  });

  readonly backLabel = $localize`:@@lwConsoleApps-back:All apps`;
  readonly installLabel = $localize`:@@lwConsoleApps-install:Install`;
  readonly noProjectLabel = $localize`:@@lwConsoleApps-noProject:You can't install apps: that needs the developer role (or higher) in a project.`;
  /** Why the app can't be installed (trust label, or the cluster is older than `minLoadweaver`). */
  readonly notInstallableLabel = computed(() => {
    const d = this.detail();

    return d ? notInstallableText(d) : '';
  });
  readonly loadingLabel = $localize`:@@lwConsoleApps-loading:Loading the app…`;
  readonly notFoundLabel = $localize`:@@lwConsoleApps-detailFailed:The app couldn't be loaded.`;
  readonly publisherLabel = $localize`:@@lwConsoleApps-colPublisher:Publisher`;
  readonly catalogLabel = $localize`:@@lwConsoleApps-catalog:Catalog`;
  readonly licenseLabel = $localize`:@@lwConsoleApps-license:Licence`;
  readonly versionLabel = $localize`:@@lwConsoleApps-shownVersion:Version shown`;
  readonly channelsLabel = $localize`:@@lwConsoleApps-channels:Channels`;
  readonly minLabel = $localize`:@@lwConsoleApps-minLoadweaver:Needs Loadweaver`;
  readonly homepageLabel = $localize`:@@lwConsoleApps-homepage:Homepage`;
  readonly docsLabel = $localize`:@@lwConsoleApps-docs:Documentation`;
  readonly versionsTitle = $localize`:@@lwConsoleApps-versions:Versions`;
  readonly parametersTitle = $localize`:@@lwConsoleApps-parameters:Parameters`;
  readonly secretsTitle = $localize`:@@lwConsoleApps-secrets:Secrets`;
  readonly conditionText = secretConditionText;
  readonly dependenciesTitle = $localize`:@@lwConsoleApps-dependencies:Dependencies`;
  readonly suggestionsTitle = $localize`:@@lwConsoleApps-suggestions:Suggested resources`;
  readonly backupsTitle = $localize`:@@lwConsoleApps-backups:Backups`;
  readonly requiredLabel = $localize`:@@lwConsoleApps-required:required`;
  readonly bundledLabel = $localize`:@@lwConsoleApps-bundled:Bundled with the app`;
  readonly providedLabel = $localize`:@@lwConsoleApps-provided:or provided`;
  readonly deprecatedLabel = $localize`:@@lwConsoleApps-deprecatedHint:This app is deprecated: it gets no new versions.`;
  readonly readmeTitle = $localize`:@@lwConsoleApps-readmeLane:README`;
  readonly detailsTitle = $localize`:@@lwConsoleApps-detailsLane:Details`;
  readonly lanesLabel = $localize`:@@lwConsoleApps-detailLanes:README and details`;
  readonly readmeEmptyLabel = $localize`:@@lwConsoleApps-noReadme:No README.`;
  readonly colName = $localize`:@@lwConsoleApps-colName:Name`;
  readonly colType = $localize`:@@lwConsoleApps-colType:Type`;
  readonly colDefault = $localize`:@@lwConsoleApps-colDefault:Default`;
  readonly colVersion = $localize`:@@lwConsoleApps-colVersion:Version`;
  readonly colChannel = $localize`:@@lwConsoleApps-colChannel:Channel`;
  readonly colPublished = $localize`:@@lwConsoleApps-colPublished:Published`;

  constructor() {
    effect(() => {
      const catalog = this.catalog();
      const app = this.appName();

      untracked(() => this.load(catalog, app));
    });
    effect(() => {
      const me = this.me();

      if (me && (me.clusterRole === 'cluster-admin' || me.allProjects))
        untracked(() => this.accessManagement.loadProjects());
    });
    this.access.load();
  }

  private load(catalog: string, app: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.detail.set(null);
    this.readmeHtml.set('');
    this.api
      .app(catalog, app)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
          void this.renderReadme(detail.readme ?? '');

          if (this.query().get('install') === '1' && !this.installBlocked()) this.installOpen.set(true);
        },
        error: (e: unknown) => {
          this.error.set(apiErrorMessage(e, this.notFoundLabel));
          this.loading.set(false);
        },
      });
  }

  private async renderReadme(readme: string): Promise<void> {
    if (!readme.trim()) return;

    try {
      const doc = await this.markdown.parseMarkdown(readme, 'README.md');

      this.readmeHtml.set(doc.html ?? '');
    } catch {
      this.readmeHtml.set('');
    }
  }
}
