import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { DesktopTunnelIllustrationComponent } from '../illustrations/desktop-tunnel-illustration.component';
import { PlanDiffIllustrationComponent } from '../illustrations/plan-diff-illustration.component';
import { LoadweaverEarlyAccessDirective } from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-apps',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    SharedContactPersonComponent,
    DesktopTunnelIllustrationComponent,
    PlanDiffIllustrationComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./apps.component.scss'],
  templateUrl: './apps.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalAppsComponent implements OnInit {
  private readonly setPageMeta = injectPageMeta();

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverApps-metaTitle:Desktop, mobile, CLI and MCP :: Loadweaver`,
      description: $localize`:@@featureLoadweaverApps-metaDescription:Loadweaver on every screen: a code-signed desktop app with its own VPN tunnel and posture reporting, mobile apps for alerts, approvals and remote access, a CLI for every platform and an MCP server for your agents.`,
      keywords: $localize`:@@featureLoadweaverApps-metaKeywords:Loadweaver desktop app, Loadweaver mobile app, Loadweaver CLI, MCP server, WireGuard client, device posture, code-signed`,
      path: '/apps',
    });
  }
}
