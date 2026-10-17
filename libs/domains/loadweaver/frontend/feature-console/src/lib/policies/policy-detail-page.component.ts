import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsolePoliciesFacade,
  type GroupMembers,
  type PolicyPeer,
  type PolicyResource,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest } from 'rxjs';

import { projectParams, resourceEditLink, resourceLink } from '../resources/resource-format';
import { peerGroupKey, peerIcon, peerLabel, ruleLabel } from './policy-format';

/**
 * One policy (3.3): from → to → rules with mode and action, the groups it connects and how many members they have.
 * Editing goes through the resource editor (a plan).
 */
@Component({
  selector: 'loadweaver-policy-detail-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './policy-detail-page.component.html',
  standalone: true,
})
export class LoadweaverPolicyDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsolePoliciesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly policies = toSignal(this.facade.policies$, { initialValue: [] as PolicyResource[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly members = toSignal(this.facade.members$, { initialValue: null as GroupMembers | null });

  readonly name = signal<string | null>(null);
  readonly project = signal<string | null>(null);

  readonly policy = computed(
    () =>
      this.policies().find((p) => p.metadata.name === this.name() && (p.metadata.project ?? null) === this.project()) ??
      null,
  );
  /** From and to, side by side. */
  readonly sides = computed(() => {
    const policy = this.policy();

    return policy
      ? [
          { id: 'from', title: this.fromTitle, peers: policy.spec.from },
          { id: 'to', title: this.toTitle, peers: policy.spec.to },
        ]
      : [];
  });
  readonly key = computed(() => {
    const name = this.name();

    return name ? { kind: 'Policy', name, project: this.project() } : null;
  });

  readonly peerLabel = peerLabel;
  readonly peerIcon = peerIcon;
  readonly ruleLabel = ruleLabel;
  readonly resourceLink = resourceLink;
  readonly editLink = resourceEditLink;
  readonly projectParams = projectParams;

  readonly title = $localize`:@@lwConsolePolicyDetail-title:Policy`;
  readonly backLabel = $localize`:@@lwConsolePolicyDetail-back:Groups & policies`;
  readonly overviewTitle = $localize`:@@lwConsolePolicyDetail-overview:Overview`;
  readonly fromTitle = $localize`:@@lwConsolePolicyDetail-from:From`;
  readonly toTitle = $localize`:@@lwConsolePolicyDetail-to:To`;
  readonly rulesTitle = $localize`:@@lwConsolePolicyDetail-rules:Rules`;

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        this.name.set(params.get('name'));
        this.project.set(query.get('project') || null);
      });
    this.facade.load();
  }

  /** Current members of a group peer (null for other peers or without the map). */
  memberCount(peer: PolicyPeer): number | null {
    const key = peerGroupKey(peer, this.project());
    const members = this.members();

    return key && members ? (members[key]?.length ?? 0) : null;
  }

  /** The `WorkloadGroup` resource a group peer names. */
  groupLink(peer: PolicyPeer): { commands: string[]; params: Record<string, string> } | null {
    const project = peer.project ?? this.project();

    return peer.group && project
      ? { commands: resourceLink({ kind: 'WorkloadGroup', name: peer.group, project }), params: { project } }
      : null;
  }
}
