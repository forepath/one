import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/decabill/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/decabill/frontend/data-access-portal';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';

@Component({
  selector: 'framework-portal-home',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHomeComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  activeSlide = signal<number>(1);
  autoplayInterval = this.initializeAutoplayInterval();

  readonly cheapestOffering = toSignal(this.servicePlansFacade.getCheapestServicePlanOffering$(), {
    initialValue: null,
  });

  readonly cheapestOfferingLoading = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoading$(), {
    initialValue: false,
  });

  readonly cheapestLoaded = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoaded$(), {
    initialValue: false,
  });

  readonly billingBaseUrl = this.environment.production
    ? `${this.environment.billing.frontendUrl}/${this.locale}/subscriptions?order=true`
    : `${this.environment.billing.frontendUrl}/subscriptions?order=true`;

  readonly billingIntegrations: ReadonlyArray<{
    id: string;
    name: string;
    brandColor: string;
    logoUrl?: string;
    wordmark?: boolean;
    logoClass?: string;
  }> = [
    { id: 'stripe', name: 'Stripe', logoUrl: 'assets/images/logos/stripe.svg', brandColor: '#635BFF' },
    { id: 'hetzner', name: 'Hetzner', logoUrl: 'assets/images/logos/hetzner.svg', brandColor: '#D50C2D' },
    {
      id: 'digitalocean',
      name: 'DigitalOcean',
      logoUrl: 'assets/images/logos/digitalocean.svg',
      brandColor: '#0080FF',
    },
    {
      id: 'datev',
      name: 'DATEV',
      logoUrl: 'assets/images/logos/datev.svg',
      brandColor: '#90D033',
      logoClass: 'home-integration-grid__logo--mark',
    },
    {
      id: 'oidc',
      name: 'OpenID Connect',
      logoUrl: 'assets/images/logos/oidc.svg',
      brandColor: '#FF6200',
      logoClass: 'home-integration-grid__logo--wide',
    },
    {
      id: 'api',
      name: $localize`:@@featureDecabillHome-howIntegrationApi:REST API`,
      brandColor: '#1A1F36',
      wordmark: true,
    },
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.servicePlansFacade.loadCheapestServicePlanOffering();
    }

    const pageTitle = $localize`:@@featureDecabillHome-metaTitlePage:Billing for agencies and digital products`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.productName);
    const metaDescription = $localize`:@@featureDecabillHome-metaDescription:Decabill helps agencies and digital product teams bill services, projects, SaaS subscriptions, and hosting. Invoicing, payments, and customer self-service in one multi-tenant platform.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureDecabillHome-metaKeywords:Decabill, agency billing, digital products, SaaS billing, hosting billing, multi-tenant, NestJS, invoicing, Stripe, ZUGFeRD`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://decabill.com',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
          siteName: this.environment.productName,
        }),
      ),
    );
  }

  selectSlide(slide: number): void {
    this.activeSlide.set(Math.max(1, Math.min(4, slide)));
  }

  pauseAutoplay() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
    }

    this.autoplayInterval = null;
  }

  resumeAutoplay() {
    this.autoplayInterval = this.initializeAutoplayInterval();
  }

  private initializeAutoplayInterval() {
    if (isPlatformBrowser(this.platformId)) {
      return setInterval(() => {
        this.activeSlide.update((prev) => prev + 1);

        if (this.activeSlide() > 4) {
          this.activeSlide.set(1);
        }
      }, 3000);
    }

    return null;
  }

  billingIntervalSuffix(plan: PublicServicePlanOffering): string {
    const value = plan.billingIntervalValue;
    const type = plan.billingIntervalType;

    if (type === 'month' && value === 1) {
      return $localize`:@@featureDecabillHome-planPriceMonth:/ month`;
    }

    if (type === 'year' && value === 1) {
      return $localize`:@@featureDecabillHome-planPriceYear:/ year`;
    }

    if (type === 'hour' && value === 1) {
      return $localize`:@@featureDecabillHome-planPriceHour:/ hour`;
    }

    if (type === 'day' && value === 1) {
      return $localize`:@@featureDecabillHome-planPriceDay:/ day`;
    }

    if (type === 'month') {
      return $localize`:@@featureDecabillHome-planPriceMonths:/ ${value}:intervalValue: months`;
    }

    if (type === 'hour') {
      return $localize`:@@featureDecabillHome-planPriceHours:/ ${value}:intervalValue: hours`;
    }

    if (type === 'day') {
      return $localize`:@@featureDecabillHome-planPriceDays:/ ${value}:intervalValue: days`;
    }

    if (type === 'year') {
      return $localize`:@@featureDecabillHome-planPriceYears:/ ${value}:intervalValue: years`;
    }

    return ` / ${value} ${type}`;
  }

  formatPublicOfferingPrice = formatPublicOfferingPrice;
}
