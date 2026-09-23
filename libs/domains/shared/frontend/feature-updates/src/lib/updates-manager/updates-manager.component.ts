import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AdminUpdatesFacade,
  UPDATES_ADMIN_ENVIRONMENT,
  type ChangelogEntry,
  type DependencyHealthStatus,
  type ServiceInstanceRecord,
  type UpdateState,
} from '@forepath/shared/frontend/data-access-updates';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSectionColumnComponent,
  FpcSectionContainerComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatestWith, map } from 'rxjs';

import { parseChangelogMarkdownLinks, type ChangelogTextPart } from './changelog-text.utils';

type UpdatesMobilePanel = 'instances' | 'product' | 'shared';

const UPDATES_MOBILE_PANELS: UpdatesMobilePanel[] = ['instances', 'product', 'shared'];

@Component({
  selector: 'shared-updates-manager',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSectionColumnComponent,
    FpcSectionContainerComponent,
    FpcSectionRowComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
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

      return instances.filter((instance) => JSON.stringify(instance).toLowerCase().includes(term));
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
  readonly summaryCardCount = computed(() => (this.environment.frontendVersion ? 4 : 3));

  ngOnInit(): void {
    this.facade.loadFull();
  }

  onCheckNow(): void {
    this.facade.triggerCheck();
  }

  mobilePanelLabel(panel: UpdatesMobilePanel): string {
    switch (panel) {
      case 'instances':
        return $localize`:@@featureUpdates-mobilePanelInstances:Instances`;
      case 'product':
        return $localize`:@@featureUpdates-mobilePanelProduct:Product`;
      case 'shared':
        return $localize`:@@featureUpdates-mobilePanelShared:Shared`;
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
    switch (category.trim().toLowerCase()) {
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

  dependencyStatusTitle(name: string, status: DependencyHealthStatus): string {
    return `${name} · ${this.dependencyHealthLabel(status)}`;
  }

  dependencyHealthClass(status: DependencyHealthStatus): string {
    switch (status) {
      case 'healthy':
      case 'degraded':
        return 'bg-body-tertiary text-success fs-5';
      default:
        return 'bg-body-tertiary text-muted fs-5';
    }
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  formatVersion(version: string | null | undefined): string {
    const trimmed = version?.trim();

    if (!trimmed) {
      return '—';
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
