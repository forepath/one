import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit, PLATFORM_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/decabill/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/decabill/frontend/data-access-portal';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { OverviewIllustrationComponent } from '../illustrations/overview-illustration.component';
import { BillingTimelineIllustrationComponent } from '../illustrations/billing-timeline-illustration.component';
import { PlanConfigIllustrationComponent } from '../illustrations/plan-config-illustration.component';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';

@Component({
  selector: 'framework-portal-home',
  imports: [
    SharedContactPersonComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    OverviewIllustrationComponent,
    PlanConfigIllustrationComponent,
    BillingTimelineIllustrationComponent,
  ],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHomeComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

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

    const pageTitle = $localize`:@@featureDecabillHome-metaTitlePage:Billing for agencies and digital products`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.application.productName);
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
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
          siteName: this.environment.application.productName,
        }),
      ),
    );
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
