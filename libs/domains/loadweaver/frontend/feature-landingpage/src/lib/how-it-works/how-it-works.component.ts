import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { FailoverIllustrationComponent } from '../illustrations/failover-illustration.component';
import { PlanDiffIllustrationComponent } from '../illustrations/plan-diff-illustration.component';
import { PolicyGraphIllustrationComponent } from '../illustrations/policy-graph-illustration.component';
import { LoadweaverEarlyAccessDirective } from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-how-it-works',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    SharedContactPersonComponent,
    PolicyGraphIllustrationComponent,
    PlanDiffIllustrationComponent,
    FailoverIllustrationComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./how-it-works.component.scss'],
  templateUrl: './how-it-works.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHowItWorksComponent implements OnInit {
  /** Shape of a policy: from → to → what → action, plus a mode (3.3). Field names are illustrative. */
  protected readonly policyExample = `kind: Policy
name: api-to-db
from:
  group: api
to:
  group: db
allow:
  - protocol: tcp
    ports: [5432]
mode: enforce   # or monitor`;

  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverHowItWorks-metaTitle:How Loadweaver works: policies, plan and apply, failure analysis and failover :: Loadweaver`,
      description: $localize`:@@featureLoadweaverHowItWorks-metaDescription:A technical look at Loadweaver: groups and allow-only policies compiled into every network layer, plan and apply with locks and rollback, failure analysis and pinning, IP and DNS failover, and configuration in Git with a plan bot.`,
      keywords: $localize`:@@featureLoadweaverHowItWorks-metaKeywords:Loadweaver architecture, policy model, security groups, WireGuard, BIRD, nftables, Envoy, plan and apply, failure analysis, IP failover, DNS failover, GitOps, plan bot`,
      path: '/how-it-works',
    });
  }
}
