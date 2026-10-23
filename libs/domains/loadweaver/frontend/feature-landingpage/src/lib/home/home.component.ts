import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { PlanDiffIllustrationComponent } from '../illustrations/plan-diff-illustration.component';
import { TopologyIllustrationComponent } from '../illustrations/topology-illustration.component';
import { LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE, LoadweaverEarlyAccessDirective } from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-home',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    SharedContactPersonComponent,
    TopologyIllustrationComponent,
    PlanDiffIllustrationComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHomeComponent implements OnInit {
  protected readonly cloudEarlyAccessMessage = LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE;

  /** A deployment is a plain Compose project; Loadweaver settings live in `x-loadweaver` (3.11, 3.12). */
  protected readonly composeExample = `services:
  web:
    image: ghcr.io/acme/shop-web:2.4.1
    x-loadweaver:
      replicas: 2
      groups: [web]
      expose:
        hostnames: [shop.example.com]
  db:
    image: postgres:17
    volumes: [db-data:/var/lib/postgresql/data]
  builds:
    image: ghcr.io/acme/builder:7
    x-loadweaver:
      runtime: microvm

volumes:
  db-data:
    x-loadweaver:
      replicas: { sync: 2, async: 1 }`;

  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverHome-metaTitle:Resilient clusters from a handful of servers :: Loadweaver`,
      description: $localize`:@@featureLoadweaverHome-metaDescription:Loadweaver turns a handful of servers into a resilient multi-site cluster: encrypted network between sites, shared storage on every node, ingress that fails over on its own, and Docker Compose deployments and virtual machines that go through plan and apply.`,
      keywords: $localize`:@@featureLoadweaverHome-metaKeywords:Loadweaver, high availability, Docker Compose cluster, multi-site cluster, WireGuard, replicated storage, IP failover, gVisor, microVM, virtual machines, KVM, self-hosted, Kubernetes alternative`,
      path: '',
    });
  }
}
