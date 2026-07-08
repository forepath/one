import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/agenstra/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/agenstra/frontend/data-access-portal';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';

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
  imports: [CommonModule, RouterModule],
  styleUrls: ['./cloud.component.scss'],
  templateUrl: './cloud.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalCloudComponent implements OnInit, AfterViewInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('plansCarousel') plansCarousel!: ElementRef<HTMLDivElement>;

  readonly billingBaseUrl = this.environment.production
    ? `${this.environment.billing.frontendUrl}/${this.locale}/subscriptions?order=true`
    : `${this.environment.billing.frontendUrl}/subscriptions?order=true`;

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
      name: $localize`:@@featurePortalCloud-infraHetznerName:Hetzner Cloud`,
      tagline: $localize`:@@featurePortalCloud-infraHetznerTagline:European data centers with modern networking and dependable hardware.`,
      datacenters: $localize`:@@featurePortalCloud-infraHetznerDc:Nuremberg and Falkenstein (Germany), Helsinki (Finland), Ashburn (US), and Singapore.`,
      network: $localize`:@@featurePortalCloud-infraHetznerNet:Redundant uplinks, IPv4 and IPv6, and private networking between your resources where it fits your architecture.`,
      hardware: $localize`:@@featurePortalCloud-infraHetznerHw:NVMe storage and current-generation AMD and Intel CPUs so workloads stay responsive under load.`,
    },
    {
      id: 'digitalocean',
      name: $localize`:@@featurePortalCloud-infraDigitalOceanName:DigitalOcean`,
      tagline: $localize`:@@featurePortalCloud-infraDigitalOceanTagline:Simple, developer-focused cloud with regions across North America, Europe, and Asia.`,
      datacenters: $localize`:@@featurePortalCloud-infraDigitalOceanDc:New York, San Francisco, and Toronto; London, Amsterdam, and Frankfurt; Singapore and Bangalore.`,
      network: $localize`:@@featurePortalCloud-infraDigitalOceanNet:VPC private networking between Droplets in the same region, optional floating IPv4 addresses, and IPv6 where the region supports it.`,
      hardware: $localize`:@@featurePortalCloud-infraDigitalOceanHw:SSD-backed Droplets from shared vCPU sizes for typical workloads to dedicated vCPU plans when you need steady CPU performance.`,
    },
  ];

  readonly planSkeletonPlaceholders = [1, 2, 3] as const;

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalCloud-metaTitle:Fully managed cloud, zero platform ops :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalCloud-metaDescription:Fully managed Agenstra control plane for distributed coding agents. Deploy, monitor, and govern agents across tools and environments without running your own ops stack.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalCloud-metaKeywords:Agenstra Cloud, Agenstra, AI agent platform, AI control plane, AI governance, AI observability, managed SaaS, agentic systems`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/cloud',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.servicePlansFacade.loadCheapestServicePlanOffering();
    this.servicePlansFacade.loadServicePlans();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.syncPlansScrollState());
  }

  billingIntervalSuffix(plan: PublicServicePlanOffering): string {
    if (plan.billingIntervalType === 'month' && plan.billingIntervalValue === 1) {
      return $localize`:@@featurePortalCloud-planPriceMonth:/month`;
    }

    if (plan.billingIntervalType === 'hour') {
      return $localize`:@@featurePortalCloud-planPriceHour:/hour`;
    }

    if (plan.billingIntervalType === 'day') {
      return $localize`:@@featurePortalCloud-planPriceDay:/day`;
    }

    return ` / ${plan.billingIntervalValue} ${plan.billingIntervalType}`;
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
