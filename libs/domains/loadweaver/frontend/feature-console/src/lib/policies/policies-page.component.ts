import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePoliciesFacade,
  type GroupMember,
  type GroupMembers,
  type PolicyResource,
  type WorkloadGroupResource,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { projectParams, resourceEditLink, resourceKey, resourceLink } from '../resources/resource-format';
import { groupKey, policySummary, ruleLabel, selectorLabel } from './policy-format';

/** How many members a group shows in the list. */
const MEMBER_PREVIEW = 5;

/**
 * Groups & policies (3.3): workload groups with their selectors, current members and the exposed flag, and the
 * policies (from → to → rules, mode, action) per project. Changes are made in the resource editor (as plans); the map
 * shows them as edges.
 */
@Component({
  selector: 'loadweaver-policies-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './policies-page.component.html',
  standalone: true,
})
export class LoadweaverPoliciesPageComponent implements OnInit {
  private readonly facade = inject(ConsolePoliciesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);

  readonly groups = toSignal(this.facade.groups$, { initialValue: [] as WorkloadGroupResource[] });
  readonly policies = toSignal(this.facade.policies$, { initialValue: [] as PolicyResource[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly members = toSignal(this.facade.members$, { initialValue: null as GroupMembers | null });
  private readonly resourceProjects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly project = signal('');

  readonly projects = computed(() => [...new Set([...this.resourceProjects(), ...this.memberProjects()])].sort());
  readonly filteredGroups = computed(() =>
    this.byProject(this.groups()).sort(
      (a, b) =>
        (a.metadata.project ?? '').localeCompare(b.metadata.project ?? '') ||
        a.metadata.name.localeCompare(b.metadata.name),
    ),
  );
  /** Cluster-wide policies are shown with every project. */
  readonly filteredPolicies = computed(() =>
    this.byProject(this.policies(), true).sort(
      (a, b) =>
        (a.metadata.project ?? '').localeCompare(b.metadata.project ?? '') ||
        a.metadata.name.localeCompare(b.metadata.name),
    ),
  );

  readonly selectorLabel = selectorLabel;
  readonly summary = policySummary;
  readonly ruleLabel = ruleLabel;
  readonly projectParams = projectParams;
  readonly memberPreview = MEMBER_PREVIEW;

  readonly title = $localize`:@@lwConsolePolicies-title:Groups & policies`;
  readonly refreshLabel = $localize`:@@lwConsolePolicies-refresh:Refresh`;
  readonly projectFilterLabel = $localize`:@@lwConsolePolicies-projectFilter:Project`;
  readonly groupsTitle = $localize`:@@lwConsolePolicies-groups:Workload groups`;
  readonly policiesTitle = $localize`:@@lwConsolePolicies-policies:Policies`;
  readonly clusterWideLabel = $localize`:@@lwConsolePolicies-clusterWide:Cluster-wide`;
  readonly editLabel = $localize`:@@lwConsolePolicies-edit:Edit`;

  ngOnInit(): void {
    this.facade.load();
  }

  refresh(): void {
    this.facade.load();
  }

  /** Members of a group, or null when the map isn't available. */
  membersOf(group: WorkloadGroupResource): GroupMember[] | null {
    const members = this.members();

    return members ? (members[groupKey(group)] ?? []) : null;
  }

  openPolicy(policy: PolicyResource): void {
    void this.router.navigate(['/policies', policy.metadata.name], {
      queryParams: projectParams(policy.metadata.project),
    });
  }

  openGroup(group: WorkloadGroupResource): void {
    void this.router.navigate(resourceLink(resourceKey(group)), { queryParams: projectParams(group.metadata.project) });
  }

  editGroup(group: WorkloadGroupResource): void {
    void this.router.navigate(resourceEditLink(resourceKey(group)), {
      queryParams: projectParams(group.metadata.project),
    });
  }

  /** New groups and policies are written in the resource editor, in the selected project. */
  create(kind: 'WorkloadGroup' | 'Policy'): void {
    void this.router.navigate(['/resources', 'new'], {
      queryParams: { kind, ...projectParams(this.project() || this.projects()[0]) },
    });
  }

  private byProject<T extends WorkloadGroupResource | PolicyResource>(list: T[], withClusterWide = false): T[] {
    const project = this.project();

    return list.filter((r) => !project || r.metadata.project === project || (withClusterWide && !r.metadata.project));
  }
}
