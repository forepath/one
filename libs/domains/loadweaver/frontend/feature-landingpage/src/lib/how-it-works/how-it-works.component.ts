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

  /** Isolation levels (3.1, 3.35): one line per service; microVMs boot the image itself. */
  protected readonly isolationExample = `services:
  api:
    image: ghcr.io/acme/api:1.4      # runc
  renderer:
    image: ghcr.io/acme/render:3
    x-loadweaver:
      runtime: sandboxed             # gVisor
  builds:
    image: ghcr.io/acme/builder:7
    x-loadweaver:
      runtime: microvm               # own kernel
      microvm: { rootfsSize: 20Gi }`;

  /** Full VMs (3.35): a `VirtualMachine` resource with a boot disk from the image, a data disk and two NICs. */
  protected readonly vmExample = `kind: VirtualMachine
name: db1
spec:
  image: registry.lw/shop/debian-13:20261017
  cpu: { vcpus: 4 }
  memory: 8Gi
  disks:
    - { name: root, size: 20Gi, source: image }
    - { name: data, size: 200Gi, replicas: 2 }
  nics:
    - { name: eth0, groups: [db] }
    - { name: backup, groups: [backup-net] }
  cloudInit:
    sshAuthorizedKeys: ['ssh-ed25519 AAAA…']`;

  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverHowItWorks-metaTitle:How Loadweaver works: policies, plan and apply, failure analysis and failover :: Loadweaver`,
      description: $localize`:@@featureLoadweaverHowItWorks-metaDescription:A technical look at Loadweaver: groups and allow-only policies compiled into every network layer, plan and apply with locks and rollback, failure analysis and pinning, four isolation levels up to microVMs, full virtual machines with replicated disks and live migration, IP and DNS failover, and configuration in Git with a plan bot.`,
      keywords: $localize`:@@featureLoadweaverHowItWorks-metaKeywords:Loadweaver architecture, policy model, security groups, WireGuard, BIRD, nftables, Envoy, plan and apply, failure analysis, gVisor, KVM, microVM, isolation levels, virtual machines, QEMU, live migration, IP failover, DNS failover, GitOps, plan bot`,
      path: '/how-it-works',
    });
  }
}
