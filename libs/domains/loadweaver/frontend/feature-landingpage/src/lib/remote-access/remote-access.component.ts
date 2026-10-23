import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ClientActivityIllustrationComponent } from '../illustrations/client-activity-illustration.component';
import { RemoteAccessIllustrationComponent } from '../illustrations/remote-access-illustration.component';
import { LoadweaverEarlyAccessDirective } from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-remote-access',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    SharedContactPersonComponent,
    ClientActivityIllustrationComponent,
    RemoteAccessIllustrationComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./remote-access.component.scss'],
  templateUrl: './remote-access.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalRemoteAccessComponent implements OnInit {
  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverRemoteAccess-metaTitle:Remote access with WireGuard, governed by policies :: Loadweaver`,
      description: $localize`:@@featureLoadweaverRemoteAccess-metaDescription:People, machines and whole offices connect to your Loadweaver cluster over WireGuard and reach internal services only as their policies allow, with SSO enrollment, expiring keys, split tunneling, site-to-site and device posture.`,
      keywords: $localize`:@@featureLoadweaverRemoteAccess-metaKeywords:Loadweaver remote access, WireGuard VPN, device posture, site-to-site VPN, split tunnel, SSO VPN, Intune, Jamf, CrowdStrike`,
      path: '/remote-access',
    });
  }
}
