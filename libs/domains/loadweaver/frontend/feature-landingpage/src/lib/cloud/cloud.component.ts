import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { TopologyIllustrationComponent } from '../illustrations/topology-illustration.component';
import { LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE, LoadweaverEarlyAccessDirective } from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-cloud',
  imports: [
    CommonModule,
    RouterModule,
    FpcButtonComponent,
    SharedContactPersonComponent,
    TopologyIllustrationComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./cloud.component.scss'],
  templateUrl: './cloud.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalCloudComponent implements OnInit {
  protected readonly cloudEarlyAccessMessage = LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE;

  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverCloud-metaTitle:Loadweaver Cloud: a dedicated cluster, operated by us :: Loadweaver`,
      description: $localize`:@@featureLoadweaverCloud-metaDescription:Loadweaver Cloud is a dedicated cluster per customer with its own control plane, nodes and keys, set up and operated by us. Add nodes with your own provider accounts and leave safely with a final backup.`,
      keywords: $localize`:@@featureLoadweaverCloud-metaKeywords:Loadweaver Cloud, managed cluster, dedicated cluster, managed high availability, Hetzner, DigitalOcean`,
      path: '/cloud',
    });
  }
}
