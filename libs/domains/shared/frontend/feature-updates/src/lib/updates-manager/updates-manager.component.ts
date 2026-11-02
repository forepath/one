import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AdminUpdatesFacade,
  UPDATES_ADMIN_ENVIRONMENT,
  type ChangelogEntry,
  type DependencyHealthStatus,
  type ServiceInstanceRecord,
  type UpdateChannel,
  type UpdateState,
} from '@forepath/shared/frontend/data-access-updates';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSectionContainerComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  fpcCopyIdMenuItem,
  fpcCopyText,
  type FpcBadgeTone,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { combineLatestWith, map } from 'rxjs';

import {
  splitSharedChangelog,
  changelogBreaking,
  changelogCategory,
  parseChangelogEntry,
  parseChangelogMarkdownLinks,
  type ChangelogTextPart,
} from './changelog-text.utils';

type UpdatesMobilePanel = 'instances' | 'product' | 'shared';

/** A changelog entry as a table row (entries carry no id; the position within the list is stable per load). */
interface ChangelogRow extends ChangelogEntry {
  id: string;
  /** The entry's scope tag (`**shared:**` / `fix(shared):`), shown before the text; null = no scope given. */
  tag: string | null;
  /** A breaking change: an extra icon-only marker next to the type badge (the type stays the type). */
  breaking: boolean;
}

interface InstanceDependencyBadge {
  key: string;
  label: string;
  tone: FpcBadgeTone;
  icon: string;
}

const UPDATES_MOBILE_PANELS: UpdatesMobilePanel[] = ['instances', 'product', 'shared'];

/** Docker's default container hostname: the 12-hex-char short container id. */
export function fpcIsContainerHostname(hostname: string | null | undefined): boolean {
  return !!hostname && /^[0-9a-f]{12}$/.test(hostname);
}

@Component({
  selector: 'shared-updates-manager',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSectionContainerComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './updates-manager.component.html',
  styleUrls: ['./updates-manager.component.scss'],
  standalone: true,
})
export class UpdatesManagerComponent implements OnInit {
  private readonly facade = inject(AdminUpdatesFacade);
  readonly environment = inject(UPDATES_ADMIN_ENVIRONMENT);

  readonly fullState$ = this.facade.fullState$;
  readonly fullLoading$ = this.facade.fullLoading$;
  readonly checking$ = this.facade.checking$;
  readonly error$ = this.facade.error$;
  readonly scopedChangelog$ = this.facade.scopedChangelog$;

  readonly pageTitle = $localize`:@@featureUpdates-title:Updates`;
  readonly checkNowTitle = $localize`:@@featureUpdates-checkNow:Check now`;
  readonly installedVersionLabel = $localize`:@@featureUpdates-installedVersion:Installed version`;
  readonly latestVersionLabel = $localize`:@@featureUpdates-latestVersion:Latest version`;
  readonly lastCheckLabel = $localize`:@@featureUpdates-lastCheck:Last check`;
  readonly frontendVersionLabel = $localize`:@@featureUpdates-frontendVersion:Frontend version`;
  readonly channelLabel = $localize`:@@featureUpdates-channel:Channel`;
  readonly betaLabel = $localize`:@@featureUpdates-channelBeta:Beta`;
  readonly searchInstancesPlaceholder = $localize`:@@featureUpdates-searchInstancesPlaceholder:Search instances`;
  readonly searchProductChangelogPlaceholder = $localize`:@@featureUpdates-searchProductChangelogPlaceholder:Search product changelog`;
  readonly searchSharedChangelogPlaceholder = $localize`:@@featureUpdates-searchSharedChangelogPlaceholder:Search shared changelog`;

  readonly mobilePanels = UPDATES_MOBILE_PANELS;
  readonly mobilePanel = signal<UpdatesMobilePanel>('instances');
  readonly searchQuery = signal('');
  readonly productChangelogSearch = signal('');
  readonly sharedChangelogSearch = signal('');
  private readonly searchQuery$ = toObservable(this.searchQuery);
  private readonly productChangelogSearch$ = toObservable(this.productChangelogSearch);
  private readonly sharedChangelogSearch$ = toObservable(this.sharedChangelogSearch);

  readonly filteredInstances$ = this.facade.instances$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([instances, searchQuery]) => {
      const term = searchQuery.trim().toLowerCase();

      if (!term) {
        return instances;
      }

      return instances.filter((instance) =>
        [
          this.serviceNameLabel(instance.serviceName),
          instance.hostname,
          instance.installedVersion ?? '',
          this.roleLabel(instance.role),
          this.updateStateLabel(instance.updateState),
        ]
          .join(' ')
          .toLowerCase()
          .includes(term),
      );
    }),
  );

  readonly filteredProductChangelog$ = this.facade.scopedChangelog$.pipe(
    combineLatestWith(this.productChangelogSearch$),
    map(([changelog, searchQuery]) => this.filterChangelogEntries(changelog.product, searchQuery)),
  );

  readonly filteredSharedChangelog$ = this.facade.scopedChangelog$.pipe(
    combineLatestWith(this.sharedChangelogSearch$),
    map(([changelog, searchQuery]) => this.filterChangelogEntries(changelog.shared, searchQuery)),
  );

  readonly fullState = toSignal(this.fullState$, { initialValue: null });
  readonly error = toSignal(this.error$, { initialValue: null as string | null });
  readonly filteredInstances = toSignal(this.filteredInstances$, {
    initialValue: [] as ServiceInstanceRecord[],
  });
  readonly filteredProductChangelog = toSignal(this.filteredProductChangelog$, {
    initialValue: [] as ChangelogEntry[],
  });
  readonly filteredSharedChangelog = toSignal(this.filteredSharedChangelog$, {
    initialValue: [] as ChangelogEntry[],
  });
  /** The running product (from its own changelog entries), so misfiled entries of it move to its list. */
  private readonly currentProduct = computed(
    () => this.fullState()?.scopedChangelog?.product.find((entry) => !!entry.product)?.product ?? null,
  );
  private readonly sharedSplit = computed(() =>
    splitSharedChangelog(this.filteredSharedChangelog(), this.currentProduct()),
  );
  readonly productChangelogRows = computed(() =>
    this.toChangelogRows([...this.filteredProductChangelog(), ...this.sharedSplit().product], 'product'),
  );
  readonly sharedChangelogRows = computed(() => this.toChangelogRows(this.sharedSplit().shared, 'shared'));

  // Tables (3.38: tabs instead of stacked lanes, State column, readable values, instance id only via ⋮ Copy ID)
  readonly instancesTitle = $localize`:@@featureUpdates-instancesTitle:Service instances`;
  readonly productChangelogTitle = $localize`:@@featureUpdates-changelogProduct:Product changelog`;
  readonly breakingLabel = $localize`:@@featureUpdates-breaking:Breaking change`;
  readonly generalScopeLabel = $localize`:@@featureUpdates-scopeGeneral:general`;
  readonly generalScopeTitle = $localize`:@@featureUpdates-scopeGeneralTitle:No scope given`;
  readonly sharedChangelogTitle = $localize`:@@featureUpdates-changelogShared:Shared changelog`;
  readonly dependenciesLabel = $localize`:@@featureUpdates-colDependencies:Dependencies`;
  private readonly copyIdLabel = $localize`:@@sharedDataList-copyId:Copy ID`;

  readonly instanceRowId = (instance: ServiceInstanceRecord): string => instance.instanceId;

  /** Host cell text: real host names as they are, a container's generated id hostname as "—" (D11). */
  hostLabel(hostname: string | null | undefined): string {
    return !hostname || fpcIsContainerHostname(hostname) ? '—' : hostname;
  }

  readonly instanceColumns: FpcTableColumn<ServiceInstanceRecord>[] = [
    {
      id: 'state',
      label: $localize`:@@featureUpdates-colState:State`,
      type: 'state',
      state: (instance) => this.updateTableState(instance.updateState),
    },
    {
      id: 'name',
      label: $localize`:@@featureUpdates-colService:Service`,
      value: (instance) => this.serviceNameLabel(instance.serviceName),
      required: true,
      priority: 1,
    },
    {
      id: 'host',
      label: $localize`:@@featureUpdates-colHost:Host`,
      // D11 / DB-23: a container's generated hostname (12 hex chars) is no host name; it shows as "—" (full value in the
      // cell's tooltip), real host names stay.
      value: (instance) => (fpcIsContainerHostname(instance.hostname) ? '' : instance.hostname),
      priority: 1,
    },
    {
      id: 'version',
      label: $localize`:@@featureUpdates-colVersion:Version`,
      value: (instance) => this.formatVersion(instance.installedVersion),
      mono: true,
      priority: 2,
    },
    {
      id: 'role',
      label: $localize`:@@featureUpdates-colRole:Role`,
      value: (instance) => this.roleLabel(instance.role),
      priority: 2,
    },
    {
      id: 'dependencies',
      label: $localize`:@@featureUpdates-colDependencies:Dependencies`,
      priority: 2,
    },
    {
      id: 'heartbeat',
      label: $localize`:@@featureUpdates-colHeartbeat:Last heartbeat`,
      value: (instance) => instance.lastHeartbeatAt ?? '',
      priority: 3,
    },
  ];

  readonly changelogColumns: FpcTableColumn<ChangelogRow>[] = [
    {
      id: 'state',
      label: $localize`:@@featureUpdates-colCategory:Category`,
      type: 'state',
      iconOnly: false,
      state: (entry) => this.changelogCategoryState(entry.category),
    },
    {
      id: 'name',
      label: $localize`:@@featureUpdates-colChange:Change`,
      value: (entry) => entry.text,
      required: true,
      priority: 1,
    },
  ];

  readonly instanceRowMenu = (): FpcMenuItem[] => [fpcCopyIdMenuItem(this.copyIdLabel)];

  readonly summaryCardCount = computed(
    () => 3 + (this.environment.frontendVersion ? 1 : 0) + (this.fullState()?.channel ? 1 : 0),
  );

  ngOnInit(): void {
    this.facade.loadFull();
  }

  onCheckNow(): void {
    this.facade.triggerCheck();
  }

  mobilePanelLabel(panel: UpdatesMobilePanel): string {
    switch (panel) {
      case 'instances':
        return this.instancesTitle;
      case 'product':
        return this.productChangelogTitle;
      case 'shared':
        return this.sharedChangelogTitle;
    }
  }

  onMobilePanelTabChange(panel: string | null): void {
    if (panel !== 'instances' && panel !== 'product' && panel !== 'shared') {
      return;
    }

    this.mobilePanel.set(panel);
  }

  private filterChangelogEntries(entries: ChangelogEntry[], searchQuery: string): ChangelogEntry[] {
    const term = searchQuery.trim().toLowerCase();

    if (!term) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = `${entry.category ?? ''} ${entry.text}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  /** The release channel products with channels follow (`beta` includes prereleases). */
  channelName(channel: UpdateChannel | undefined): string {
    return channel === 'beta' ? this.betaLabel : $localize`:@@featureUpdates-channelStable:Stable`;
  }

  updateStateLabel(state: UpdateState | undefined): string {
    switch (state) {
      case 'update_available':
        return $localize`:@@featureUpdates-statusUpdateAvailable:Update available`;
      case 'up_to_date':
        return $localize`:@@featureUpdates-statusUpToDate:Up to date`;
      default:
        return $localize`:@@featureUpdates-statusUnknown:Unknown`;
    }
  }

  updateStateIconClass(state: UpdateState | undefined): string {
    switch (state) {
      case 'update_available':
        return 'bi-exclamation-circle text-warning';
      case 'up_to_date':
        return 'bi-check-circle text-success';
      default:
        return 'bi-question-circle text-secondary';
    }
  }

  serviceNameLabel(serviceName: string): string {
    switch (serviceName.trim().toLowerCase()) {
      case 'billing-manager':
        return $localize`:@@featureUpdates-serviceBillingManager:Billing manager`;
      case 'agent-controller':
        return $localize`:@@featureUpdates-serviceAgentController:Agent controller`;
      case 'agent-manager':
        return $localize`:@@featureUpdates-serviceAgentManager:Agent manager`;
      default:
        return this.humanizeIdentifier(serviceName);
    }
  }

  roleLabel(role: string): string {
    switch (role.trim().toLowerCase()) {
      case 'api':
        return $localize`:@@featureUpdates-roleApi:API`;
      case 'worker':
        return $localize`:@@featureUpdates-roleWorker:Worker`;
      case 'scheduler':
        return $localize`:@@featureUpdates-roleScheduler:Scheduler`;
      case 'all':
        return $localize`:@@featureUpdates-roleAll:All`;
      default:
        return this.humanizeIdentifier(role);
    }
  }

  changelogCategoryLabel(category: string): string {
    switch (
      category
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .trim()
        .toLowerCase()
    ) {
      case 'feat':
      case 'feature':
      case 'features':
        return $localize`:@@featureUpdates-categoryFeatures:Features`;
      case 'fix':
      case 'bug fix':
      case 'bug fixes':
      case 'bugfixes':
        return $localize`:@@featureUpdates-categoryBugFixes:Bug fixes`;
      case 'docs':
      case 'documentation':
        return $localize`:@@featureUpdates-categoryDocumentation:Documentation`;
      case 'style':
        return $localize`:@@featureUpdates-categoryStyle:Style`;
      case 'refactor':
        return $localize`:@@featureUpdates-categoryRefactor:Refactor`;
      case 'perf':
      case 'performance':
        return $localize`:@@featureUpdates-categoryPerformance:Performance`;
      case 'test':
      case 'tests':
        return $localize`:@@featureUpdates-categoryTests:Tests`;
      case 'build':
        return $localize`:@@featureUpdates-categoryBuild:Build`;
      case 'ci':
        return $localize`:@@featureUpdates-categoryCi:CI`;
      case 'chore':
        return $localize`:@@featureUpdates-categoryChore:Chore`;
      case 'revert':
        return $localize`:@@featureUpdates-categoryRevert:Revert`;
      case 'breaking changes':
      case 'breaking change':
        return $localize`:@@featureUpdates-categoryBreakingChanges:Breaking changes`;
      default:
        return this.humanizeIdentifier(category);
    }
  }

  dependencyHealthLabel(status: DependencyHealthStatus): string {
    switch (status) {
      case 'healthy':
        return $localize`:@@featureUpdates-dependencyHealthy:Healthy`;
      case 'degraded':
        return $localize`:@@featureUpdates-dependencyDegraded:Degraded`;
      case 'not_applicable':
        return $localize`:@@featureUpdates-dependencyNotApplicable:N/A`;
      default:
        return $localize`:@@featureUpdates-dependencyUnknown:Unknown`;
    }
  }

  onInstanceAction(instance: ServiceInstanceRecord, action: string): void {
    if (action === 'copy-id') {
      fpcCopyText(instance.instanceId);
    }
  }

  /** The four dependency checks of an instance as icon-only badges (readable label as tooltip). */
  instanceDependencies(instance: ServiceInstanceRecord): InstanceDependencyBadge[] {
    const badge = (key: string, name: string, icon: string, status: DependencyHealthStatus) => ({
      key,
      icon,
      label: this.dependencyStatusTitle(name, status),
      tone: (status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'neutral') as FpcBadgeTone,
    });

    return [
      badge('redis', 'Valkey / Redis', 'memory', instance.dependencies.redis),
      badge('queue', $localize`:@@featureUpdates-dependencyQueue:Queue`, 'stack', instance.dependencies.queue),
      badge(
        'database',
        $localize`:@@featureUpdates-dependencyDatabase:Database`,
        'database',
        instance.dependencies.database,
      ),
      badge('opensearch', 'OpenSearch', 'search', instance.dependencies.opensearch),
    ];
  }

  updateTableState(state: UpdateState | undefined): FpcTableState {
    const label = this.updateStateLabel(state);

    switch (state) {
      case 'update_available':
        return { label, tone: 'warning', icon: 'exclamation-circle' };
      case 'up_to_date':
        return { label, tone: 'success', icon: 'check-circle' };
      default:
        return { label, tone: 'neutral', icon: 'question-circle' };
    }
  }

  changelogCategoryState(category: string | null | undefined): FpcTableState {
    // Release notes may prefix a section with an emoji ("⚠ Breaking Changes"): the words decide.
    const key = (category ?? '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim()
      .toLowerCase();

    if (!key) {
      return { label: $localize`:@@featureUpdates-categoryOther:Other`, tone: 'neutral', icon: 'dot' };
    }

    const label = this.changelogCategoryLabel(category as string);

    if (key.startsWith('breaking')) return { label, tone: 'danger', icon: 'exclamation-octagon' };
    if (key.startsWith('feat')) return { label, tone: 'primary', icon: 'stars' };
    if (key.includes('fix')) return { label, tone: 'success', icon: 'bug' };
    if (key.startsWith('perf')) return { label, tone: 'info', icon: 'speedometer2' };

    return { label, tone: 'neutral', icon: 'dot' };
  }

  /** Rows: scope tag and readable text from the release-note line, a generic category refined by its commit type. */
  private toChangelogRows(entries: ChangelogEntry[], scope: string): ChangelogRow[] {
    return entries.map((entry, index) => {
      const view = parseChangelogEntry(entry.text);

      return {
        ...entry,
        id: `${scope}-${index}`,
        text: view.text,
        tag: view.scope,
        breaking: changelogBreaking(entry.category, view),
        category: changelogCategory(entry.category, view),
      };
    });
  }

  dependencyStatusTitle(name: string, status: DependencyHealthStatus): string {
    return `${name}: ${this.dependencyHealthLabel(status)}`;
  }

  formatVersion(version: string | null | undefined): string {
    const trimmed = version?.trim();

    if (!trimmed) {
      return '-';
    }

    return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
  }

  changelogTextParts(text: string): ChangelogTextPart[] {
    return parseChangelogMarkdownLinks(text);
  }

  private humanizeIdentifier(value: string): string {
    const normalized = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

    if (!normalized) {
      return value;
    }

    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
