import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsolePoliciesFacade,
  type GroupMembers,
  type PolicyPeer,
  type PolicyResource,
  type PolicyRule,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcEmptyStateComponent,
  type FpcKeyValueItem,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcDataTableComponent,
  FpcListHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest } from 'rxjs';

import { resourceLink } from '../resources/resource-format';
import { peerGroupKey, peerIcon, peerLabel, protocolLabel, ruleLabel } from './policy-format';
import { LoadweaverLaneComponent } from '../section/lane.component';

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
    FpcEmptyStateComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcDataTableComponent,
    FpcListHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './policy-detail-page.component.html',
  standalone: true,
})
export class LoadweaverPolicyDetailPageComponent implements OnInit {
  /** The policy to show (object pages); else the one of the route. */
  readonly policyKey = input<{ name: string; project: string | null } | null>(null);
  private readonly keyInput$ = toObservable(this.policyKey);
  private readonly facade = inject(ConsolePoliciesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly policies = toSignal(this.facade.policies$, { initialValue: [] as PolicyResource[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly members = toSignal(this.facade.members$, { initialValue: null as GroupMembers | null });

  readonly name = signal<string | null>(null);
  /** Phone lane switch (3.37): Overview | each peer side. */
  readonly lane = signal<string>('overview');
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
  /** Overview facts (3.38: `fpc-key-value-list`; rich values come from `fpcKeyValue` templates). */
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const p = this.policy();

    if (!p) return [];

    return [
      { key: 'project', label: $localize`:@@lwConsolePolicyDetail-project:Project` },
      {
        key: 'mode',
        label: $localize`:@@lwConsolePolicyDetail-mode:Mode`,
        hint:
          p.spec.mode === 'monitor'
            ? $localize`:@@lwConsolePolicyDetail-monitorHint:Would-be blocks are recorded, not enforced.`
            : null,
      },
      { key: 'action', label: $localize`:@@lwConsolePolicyDetail-action:Action` },
      ...(p.spec.description
        ? [
            {
              key: 'description',
              label: $localize`:@@lwConsolePolicyDetail-description:Description`,
              value: p.spec.description,
            },
          ]
        : []),
      ...(p.spec.egress ? [{ key: 'egress', label: $localize`:@@lwConsolePolicyDetail-egress:Egress addresses` }] : []),
    ];
  });
  readonly key = computed(() => {
    const name = this.name();

    return name ? { kind: 'Policy', name, project: this.project() } : null;
  });

  readonly peerLabel = peerLabel;
  readonly peerIcon = peerIcon;
  readonly ruleLabel = ruleLabel;
  readonly resourceLink = resourceLink;

  readonly title = $localize`:@@lwConsolePolicyDetail-title:Policy`;
  readonly overviewTitle = $localize`:@@lwConsolePolicyDetail-overview:Overview`;
  readonly fromTitle = $localize`:@@lwConsolePolicyDetail-from:From`;
  readonly toTitle = $localize`:@@lwConsolePolicyDetail-to:To`;
  readonly rulesTitle = $localize`:@@lwConsolePolicyDetail-rules:Rules`;
  readonly loadingLabel = $localize`:@@lwConsolePolicyDetail-loading:Loading the policy`;

  /** 3.38 D1: protocol · ports · HTTP methods · paths · hosts (rules have no state of their own). */
  readonly ruleColumns: FpcTableColumn<PolicyRule>[] = [
    {
      id: 'protocol',
      label: $localize`:@@lwConsolePolicyDetail-colProtocol:Protocol`,
      value: (r) => protocolLabel(r.protocol ?? 'tcp'),
      required: true,
      priority: 1,
    },
    {
      id: 'ports',
      label: $localize`:@@lwConsolePolicyDetail-colPorts:Ports`,
      value: (r) => r.ports?.join(', ') ?? '',
      mono: true,
      priority: 1,
    },
    {
      id: 'methods',
      label: $localize`:@@lwConsolePolicyDetail-colMethods:HTTP methods`,
      value: (r) => r.http?.methods?.join(', ') ?? '',
    },
    {
      id: 'paths',
      label: $localize`:@@lwConsolePolicyDetail-colPaths:Paths`,
      value: (r) => r.http?.paths?.join(', ') ?? '',
      mono: true,
    },
    {
      id: 'hosts',
      label: $localize`:@@lwConsolePolicyDetail-colHosts:Hosts`,
      value: (r) => r.http?.hosts?.join(', ') ?? '',
      mono: true,
    },
  ];
  readonly ruleId = (rule: PolicyRule) => ruleLabel(rule);
  /** 3.38 D1: peer (link for groups) · members. */
  readonly peerColumns: FpcTableColumn<PolicyPeer>[] = [
    {
      id: 'peer',
      label: $localize`:@@lwConsolePolicyDetail-colPeer:Peer`,
      value: (peer) => peerLabel(peer),
      required: true,
      priority: 1,
    },
    {
      id: 'members',
      label: $localize`:@@lwConsolePolicyDetail-colMembers:Members`,
      value: (peer) => this.memberCount(peer),
      align: 'end',
      priority: 1,
    },
  ];
  readonly peerId = (peer: PolicyPeer) => JSON.stringify(peer);
  readonly peerLink = (peer: PolicyPeer): string | null => {
    const link = this.groupLink(peer);

    return link ? link.commands.map((part, i) => (i === 0 ? part : encodeURIComponent(part))).join('/') : null;
  };

  ngOnInit(): void {
    combineLatest([this.keyInput$, this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([input, params, query]) => {
        this.name.set(input?.name ?? params.get('name'));
        this.project.set(input ? input.project : query.get('project') || null);
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
      ? { commands: resourceLink({ kind: 'WorkloadGroup', name: peer.group, project }), params: {} }
      : null;
  }
}
