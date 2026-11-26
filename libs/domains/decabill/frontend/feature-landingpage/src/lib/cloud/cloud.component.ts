import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  signal,
  ViewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/decabill/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/decabill/frontend/data-access-portal';
import {
  SharedContactPersonComponent,
  SharedHeroMascotComponent,
  SharedMarkStackComponent,
} from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';

import { CloudIllustrationComponent } from '../illustrations/cloud-illustration.component';

export interface CloudInfrastructureProvider {
  id: string;
  name: string;
  tagline: string;
  datacenters: string;
  network: string;
  hardware: string;
}

@Component({
  selector: 'framework-portal-cloud',
  imports: [
    SharedMarkStackComponent,
    SharedHeroMascotComponent,
    SharedContactPersonComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    CloudIllustrationComponent,
  ],
  styleUrls: ['./cloud.component.scss'],
  templateUrl: './cloud.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalCloudComponent implements OnInit, AfterViewInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly locale = inject(LOCALE_ID);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('plansCarousel') plansCarousel!: ElementRef<HTMLDivElement>;

  readonly billingBaseUrl = this.environment.application.production
    ? `${this.environment.landing.urls.portal}/${this.locale}/subscriptions?order=true`
    : `${this.environment.landing.urls.portal}/subscriptions?order=true`;

  readonly cheapestOffering = toSignal(this.servicePlansFacade.getCheapestServicePlanOffering$(), {
    initialValue: null,
  });

  readonly cheapestOfferingLoading = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoading$(), {
    initialValue: false,
  });

  readonly cheapestLoaded = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoaded$(), {
    initialValue: false,
  });

  readonly plans = toSignal(this.servicePlansFacade.getServicePlans$(), {
    initialValue: [],
  });

  readonly plansLoading = toSignal(this.servicePlansFacade.getServicePlansLoading$(), {
    initialValue: false,
  });

  readonly plansLoaded = toSignal(this.servicePlansFacade.getServicePlansLoaded$(), {
    initialValue: false,
  });

  readonly plansError = toSignal(this.servicePlansFacade.getServicePlansError$(), {
    initialValue: null,
  });

  readonly plansScrollAtStart = signal(true);
  readonly plansScrollAtEnd = signal(false);

  readonly infrastructureProviders: CloudInfrastructureProvider[] = [
    {
      id: 'hetzner',
      name: $localize`:@@featureDecabillCloud-infraHetznerName:Hetzner Cloud`,
      tagline: $localize`:@@featureDecabillCloud-infraHetznerTagline:European data centers with modern networking and dependable hardware.`,
      datacenters: $localize`:@@featureDecabillCloud-infraHetznerDc:Nuremberg and Falkenstein (Germany), Helsinki (Finland), Ashburn (US), and Singapore.`,
      network: $localize`:@@featureDecabillCloud-infraHetznerNet:Redundant uplinks, IPv4 and IPv6, and private networking between your resources where it fits your architecture.`,
      hardware: $localize`:@@featureDecabillCloud-infraHetznerHw:NVMe storage and current-generation AMD and Intel CPUs so workloads stay responsive under load.`,
    },
    {
      id: 'digitalocean',
      name: $localize`:@@featureDecabillCloud-infraDigitalOceanName:DigitalOcean`,
      tagline: $localize`:@@featureDecabillCloud-infraDigitalOceanTagline:Simple, developer-focused cloud with regions across North America, Europe, and Asia.`,
      datacenters: $localize`:@@featureDecabillCloud-infraDigitalOceanDc:New York, San Francisco, and Toronto; London, Amsterdam, and Frankfurt; Singapore and Bangalore.`,
      network: $localize`:@@featureDecabillCloud-infraDigitalOceanNet:VPC private networking between Droplets in the same region, optional floating IPv4 addresses, and IPv6 where the region supports it.`,
      hardware: $localize`:@@featureDecabillCloud-infraDigitalOceanHw:SSD-backed Droplets from shared vCPU sizes for typical workloads to dedicated vCPU plans when you need steady CPU performance.`,
    },
  ];

  readonly planSkeletonPlaceholders = [1, 2, 3] as const;

  ngOnInit(): void {
    const pageTitle = $localize`:@@featureDecabillCloud-metaTitlePage:Fully managed billing, zero platform ops`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.application.productName);
    const metaDescription = $localize`:@@featureDecabillCloud-metaDescription:Decabill Cloud is the fully managed billing platform for agencies and product teams. Customer console, e-invoicing, accounting, and provisioning, with infrastructure, updates, and scaling handled for you.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureDecabillCloud-metaKeywords:Decabill Cloud, managed billing platform, hosted invoicing, SaaS billing, subscription billing, e-invoicing`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://decabill.com/cloud',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
          siteName: this.environment.application.productName,
        }),
      ),
    );

    if (isPlatformBrowser(this.platformId)) {
      this.servicePlansFacade.loadCheapestServicePlanOffering();
      this.servicePlansFacade.loadServicePlans();
    }
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.syncPlansScrollState());
  }

  billingIntervalSuffix(plan: PublicServicePlanOffering): string {
    const value = plan.billingIntervalValue;
    const type = plan.billingIntervalType;

    if (type === 'month' && value === 1) {
      return $localize`:@@featureDecabillCloud-planPriceMonth:/ month`;
    }

    if (type === 'hour' && value === 1) {
      return $localize`:@@featureDecabillCloud-planPriceHour:/ hour`;
    }

    if (type === 'day' && value === 1) {
      return $localize`:@@featureDecabillCloud-planPriceDay:/ day`;
    }

    if (type === 'year' && value === 1) {
      return $localize`:@@featureDecabillCloud-planPriceYear:/ year`;
    }

    if (type === 'month') {
      return $localize`:@@featureDecabillCloud-planPriceMonths:/ ${value}:intervalValue: months`;
    }

    if (type === 'hour') {
      return $localize`:@@featureDecabillCloud-planPriceHours:/ ${value}:intervalValue: hours`;
    }

    if (type === 'day') {
      return $localize`:@@featureDecabillCloud-planPriceDays:/ ${value}:intervalValue: days`;
    }

    if (type === 'year') {
      return $localize`:@@featureDecabillCloud-planPriceYears:/ ${value}:intervalValue: years`;
    }

    return ` / ${value} ${type}`;
  }

  formatPublicOfferingPrice = formatPublicOfferingPrice;

  syncPlansScrollState(): void {
    const el = this.plansCarousel?.nativeElement;

    if (!el) {
      return;
    }

    const epsilon = 8;

    this.plansScrollAtStart.set(el.scrollLeft <= epsilon);
    this.plansScrollAtEnd.set(el.scrollLeft + el.clientWidth >= el.scrollWidth - epsilon);
  }

  scrollCloudPlans(direction: 'left' | 'right'): void {
    const row = this.plansCarousel?.nativeElement;

    if (!row) {
      return;
    }

    const col = row.querySelector('.cloud-plan-col') as HTMLElement | null;
    const gap = 24;
    const delta = (col?.offsetWidth ?? Math.floor(row.clientWidth * 0.33)) + gap;

    row.scrollBy({
      left: direction === 'right' ? delta : -delta,
      behavior: 'smooth',
    });
    window.setTimeout(() => this.syncPlansScrollState(), 400);
  }
}
