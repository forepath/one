import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit, PLATFORM_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/agenstra/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/agenstra/frontend/data-access-portal';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedLogoGridComponent, type SharedLogoGridLogo } from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ConsoleIllustrationComponent } from '../illustrations/console-illustration.component';
import { IdeIllustrationComponent } from '../illustrations/ide-illustration.component';

@Component({
  selector: 'framework-portal-home',
  imports: [
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    ConsoleIllustrationComponent,
    IdeIllustrationComponent,
    SharedLogoGridComponent,
  ],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHomeComponent implements OnInit {
  protected readonly agentLogoSlots: readonly (readonly SharedLogoGridLogo[])[] = [
    [{ id: 'opencode', name: 'OpenCode', logoUrl: 'assets/images/logos/opencode.svg' }],
    [{ id: 'docker', name: 'Docker', logoUrl: 'assets/images/logos/docker.png' }],
    [{ id: 'kubernetes', name: 'Kubernetes', logoUrl: 'assets/images/logos/kubernetes.svg' }],
    [
      { id: 'proxmox', name: 'Proxmox', logoUrl: 'assets/images/logos/proxmox.svg' },
      { id: 'hetzner', name: 'Hetzner', logoUrl: 'assets/images/logos/hetzner.svg', compact: true },
      { id: 'digitalocean', name: 'DigitalOcean', logoUrl: 'assets/images/logos/digitalocean.svg' },
    ],
  ];

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly cheapestOffering = toSignal(this.servicePlansFacade.getCheapestServicePlanOffering$(), {
    initialValue: null,
  });

  readonly cheapestOfferingLoading = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoading$(), {
    initialValue: false,
  });

  readonly cheapestLoaded = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoaded$(), {
    initialValue: false,
  });

  readonly billingBaseUrl = this.environment.application.production
    ? `${this.environment.landing.urls.portal}/${this.locale}/subscriptions?order=true`
    : `${this.environment.landing.urls.portal}/subscriptions?order=true`;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.servicePlansFacade.loadCheapestServicePlanOffering();
    }

    const metaTitle = $localize`:@@featurePortalHome-metaTitle:One place to run, govern, and ship with agents :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalHome-metaDescription:Run and govern coding agents at enterprise scale: workspaces, ticket automation, in-browser coding, releases, policy, and audit trails. Self-host Agenstra or run on Agenstra Cloud.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalHome-metaKeywords:Agenstra, enterprise coding agents, AI agent governance, ticket automation, agent audit, self-hosted AI platform, software delivery, team knowledge, Cursor OpenCode integration`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }

  billingIntervalSuffix(plan: PublicServicePlanOffering): string {
    const value = plan.billingIntervalValue;
    const type = plan.billingIntervalType;

    if (type === 'month' && value === 1) {
      return $localize`:@@featurePortalCloud-planPriceMonth:/ month`;
    }

    if (type === 'hour' && value === 1) {
      return $localize`:@@featurePortalCloud-planPriceHour:/ hour`;
    }

    if (type === 'day' && value === 1) {
      return $localize`:@@featurePortalCloud-planPriceDay:/ day`;
    }

    if (type === 'year' && value === 1) {
      return $localize`:@@featurePortalCloud-planPriceYear:/ year`;
    }

    if (type === 'month') {
      return $localize`:@@featurePortalCloud-planPriceMonths:/ ${value}:intervalValue: months`;
    }

    if (type === 'hour') {
      return $localize`:@@featurePortalCloud-planPriceHours:/ ${value}:intervalValue: hours`;
    }

    if (type === 'day') {
      return $localize`:@@featurePortalCloud-planPriceDays:/ ${value}:intervalValue: days`;
    }

    if (type === 'year') {
      return $localize`:@@featurePortalCloud-planPriceYears:/ ${value}:intervalValue: years`;
    }

    return ` / ${value} ${type}`;
  }

  formatPublicOfferingPrice = formatPublicOfferingPrice;
}
