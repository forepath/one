import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ArchitectureIllustrationComponent } from '../illustrations/architecture-illustration.component';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';

@Component({
  selector: 'framework-portal-how-it-works',
  imports: [
    SharedContactPersonComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    ArchitectureIllustrationComponent,
  ],
  styleUrls: ['./how-it-works.component.scss'],
  templateUrl: './how-it-works.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHowItWorksComponent implements OnInit {
  /** Example web traffic policy for one environment layer (the format of the agent configuration). */
  protected readonly egressPolicyExample = `{
  "egress": {
    "mode": "enforce",
    "block_private_networks": true,
    "allow_hosts": [
      "github.com",
      "npmjs.org"
    ],
    "deny_hosts": ["paste.example"],
    "network_allow": [{
      "protocol": "tcp",
      "ports": "22",
      "destinations": ["10.20.0.0/16"]
    }]
  }
}`;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalHowItWorks-metaTitle:How Agenstra works: architecture, sandboxing and egress control :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalHowItWorks-metaDescription:A technical look at Agenstra: control plane, agent managers, gVisor-sandboxed agent containers, per-environment egress guards, layered policy and audit trails.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalHowItWorks-metaKeywords:Agenstra architecture, AI agent sandbox, gVisor coding agents, agent container isolation, egress filtering for AI agents, agent control plane, self-hosted coding agents`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/how-it-works',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }
}
